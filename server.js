import fs from 'fs';
import bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const MNEMONIC_COUNT = 3; // how many mnemonics with activity to find
const OUTPUT_FILE = 'mnemonics_with_active_pubkeys.json';
const BASE_DELAY_MS = 769;
const ACCOUNTS_TO_CHECK = 3; // Check the first 3 accounts

// Function to generate random mnemonic of either 12 or 24 words
function generateRandomMnemonic() {
  const use12Words = Math.random() > 0.5; // 50% chance for 12 or 24 words
  const entropySize = use12Words ? 16 : 32; // 128 bits for 12-word, 256 bits for 24-word
  const entropy = crypto.randomBytes(entropySize);
  return bip39.entropyToMnemonic(entropy.toString('hex'));
}

// Function to derive Solana public key from mnemonic and path
async function deriveSolanaPublicKey(mnemonic, path) {
  try {
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const { key } = derivePath(path, seed.toString('hex'));
    const keypair = Keypair.fromSeed(key);
    return keypair.publicKey.toBase58();
  } catch (error) {
    console.error(`Error deriving key for path ${path}: ${error.message}`);
    return null;
  }
}

// Function to check all derivation paths for a mnemonic
async function checkAllDerivationPaths(mnemonic) {
  const paths = [
    "m/44'/501'", // Base path
    "m/44'/501'/0'", // With account index
    "m/44'/501'/0'/0'" // With account and change indices
  ];
  
  const results = {};
  
  for (const path of paths) {
    const pubkey = await deriveSolanaPublicKey(mnemonic, path);
    if (pubkey) {
      results[path] = pubkey;
    }
    // Add a small delay between derivations
    await new Promise(r => setTimeout(r, 100));
  }
  
  return results;
}

async function checkPubkeyActivity(pubkey) {
  while (true) {
    try {
      console.log(`Checking pubkey: ${pubkey}`);
      const resp = await fetch(RPC_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignaturesForAddress",
          params: [pubkey, { limit: 1 }]
        }),
      });
      if (resp.status === 429) {
        console.log(`Rate limited (429). Retrying after ${BASE_DELAY_MS}ms...`);
        await new Promise(r => setTimeout(r, BASE_DELAY_MS));
        continue;
      }
      const result = await resp.json();
      return result && result.result && Array.isArray(result.result) && result.result.length > 0;
    } catch (e) {
      console.error(`Fetch error: ${e.message} - Retrying in ${BASE_DELAY_MS}ms`);
      await new Promise(r => setTimeout(r, BASE_DELAY_MS));
    }
  }
}

async function checkCUFActivity() {
  const pubkey = "CUF8P851rexvZuxspPcLhEKAzGH6bWNdhvSv3P9Sxcpv";
  const active = await checkPubkeyActivity(pubkey);
  console.log(`check cuf activity ${active ? "yes" : "no"}`);
  return active;
}

async function main() {
  // Check CUF address first
  if (!(await checkCUFActivity())) return;

  const output = [];
  let generated = 0;
  let found = 0;

  while (output.length < MNEMONIC_COUNT) {
    const mnemonic = generateRandomMnemonic();
    const wordCount = mnemonic.split(' ').length;
    console.log(`\nChecking ${wordCount}-word mnemonic: "${mnemonic}"`);
    
    // Get all derivation paths for this mnemonic
    const derivedKeys = await checkAllDerivationPaths(mnemonic);
    console.log("Derived keys:", derivedKeys);
    
    let activePubkeys = [];
    
    // Check activity for each derived public key
    for (const [path, pubkey] of Object.entries(derivedKeys)) {
      const active = await checkPubkeyActivity(pubkey);
      if (active) {
        activePubkeys.push({path, pubkey});
      }
      await new Promise(r => setTimeout(r, BASE_DELAY_MS));
    }
    
    generated++;
    if (activePubkeys.length > 0) {
      found++;
      output.push({ 
        mnemonic, 
        wordCount,
        activeKeys: activePubkeys 
      });
      console.log(`Mnemonic with activity found: ${mnemonic}`);
    }
    console.log(`Generated: ${generated}, Found with activity: ${found}`);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Done! Saved ${output.length} mnemonics with active pubkeys to ${OUTPUT_FILE}`);
}

main();
