import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { fetchAllTokenAccounts, analyze } from "./solana.js";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.post("/api/scan", async (req, res) => {
  try {
    const { tokenMint } = req.body;
    if (!tokenMint) return res.status(400).json({ error: "tokenMint required" });

    const fresh = await fetchAllTokenAccounts(tokenMint);
    const stats = analyze(fresh);

    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
