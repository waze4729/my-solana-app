import express from "express";
import bodyParser from "body-parser";
import { Connection, PublicKey } from "@solana/web3.js";

const app = express();
app.use(bodyParser.json());

const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const connection = new Connection(RPC_ENDPOINT, { commitment: "confirmed" });

// In-memory state for Top50 tracking
let initialTop50 = null;
let initialTop50Amounts = new Map();
let previousTop50 = new Set();
let previousTop50MinAmount = 0;

async function fetchAllTokenAccounts(mintAddress) {
  const mintPublicKey = new PublicKey(mintAddress);
  const filters = [
    { dataSize: 165 },
    { memcmp: { offset: 0, bytes: mintPublicKey.toBase58() } },
  ];
  const accounts = await connection.getParsedProgramAccounts(
    new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    { filters }
  );
  return accounts
    .map(acc => {
      const parsed = acc.account.data.parsed;
      return {
        address: acc.pubkey.toBase58(),
        owner: parsed.info.owner,
        amount: Number(parsed.info.tokenAmount.amount) / Math.pow(10, parsed.info.tokenAmount.decimals),
      };
    })
    .filter(a => a.amount > 0);
}

function analyzeTop50(fresh) {
  const sorted = fresh.slice().sort((a,b) => b.amount - a.amount);
  const currentTop50 = sorted.slice(0,50).map(h => h.owner);
  const currentTop50Map = new Map(sorted.slice(0,50).map(h => [h.owner, h.amount]));
  const currentTop50MinAmount = sorted[49]?.amount || 0;

  if (!initialTop50) {
    // first call: initialize
    initialTop50 = currentTop50;
    sorted.slice(0,50).forEach(h => initialTop50Amounts.set(h.owner, h.amount));
  }

  // simple Top50 stats
  const stillInTop50 = initialTop50.filter(o => currentTop50.includes(o)).length;
  const goneFromInitialTop50 = initialTop50.filter(o => !currentTop50.includes(o)).length;
  const newInTop50 = currentTop50.filter(o => !initialTop50.includes(o)).length;

  // Update previous
  previousTop50 = new Set(currentTop50);
  previousTop50MinAmount = currentTop50MinAmount;

  return {
    currentTop50Count: currentTop50.length,
    stillInTop50Count: stillInTop50,
    goneFromInitialTop50Count: goneFromInitialTop50,
    newInTop50Count: newInTop50,
    top50: sorted.slice(0,50)
  };
}

app.post("/api/scan", async (req,res) => {
  const { mint } = req.body;
  if (!mint) return res.status(400).json({ error: "Mint is required" });

  try {
    const holders = await fetchAllTokenAccounts(mint);
    const top50Stats = analyzeTop50(holders);
    res.json({ totalHolders: holders.length, ...top50Stats });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(10000, () => console.log("Server running on port 10000"));
