import { Connection, PublicKey } from "@solana/web3.js";
import { readFile, writeFile } from "fs/promises";
import { setTimeout } from "timers/promises";

// CONFIG
const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const TOKEN_MINT = "6xhkDDydGj5o1sFXrW7Tt493g3BnaVHnEh2Cs7R6pump";
const REGISTRY_FILE = `${TOKEN_MINT}_holder_registry.json`;
const HISTORY_FILE = `${TOKEN_MINT}_holder_history.json`;
const POLL_INTERVAL_MS = 1300;

let shouldExit = false;

// Tracking state
let initialTop50 = null;
let initialTop50Amounts = new Map();
let previousTop50 = new Set();
let previousTop50MinAmount = 0;
let allTimeNewTop50 = new Set();

// Store start time
const startTime = new Date();

process.on("SIGINT", () => {
  console.log("\nGracefully shutting down... (Ctrl+C pressed)");
  shouldExit = true;
});

const connection = new Connection(RPC_ENDPOINT, {
  commitment: "confirmed",
  disableRetryOnRateLimit: false,
});

function getSecondsSinceStart() {
  const now = new Date();
  const diffMs = now - startTime;
  return Math.floor(diffMs / 1000);
}

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
          amount: Number(parsed.info.tokenAmount.amount) / Math.pow(10, parsed.info.tokenAmount.decimals),
        };
      })
      .filter((a) => a.amount > 0);
  } catch (e) {
    console.error("Error fetching token accounts from RPC:", e.message || e);
    return [];
  }
}

async function loadRegistry() {
  try {
    const data = await readFile(REGISTRY_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function loadHistory() {
  try {
    const data = await readFile(HISTORY_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { allTimeNewTop50: [] };
  }
}

async function saveRegistry(registry) {
  await writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

async function saveHistory(history) {
  await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
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

      if (Math.abs(changePct) < 10) {
        changes.unchanged++;
      } else if (changePct > 0) {
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
      if (info.baseline > 0 && info.current !== 0) {
        info.current = 0;
      }
      if (info.baseline > 0 && info.current === 0) {
        changes.sold100++;
      }
    }
    changes.total++;
  }

  for (const { owner, amount } of fresh) {
    if (!registry[owner]) {
      registry[owner] = {
        baseline: amount,
        current: amount,
        lastSeen: now,
      };
      changes.total++;
      changes.current++;
      changes.unchanged++;
    }
  }

  return changes;
}

async function analyzeTop50(fresh, initialTop50) {
  // Get current top 50 owners
  const sorted = fresh.slice().sort((a, b) => b.amount - a.amount);
  const currentTop50 = sorted.slice(0, 50).map(h => h.owner);
  const currentTop50Map = new Map(sorted.slice(0, 50).map(h => [h.owner, h.amount]));
  const currentTop50MinAmount = sorted[49]?.amount || 0;

  // Load historical data
  const history = await loadHistory();
  const persistentNewTop50 = new Set(history.allTimeNewTop50 || []);

  // Completely new since last fetch:
  // 1. Not in previous top 50
  // 2. Have more than previous top 50 minimum amount
  const newSinceLastFetch = currentTop50.filter(owner => 
    !previousTop50.has(owner) && 
    (currentTop50Map.get(owner) > previousTop50MinAmount)
  );

  // Add these to our persistent set
  newSinceLastFetch.forEach(owner => {
    persistentNewTop50.add(owner);
    allTimeNewTop50.add(owner);
  });

  // Save the updated history
  await saveHistory({ allTimeNewTop50: Array.from(persistentNewTop50) });

  // Completely new since first fetch (from persistent storage)
  const newSinceFirstFetch = currentTop50.filter(owner => 
    persistentNewTop50.has(owner)
  ).length;

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
  previousTop50 = new Set(currentTop50);
  previousTop50MinAmount = currentTop50MinAmount;

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

function printStats(changes, top50Stats) {
  console.clear();
  console.log("=== LIVE HOLDER ANALYSIS ===");
  console.log(`Started at:              ${startTime.toLocaleString()}`);
  console.log(`Time running:            ${getSecondsSinceStart()} seconds`);
  console.log(`Current holders:         ${changes.current}`);
  console.log(`Total ever tracked:      ${changes.total}`);
  console.log(`Unchanged:               ${changes.unchanged}`);
  for (let pct = 10; pct <= 100; pct += 10) {
    console.log(`Bought >${pct}% more:        ${changes[`bought${pct}`]}`);
  }
  for (let pct = 10; pct <= 100; pct += 10) {
    console.log(`Sold >${pct}%:               ${changes[`sold${pct}`]}`);
  }
  console.log(`Sold 100% (zeroed):      ${changes.sold100}`);
  
  if (top50Stats) {
    console.log("---");
    console.log(`Top 50 HOLDERS Analysis:`);
    console.log(`Still in top 50 HOLDERS:             ${top50Stats.stillInTop50Count}`);
    console.log(`Gone from original top 50 HOLDERS:   ${top50Stats.goneFromInitialTop50Count}`);
    console.log(`New in top 50 HOLDERS:               ${top50Stats.newInTop50Count}`);
    console.log(`Completely new TOP50 HOLDERS since last fetch:      ${top50Stats.completelyNewSinceLastFetch}`);
    console.log(`Completely new TOP50 HOLDERS since first fetch:     ${top50Stats.completelyNewSinceFirstFetch}`);
    
    console.log("---");
    console.log("TOP 50 HOLDERS SALES:");
    console.log(`Sold 100% (dumped all):      ${top50Stats.top50Sales.sold100}`);
    console.log(`Sold >50%:                   ${top50Stats.top50Sales.sold50}`);
    console.log(`Sold >25%:                   ${top50Stats.top50Sales.sold25}`);
    
    console.log("---");
    console.log("TOP 50 HOLDERS PURCHASES:");
    console.log(`Bought >100% more:           ${top50Stats.top50Buys.bought100}`);
    console.log(`Bought >50% more:            ${top50Stats.top50Buys.bought50}`);
    console.log(`Bought >25% more:            ${top50Stats.top50Buys.bought25}`);
    console.log(`Bought >10% more:            ${top50Stats.top50Buys.bought10}`);
  }
  console.log("Updated at:              " + new Date().toLocaleTimeString());
}

async function loop() {
  let registry = await loadRegistry();
  const history = await loadHistory();
  allTimeNewTop50 = new Set(history.allTimeNewTop50 || []);
  
  // Print initial start message
  console.log(`=== LIVE HOLDER ANALYSIS STARTED ===`);
  console.log(`Start time: ${startTime.toLocaleString()}`);
  console.log(`Token: ${TOKEN_MINT}`);
  console.log(`Polling every: ${POLL_INTERVAL_MS}ms`);
  console.log("=".repeat(40));
  
  await setTimeout(2000); // Brief pause before starting the loop
  
  while (true) {
    if (shouldExit) {
      await saveRegistry(registry);
      console.log("Registry saved. Exiting.");
      process.exit(0);
    }
    try {
      const fresh = await fetchAllTokenAccounts(TOKEN_MINT);

      if (!initialTop50) {
        // On first fetch only, set the initialTop50 and their amounts
        const sorted = fresh.slice().sort((a, b) => b.amount - a.amount);
        initialTop50 = sorted.slice(0, 50).map(h => h.owner);
        sorted.slice(0, 50).forEach(h => initialTop50Amounts.set(h.owner, h.amount));
        console.log("Initial Top 50 snapshot saved in memory.");
        
        // Initialize previous top 50 tracking
        previousTop50 = new Set(initialTop50);
        previousTop50MinAmount = sorted[49]?.amount || 0;
      }

      const changes = analyze(registry, fresh);
      const top50Stats = await analyzeTop50(fresh, initialTop50);

      await saveRegistry(registry);
      printStats(changes, top50Stats);
    } catch (e) {
      console.error("Error during fetch/analyze:", e.message || e);
      await setTimeout(POLL_INTERVAL_MS * 2);
    }
    await setTimeout(POLL_INTERVAL_MS);
  }
}

loop(); 

