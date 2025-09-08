import express from "express";
import cors from "cors";
import { Connection, PublicKey } from "@solana/web3.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serve index.html

const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";

let registry = {}; // tracking state
let initialTop50 = null;
let initialTop50Amounts = new Map();
let previousTop50 = new Set();
let previousTop50MinAmount = 0;
let allTimeNewTop50 = new Set();
const connection = new Connection(RPC_ENDPOINT, { commitment: "confirmed" });

function makeStepBuckets() {
  const buckets = {};
  for (let pct = 10; pct <= 100; pct += 10) {
    buckets[`bought${pct}`] = 0;
    buckets[`sold${pct}`] = 0;
  }
  buckets.sold100 = 0;
  buckets.unchanged = 0;
  buckets.current = 0;
  buckets.total = 0;
  return buckets;
}

function analyze(registry, fresh) {
  const now = Date.now();
  const freshMap = new Map(fresh.map((h) => [h.owner, h.amount]));
  const changes = makeStepBuckets();

  for (const [owner, info] of Object.entries(registry)) {
    const freshAmount = freshMap.get(owner);
    if (freshAmount !== undefined) {
      info.current = freshAmount;
      info.lastSeen = now;
      const changePct = ((freshAmount - info.baseline) / info.baseline) * 100;
      let matched = false;

      if (Math.abs(changePct) < 10) changes.unchanged++;
      else if (changePct > 0) {
        for (let pct = 100; pct >= 10; pct -= 10) {
          if (changePct >= pct) {
            changes[`bought${pct}`]++;
            matched = true;
            break;
          }
        }
        if (!matched) changes.unchanged++;
      } else if (changePct < 0) {
        for (let pct = 100; pct >= 10; pct -= 10) {
          if (changePct <= -pct) {
            changes[`sold${pct}`]++;
            matched = true;
            break;
          }
        }
        if (!matched) changes.unchanged++;
      }
      changes.current++;
    } else {
      if (info.baseline > 0 && info.current !== 0) info.current = 0;
      if (info.baseline > 0 && info.current === 0) changes.sold100++;
    }
    changes.total++;
  }

  for (const { owner, amount } of fresh) {
    if (!registry[owner]) {
      registry[owner] = { baseline: amount, current: amount, lastSeen: now };
      changes.total++;
      changes.current++;
      changes.unchanged++;
    }
  }
  return changes;
}

async function fetchAllTokenAccounts(mintAddress) {
  const mintPublicKey = new PublicKey(mintAddress);
  const filters = [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mintPublicKey.toBase58() } }];
  const accounts = await connection.getParsedProgramAccounts(
    new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    { filters }
  );
  return accounts
    .map((acc) => {
      const parsed = acc.account.data.parsed;
      return {
        address: acc.pubkey.toBase58(),
        owner: parsed.info.owner,
        amount: Number(parsed.info.tokenAmount.amount) / Math.pow(10, parsed.info.tokenAmount.decimals),
      };
    })
    .filter((a) => a.amount > 0);
}

async function analyzeTop50(fresh, initialTop50) {
  const sorted = fresh.slice().sort((a, b) => b.amount - a.amount);
  const currentTop50 = sorted.slice(0, 50).map((h) => h.owner);
  const currentTop50Map = new Map(sorted.slice(0, 50).map((h) => [h.owner, h.amount]));
  const currentTop50MinAmount = sorted[49]?.amount || 0;

  const newSinceLastFetch = currentTop50.filter(
    (owner) => !previousTop50.has(owner) && currentTop50Map.get(owner) > previousTop50MinAmount
  );

  newSinceLastFetch.forEach((owner) => allTimeNewTop50.add(owner));

  const stillInTop50 = initialTop50.filter((owner) => currentTop50.includes(owner));
  const goneFromInitialTop50 = initialTop50.filter((owner) => !currentTop50.includes(owner));
  const newInTop50 = currentTop50.filter((owner) => !initialTop50.includes(owner));

  const top50Sales = { sold100: 0, sold50: 0, sold25: 0 };
  const top50Buys = { bought100: 0, bought50: 0, bought25: 0, bought10: 0 };

  for (const owner of initialTop50) {
    const initialAmount = initialTop50Amounts.get(owner);
    const currentAmount = currentTop50Map.get(owner) || 0;
    if (currentAmount === 0) top50Sales.sold100++;
    else {
      const changePct = ((currentAmount - initialAmount) / initialAmount) * 100;
      if (changePct <= -50) top50Sales.sold50++;
      else if (changePct <= -25) top50Sales.sold25++;
      else if (changePct >= 100) top50Buys.bought100++;
      else if (changePct >= 50) top50Buys.bought50++;
      else if (changePct >= 25) top50Buys.bought25++;
      else if (changePct >= 10) top50Buys.bought10++;
    }
  }

  previousTop50 = new Set(currentTop50);
  previousTop50MinAmount = currentTop50MinAmount;

  return {
    currentTop50Count: currentTop50.length,
    stillInTop50Count: stillInTop50.length,
    goneFromInitialTop50Count: goneFromInitialTop50.length,
    newInTop50Count: newInTop50.length,
    completelyNewSinceLastFetch: newSinceLastFetch.length,
    top50Sales,
    top50Buys,
  };
}

function formatOutput(changes, top50Stats) {
  let text = "=== LIVE HOLDER ANALYSIS ===\n";
  text += `Current holders: ${changes.current}\nTotal ever tracked: ${changes.total}\nUnchanged: ${changes.unchanged}\n`;
  for (let pct = 10; pct <= 100; pct += 10) text += `Bought >${pct}% more: ${changes[`bought${pct}`]}\n`;
  for (let pct = 10; pct <= 100; pct += 10) text += `Sold >${pct}%: ${changes[`sold${pct}`]}\n`;
  text += `Sold 100% (zeroed): ${changes.sold100}\n`;

  if (top50Stats) {
    text += "--- Top 50 HOLDERS ---\n";
    text += `Still in top 50: ${top50Stats.stillInTop50Count}\n`;
    text += `Gone from original top 50: ${top50Stats.goneFromInitialTop50Count}\n`;
    text += `New in top 50: ${top50Stats.newInTop50Count}\n`;
    text += `New since last fetch: ${top50Stats.completelyNewSinceLastFetch}\n`;
    text += "--- Sales ---\n";
    text += `Sold 100%: ${top50Stats.top50Sales.sold100}\n`;
    text += `Sold >50%: ${top50Stats.top50Sales.sold50}\n`;
    text += `Sold >25%: ${top50Stats.top50Sales.sold25}\n`;
    text += "--- Purchases ---\n";
    text += `Bought >100%: ${top50Stats.top50Buys.bought100}\n`;
    text += `Bought >50%: ${top50Stats.top50Buys.bought50}\n`;
    text += `Bought >25%: ${top50Stats.top50Buys.bought25}\n`;
    text += `Bought >10%: ${top50Stats.top50Buys.bought10}\n`;
  }
  text += `Updated at: ${new Date().toLocaleTimeString()}`;
  return text;
}

app.post("/api/scan", async (req, res) => {
  try {
    const { mint } = req.body;
    const fresh = await fetchAllTokenAccounts(mint);

    if (!initialTop50) {
      const sorted = fresh.slice().sort((a, b) => b.amount - a.amount);
      initialTop50 = sorted.slice(0, 50).map((h) => h.owner);
      sorted.slice(0, 50).forEach((h) => initialTop50Amounts.set(h.owner, h.amount));
    }

    const changes = analyze(registry, fresh);
    const top50Stats = await analyzeTop50(fresh, initialTop50);

    res.json({ output: formatOutput(changes, top50Stats) });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.listen(10000, () => console.log("Server running on port 10000"));
