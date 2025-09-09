import express from "express";
import bodyParser from "body-parser";
import * as web3 from "@solana/web3.js";
import fetch from "node-fetch";

const { Connection, PublicKey } = web3;
const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(express.static("public"));

// Server-side storage
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
  startTime: null,
  prices: {
    SOL: 0,
    JUP: 0,
    lastUpdated: null
  }
};

function getSecondsSinceStart() {
  if (!storage.startTime) return 0;
  const now = new Date();
  const diffMs = now - storage.startTime;
  return Math.floor(diffMs / 1000);
}
async function fetchPrices() {
  if (!storage.tokenMint) return;
  try {
    const response = await fetch(
      `https://lite-api.jup.ag/price/v3?ids=${storage.tokenMint},So11111111111111111111111111111111111111112,JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN`
    );
    const data = await response.json();
    // Save all fetched prices keyed by mint
    Object.keys(data).forEach(mint => {
      storage.prices[mint] = parseFloat(data[mint]?.usdPrice || 0);
    });
    storage.prices.lastUpdated = new Date();
  } catch (error) {
    console.error('Error fetching prices:', error.message);
  }
}
function calculateUSDValue(amount, tokenMint) {
  const price = storage.prices[tokenMint];
  if (price && amount) {
    return amount * price;
  }
  return 0;
}
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
      const amount = Number(parsed.info.tokenAmount.amount) / Math.pow(10, parsed.info.tokenAmount.decimals);
      return {
        address: acc.pubkey.toBase58(),
        owner: parsed.info.owner,
        amount: amount,
        usdValue: calculateUSDValue(amount, mintAddress)
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

async function analyzeTop50(fresh, initialTop50, initialTop50Amounts, previousTop50, previousTop50MinAmount) {
  if (!initialTop50 || initialTop50.length === 0) return null;

  // Get current top 50 owners
  const sorted = fresh.slice().sort((a, b) => b.amount - a.amount);
  const currentTop50 = sorted.slice(0, 50).map(h => h.owner);
  const currentTop50Map = new Map(sorted.slice(0, 50).map(h => [h.owner, h.amount]));
  const currentTop50MinAmount = sorted[49]?.amount || 0;

  // Completely new since last fetch:
  const newSinceLastFetch = currentTop50.filter(owner => 
    !previousTop50.has(owner) && 
    (currentTop50Map.get(owner) > previousTop50MinAmount)
  );

  // Completely new since first fetch
  const newSinceFirstFetch = currentTop50.filter(owner => 
    storage.allTimeNewTop50.has(owner)
  ).length;

  // Add new holders to persistent set
  newSinceLastFetch.forEach(owner => {
    storage.allTimeNewTop50.add(owner);
  });

  // How many of the original top 50 are still in top 50 now?
  const stillInTop50 = initialTop50.filter(owner => currentTop50.includes(owner));
  // How many of the original top 50 are now gone?
  const goneFromInitialTop50 = initialTop50.filter(owner => !currentTop50.includes(owner));
  // How many in the current top 50 were not in the original top 50?
  const newInTop50 = currentTop50.filter(owner => !initialTop50.includes(owner));

  // Calculate sales and purchases from Top 50
  const top50Sales = {
    sold100: 0,
    sold50: 0,
    sold25: 0,
  };

  const top50Buys = {
    bought100: 0,
    bought50: 0,
    bought25: 0,
    bought10: 0,
  };

  // Check each original top 50 holder
  for (const owner of initialTop50) {
    const initialAmount = initialTop50Amounts.get(owner);
    const currentAmount = currentTop50Map.get(owner) || 0;
    
    if (currentAmount === 0) {
      top50Sales.sold100++;
    } else {
      const changePct = ((currentAmount - initialAmount) / initialAmount) * 100;
      
      if (changePct <= -50) {
        top50Sales.sold50++;
      } else if (changePct <= -25) {
        top50Sales.sold25++;
      } else if (changePct >= 100) {
        top50Buys.bought100++;
      } else if (changePct >= 50) {
        top50Buys.bought50++;
      } else if (changePct >= 25) {
        top50Buys.bought25++;
      } else if (changePct >= 10) {
        top50Buys.bought10++;
      }
    }
  }

  // Update previous top 50 tracking for next run
  storage.previousTop50 = new Set(currentTop50);
  storage.previousTop50MinAmount = currentTop50MinAmount;

  return {
    currentTop50Count: currentTop50.length,
    stillInTop50Count: stillInTop50.length,
    goneFromInitialTop50Count: goneFromInitialTop50.length,
    newInTop50Count: newInTop50.length,
    completelyNewSinceLastFetch: newSinceLastFetch.length,
    completelyNewSinceFirstFetch: newSinceFirstFetch,
    top50Sales,
    top50Buys,
  };
}

async function pollData() {
  if (!storage.tokenMint || !storage.scanning) return;
  
  try {
    const fresh = await fetchAllTokenAccounts(storage.tokenMint);

    if (!storage.initialTop50) {
      const sorted = fresh.slice().sort((a, b) => b.amount - a.amount);
      storage.initialTop50 = sorted.slice(0, 50).map(h => h.owner);
      sorted.slice(0, 50).forEach(h => storage.initialTop50Amounts.set(h.owner, h.amount));
      storage.previousTop50 = new Set(storage.initialTop50);
      storage.previousTop50MinAmount = sorted[49]?.amount || 0;
    }

    const changes = analyze(storage.registry, fresh);
    const top50Stats = await analyzeTop50(
      fresh, 
      storage.initialTop50, 
      storage.initialTop50Amounts,
      storage.previousTop50,
      storage.previousTop50MinAmount
    );

    // Store latest data for client
    storage.latestData = {
      fresh,
      registry: storage.registry,
      changes,
      top50Stats,
      top50Count: storage.initialTop50.length,
      timeRunning: getSecondsSinceStart(),
      startTime: storage.startTime,
      prices: storage.prices,
      tokenMint: storage.tokenMint
    };
    
    console.log(`Scan completed at ${new Date().toLocaleTimeString()} - ${changes.current} holders`);
  } catch (error) {
    console.error("Error in pollData:", error.message);
  }
}

// Start scanning
app.post("/api/start", async (req, res) => {
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
  storage.startTime = new Date();

  if (storage.pollInterval) clearInterval(storage.pollInterval);
  
  // Fetch prices immediately
  await fetchPrices();
  
  // Start polling every 1 second (1000ms)
  storage.pollInterval = setInterval(pollData, 1000);
  
  // Update prices every 30 seconds
  setInterval(fetchPrices, 30000);
  
  // Do an immediate scan
  pollData();

  res.send("Scan started - polling every 1 second");
});

// Stop scanning
app.post("/api/stop", (req, res) => {
  storage.scanning = false;
  if (storage.pollInterval) {
    clearInterval(storage.pollInterval);
    storage.pollInterval = null;
  }
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
  console.log(`Scan interval: 1 second`);
});


