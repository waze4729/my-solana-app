// server.js
import express from "express";
import bodyParser from "body-parser";
import solanaWeb3 from "@solana/web3.js";

const { Connection, PublicKey } = solanaWeb3;

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(express.static("public")); // serve index.html from /public

// ---------- Solana Config ----------
const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const connection = new Connection(RPC_ENDPOINT, { commitment: "confirmed" });

// ---------- In-memory State ----------
let scanning = false;
let tokenMint = "";
let registry = {};
let initialTop50 = null;
let initialTop50Amounts = new Map();
let previousTop50 = new Set();
let previousTop50MinAmount = 0;
let allTimeNewTop50 = new Set();
let pollInterval = null;

// ---------- Helpers ----------
async function fetchAllTokenAccounts(mintAddress) {
  const mintPublicKey = new PublicKey(mintAddress);
  const filters = [
    { dataSize: 165 },
    { memcmp: { offset: 0, bytes: mintPublicKey.toBase58() } },
  ];
  try {
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
          amount:
            Number(parsed.info.tokenAmount.amount) /
            Math.pow(10, parsed.info.tokenAmount.decimals),
        };
      })
      .filter((a) => a.amount > 0);
  } catch (e) {
    console.error("Error fetching token accounts:", e.message || e);
    return [];
  }
}

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
      } else {
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

async function analyzeTop50(fresh) {
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
    completelyNewSinceFirstFetch: allTimeNewTop50.size,
    top50Sales,
    top50Buys,
  };
}

// ---------- Scan Loop ----------
async function pollData() {
  if (!tokenMint) return {};
  try {
    const fresh = await fetchAllTokenAccounts(tokenMint);

    if (!initialTop50) {
      const sorted = fresh.slice().sort((a, b) => b.amount - a.amount);
      initialTop50 = sorted.slice(0, 50).map((h) => h.owner);
      sorted.slice(0, 50).forEach((h) => initialTop50Amounts.set(h.owner, h.amount));
      previousTop50 = new Set(initialTop50);
      previousTop50MinAmount = sorted[49]?.amount || 0;
    }

    const changes = analyze(registry, fresh);
    const top50Stats = await analyzeTop50(fresh);

    return { changes, top50Stats, fresh };
  } catch (err) {
    console.error("Poll error:", err.message || err);
    return { error: err.message };
  }
}

// ---------- API ----------
app.post("/api/start", (req, res) => {
  const { mint } = req.body;
  if (!mint) return res.status(400).json({ error: "Missing token mint" });

  tokenMint = mint;
  scanning = true;
  registry = {};
  initialTop50 = null;
  initialTop50Amounts = new Map();
  previousTop50 = new Set();
  previousTop50MinAmount = 0;
  allTimeNewTop50 = new Set();

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => await pollData(), 2000);

  res.json({ message: "Scan started" });
});

app.post("/api/stop", (req, res) => {
  scanning = false;
  if (pollInterval) clearInterval(pollInterval);
  res.json({ message: "Scan stopped" });
});

app.get("/api/status", async (req, res) => {
  const data = await pollData();
  res.json(data);
});

// ---------- Start Server ----------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
