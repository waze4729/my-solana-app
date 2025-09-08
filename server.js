// server.js
import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";

const app = express();
const PORT = process.env.PORT || 3000;
const RPC_ENDPOINT = process.env.RPC_ENDPOINT;

app.use(express.json());
app.use(express.static("public")); // serve static HTML/JS

const connection = new Connection(RPC_ENDPOINT, {
  commitment: "confirmed",
  disableRetryOnRateLimit: false,
});

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
    console.error("Error fetching token accounts from RPC:", e.message || e);
    return [];
  }
}

// API endpoint to scan a token mint
app.post("/api/scan", async (req, res) => {
  const { mint } = req.body;
  if (!mint) return res.status(400).json({ error: "Missing mint address" });

  try {
    const holders = await fetchAllTokenAccounts(mint);
    const total = holders.length;
    const top50 = holders
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 50);

    res.json({ totalHolders: total, top50 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
