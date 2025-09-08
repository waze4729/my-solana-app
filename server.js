import express from "express";
import bodyParser from "body-parser";
import * as solanaWeb3 from "@solana/web3.js";

const { Connection, PublicKey } = solanaWeb3;

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(express.static("public"));

const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const connection = new Connection(RPC_ENDPOINT, { commitment: "confirmed" });

let tokenMint = "";
let pollInterval = null;
let registry = {};

async function fetchAllTokenAccounts(mintAddress) {
  const mintPublicKey = new PublicKey(mintAddress);
  try {
    const accounts = await connection.getParsedProgramAccounts(
      new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      {
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 0, bytes: mintPublicKey.toBase58() } }
        ]
      }
    );
    return accounts.map(acc => {
      const parsed = acc.account.data.parsed;
      return {
        owner: parsed.info.owner,
        amount: Number(parsed.info.tokenAmount.amount) / Math.pow(10, parsed.info.tokenAmount.decimals)
      };
    });
  } catch {
    return [];
  }
}

async function pollData() {
  if (!tokenMint) return {};
  const fresh = await fetchAllTokenAccounts(tokenMint);
  return { fresh };
}

app.post("/api/start", async (req, res) => {
  const { mint } = req.body;
  if (!mint) return res.status(400).json({ error: "Missing token mint" });

  tokenMint = mint;

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => await pollData(), 2000);

  res.json({ message: "Scan started" });
});

app.post("/api/stop", (req, res) => {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
  res.json({ message: "Scan stopped" });
});

app.get("/api/status", async (req, res) => {
  const data = await pollData();
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
