import express from "express";
import bodyParser from "body-parser";
import * as web3 from "@solana/web3.js";

const { Connection, PublicKey } = web3;
const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(express.static("public"));

// Server-side storage (like localStorage)
const storage = {
  tokenMint: "",
  registry: {},
  initialTop50: null,
  initialTop50Amounts: new Map(),
  previousTop50: new Set(),
  previousTop50MinAmount: 0,
  allTimeNewTop50: new Set(),
  scanning: false,
  latestData: null,
  pollInterval: null,
};

async function fetchAllTokenAccounts(mintAddress) {
  const mintPublicKey = new PublicKey(mintAddress);
  try {
    const accounts = await connection.getParsedProgramAccounts(
      new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      { 
        filters: [
          { dataSize: 165 }, 
          { 
            memcmp: { 
              offset: 0, 
              bytes: mintPublicKey.toBase58() 
            } 
          }
        ] 
      }
    );
    return accounts.map((acc) => {
      const parsed = acc.account.data.parsed;
      return {
        address: acc.pubkey.toBase58(),
        owner: parsed.info.owner,
        amount: Number(parsed.info.tokenAmount.amount) / Math.pow(10, parsed.info.tokenAmount.decimals),
      };
    }).filter(a => a.amount > 0);
  } catch (e) {
    console.error("Fetch error:", e.message || e);
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
  const freshMap = new Map(fresh.map(h => [h.owner, h.amount]));
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
          if (changePct >= pct) { changes[`bought${pct}`]++; matched = true; break; }
        }
        if (!matched) changes.unchanged++;
      } else {
        for (let pct = 100; pct >= 10; pct -= 10) {
          if (changePct <= -pct) { changes[`sold${pct}`]++; matched = true; break; }
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

async function pollData() {
  if (!storage.tokenMint) return;
  const fresh = await fetchAllTokenAccounts(storage.tokenMint);

  if (!storage.initialTop50) {
    const sorted = fresh.slice().sort((a, b) => b.amount - a.amount);
    storage.initialTop50 = sorted.slice(0, 50).map(h => h.owner);
    sorted.slice(0, 50).forEach(h => storage.initialTop50Amounts.set(h.owner, h.amount));
    storage.previousTop50 = new Set(storage.initialTop50);
    storage.previousTop50MinAmount = sorted[49]?.amount || 0;
  }

  const changes = analyze(storage.registry, fresh);

  // Store latest data for client
  storage.latestData = {
    fresh,
    registry: storage.registry,
    changes,
    top50Count: storage.initialTop50.length,
  };
}

// Start scanning
app.post("/api/start", (req, res) => {
  const { mint } = req.body;
  if (!mint) return res.status(400).send("Missing token mint");

  storage.tokenMint = mint;
  storage.registry = {};
  storage.initialTop50 = null;
  storage.initialTop50Amounts = new Map();
  storage.previousTop50 = new Set();
  storage.previousTop50MinAmount = 0;
  storage.allTimeNewTop50 = new Set();
  storage.scanning = true;

  if (storage.pollInterval) clearInterval(storage.pollInterval);
  storage.pollInterval = setInterval(pollData, 2000);

  res.send("Scan started");
});

// Stop scanning
app.post("/api/stop", (req, res) => {
  storage.scanning = false;
  if (storage.pollInterval) clearInterval(storage.pollInterval);
  res.send("Scan stopped");
});

// Status endpoint (client polls this)
app.get("/api/status", (req, res) => {
  if (!storage.latestData) {
    return res.json({ message: "No data yet" });
  }
  res.json(storage.latestData);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
