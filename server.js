const { Connection, PublicKey } = require("@solana/web3.js");
const express = require("express");
const WebSocket = require("ws");

// CONFIG
const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const TOKEN_MINT = "8KK76tofUfbe7pTh1yRpbQpTkYwXKUjLzEBtAUTwpump";
const SPIN_INTERVAL = 30 * 1000;
const REWARDS_WALLET = "7h334Q4r5izKUHzxR8DtuTCYUL8c1YNF7Udfw9kTMM9z";

let cache = {
    holders: [],
    spinHistory: [],
    jokerWallets: new Map(),
    jokerBonusWinners: [],
    lastSpinTime: Date.now(),
    nextSpinTime: Date.now() + SPIN_INTERVAL,
    isSpinning: false,
    rewardsTransactions: [],
    megaJackpotStart: Date.now(),
    megaJackpotAmount: 0,
    currentWinner: null
};

let connection = new Connection(RPC_ENDPOINT);
const app = express();
const wss = new WebSocket.Server({ noServer: true });

app.use(express.static('public'));
app.use(express.json());

async function getHolders() {
    try {
        const accounts = await connection.getParsedProgramAccounts(
            new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            {
                filters: [
                    { dataSize: 165 },
                    { memcmp: { offset: 0, bytes: TOKEN_MINT } },
                ]
            }
        );
        
        const allHolders = accounts.map(acc => ({
            address: acc.pubkey.toBase58(),
            owner: acc.account.data.parsed.info.owner,
            amount: Number(acc.account.data.parsed.info.tokenAmount.amount)
        })).filter(h => h.amount > 0);
        
        const totalSupply = allHolders.reduce((sum, h) => sum + h.amount, 0);
        
        cache.holders = allHolders.filter(holder => {
            const percentage = (holder.amount / totalSupply) * 100;
            return percentage >= 0.01 && percentage <= 5;
        });
        
        console.log(`Updated ${cache.holders.length} eligible holders`);
    } catch (e) {
        console.error("Error:", e.message);
    }
}

async function getRewardsTransactions() {
    try {
        const signatures = await connection.getSignaturesForAddress(
            new PublicKey(REWARDS_WALLET),
            { limit: 50 }
        );

        const transactions = [];
        
        for (const signatureInfo of signatures) {
            try {
                const tx = await connection.getTransaction(signatureInfo.signature, {
                    maxSupportedTransactionVersion: 0
                });
                
                if (tx && tx.meta && tx.transaction && tx.transaction.message) {
                    const accountKeys = tx.transaction.message.accountKeys;
                    if (!accountKeys || accountKeys.length === 0) continue;
                    
                    const feePayer = accountKeys[0]?.pubkey?.toString();
                    if (!feePayer) continue;
                    
                    if (feePayer === REWARDS_WALLET) {
                        const transfer = {
                            signature: signatureInfo.signature,
                            timestamp: new Date(signatureInfo.blockTime * 1000).toLocaleString(),
                            from: REWARDS_WALLET,
                            to: null,
                            amount: 0,
                            success: !tx.meta.err
                        };
                        
                        const instructions = tx.transaction.message.instructions;
                        if (instructions) {
                            for (const instruction of instructions) {
                                if (instruction.programId && instruction.programId.toString() === '11111111111111111111111111111111') {
                                    if (instruction.parsed && instruction.parsed.type === 'transfer') {
                                        if (instruction.parsed.info && instruction.parsed.info.source === REWARDS_WALLET) {
                                            transfer.to = instruction.parsed.info.destination;
                                            transfer.amount = instruction.parsed.info.lamports / 1e9;
                                        }
                                    }
                                }
                            }
                        }
                        
                        if (transfer.to) {
                            transactions.push(transfer);
                        }
                    }
                }
            } catch (error) {
                console.log('Error fetching transaction details:', error.message);
            }
        }
        
        cache.rewardsTransactions = transactions;
    } catch (e) {
        console.error("Error fetching rewards transactions:", e.message);
    }
}

function calculateMegaJackpot() {
    const now = Date.now();
    const timePassed = now - cache.megaJackpotStart;
    const minutesPassed = Math.floor(timePassed / (60 * 1000));
    cache.megaJackpotAmount = minutesPassed;
    return cache.megaJackpotAmount;
}

function getMegaJackpotTime() {
    const endTime = cache.megaJackpotStart + (48 * 60 * 60 * 1000);
    const timeLeft = endTime - Date.now();
    return Math.max(0, timeLeft);
}

function spinWheel() {
    if (cache.holders.length === 0) return null;
    
    const randomIndex = Math.floor(Math.random() * cache.holders.length);
    const winnerHolder = cache.holders[randomIndex];
    
    if (!winnerHolder) return null;
    
    const getsJoker = true;
    let jokerCount = cache.jokerWallets.get(winnerHolder.owner) || 0;
    jokerCount++;
    cache.jokerWallets.set(winnerHolder.owner, jokerCount);
    
    let isNewBonusWinner = false;
    if (jokerCount === 3) {
        if (!cache.jokerBonusWinners.includes(winnerHolder.owner)) {
            cache.jokerBonusWinners.push(winnerHolder.owner);
            isNewBonusWinner = true;
        }
    }
    
    const winner = {
        address: winnerHolder.owner,
        tokens: winnerHolder.amount,
        time: new Date().toLocaleString(),
        percentage: (winnerHolder.amount / cache.holders.reduce((sum, h) => sum + h.amount, 0) * 100).toFixed(4),
        gotJoker: getsJoker,
        jokerCount: jokerCount,
        isJokerBonus: jokerCount === 3,
        isNewBonusWinner: isNewBonusWinner
    };
    
    cache.spinHistory.unshift(winner);
    cache.currentWinner = winner;
    if (cache.spinHistory.length > 50) cache.spinHistory.pop();
    
    cache.lastSpinTime = Date.now();
    cache.nextSpinTime = cache.lastSpinTime + SPIN_INTERVAL;
    
    console.log(`🎉 WINNER: ${winner.address.slice(0, 8)}...`);
    
    return winner;
}

function autoSpin() {
    if (!cache.isSpinning && cache.holders.length > 0) {
        cache.isSpinning = true;
        const winner = spinWheel();
        
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'SPIN_START',
                    data: { isSpinning: true }
                }));
                
                setTimeout(() => {
                    client.send(JSON.stringify({
                        type: 'SPIN_RESULT',
                        data: { 
                            winner: winner,
                            spinHistory: cache.spinHistory,
                            jokerWallets: Array.from(cache.jokerWallets.entries()),
                            jokerBonusWinners: cache.jokerBonusWinners,
                            nextSpinTime: cache.nextSpinTime,
                            timeUntilNextSpin: Math.max(0, Math.floor((cache.nextSpinTime - Date.now()) / 1000)),
                            megaJackpotAmount: calculateMegaJackpot(),
                            megaJackpotTimeLeft: getMegaJackpotTime(),
                            totalHolders: cache.holders.length,
                            totalTokens: cache.holders.reduce((sum, h) => sum + h.amount, 0),
                            jokerCount: cache.jokerWallets.size
                        }
                    }));
                }, 4000);
            }
        });
        
        setTimeout(() => {
            cache.isSpinning = false;
        }, 5000);
    }
}

wss.on('connection', function connection(ws) {
    console.log('Client connected via WebSocket');
    
    ws.send(JSON.stringify({
        type: 'INIT',
        data: {
            holders: cache.holders,
            spinHistory: cache.spinHistory,
            jokerWallets: Array.from(cache.jokerWallets.entries()),
            jokerBonusWinners: cache.jokerBonusWinners,
            rewardsTransactions: cache.rewardsTransactions,
            nextSpinTime: cache.nextSpinTime,
            timeUntilNextSpin: Math.max(0, Math.floor((cache.nextSpinTime - Date.now()) / 1000)),
            isSpinning: cache.isSpinning,
            megaJackpotAmount: calculateMegaJackpot(),
            megaJackpotTimeLeft: getMegaJackpotTime(),
            totalHolders: cache.holders.length,
            totalTokens: cache.holders.reduce((sum, h) => sum + h.amount, 0),
            jokerCount: cache.jokerWallets.size
        }
    }));

    const interval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'UPDATE',
                data: {
                    nextSpinTime: cache.nextSpinTime,
                    timeUntilNextSpin: Math.max(0, Math.floor((cache.nextSpinTime - Date.now()) / 1000)),
                    megaJackpotAmount: calculateMegaJackpot(),
                    megaJackpotTimeLeft: getMegaJackpotTime(),
                    isSpinning: cache.isSpinning
                }
            }));
        }
    }, 1000);

    ws.on('close', function close() {
        console.log('Client disconnected');
        clearInterval(interval);
    });
});

app.get("/", (req, res) => {
    const timeUntilNextSpin = Math.max(0, Math.floor((cache.nextSpinTime - Date.now()) / 1000));
    const megaJackpotAmount = calculateMegaJackpot();
    const megaJackpotTimeLeft = getMegaJackpotTime();
    const megaJackpotHours = Math.floor(megaJackpotTimeLeft / (1000 * 60 * 60));
    const megaJackpotMinutes = Math.floor((megaJackpotTimeLeft % (1000 * 60 * 60)) / (1000 * 60));
    
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>🎡POWERPUMP WHEEL OF HOLDERS🎡</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Arial Black', Arial, sans-serif; 
            background: linear-gradient(135deg, #0a0a2a, #1a1a4a);
            color: white;
            min-height: 100vh;
        }
        .powerball-header {
            text-align: center;
            padding: 10px;
            background: linear-gradient(45deg, #ff0000, #ff6b00);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            font-size: 2.5em;
            text-shadow: 0 0 30px rgba(255, 107, 0, 0.5);
            margin-bottom: 10px;
        }
        .main-container {
            display: grid;
            grid-template-columns: 1fr 500px 1fr;
            gap: 15px;
            height: calc(100vh - 250px);
            padding: 0 15px;
        }
        .panel {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 15px;
            padding: 15px;
            backdrop-filter: blur(10px);
            border: 2px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .panel-title {
            color: #ffd700;
            text-align: center;
            margin-bottom: 15px;
            font-size: 1.3em;
            border-bottom: 2px solid rgba(255, 215, 0, 0.3);
            padding-bottom: 8px;
        }
        .wheel-container {
            position: relative;
            width: 400px;
            height: 400px;
            margin: 0 auto;
        }
        .wheel {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: linear-gradient(45deg, #ff0000, #ff6b00, #ffd700, #00ff88, #0066ff);
            position: relative;
            overflow: hidden;
            border: 8px solid #ffd700;
            box-shadow: 0 0 30px rgba(255, 215, 0, 0.5);
            transition: transform 0.5s ease-out;
        }
        .wheel-spinning {
            animation: spin 0.15s linear infinite;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .wheel-slice {
            position: absolute;
            width: 50%;
            height: 50%;
            transform-origin: 100% 100%;
            left: 0;
            top: 0;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            padding-left: 40px;
            font-size: 10px;
            font-weight: bold;
            color: white;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
            overflow: hidden;
        }
        .wheel-slice:nth-child(odd) {
            background: rgba(255, 0, 0, 0.6);
        }
        .wheel-slice:nth-child(even) {
            background: rgba(255, 107, 0, 0.6);
        }
        .wheel-center {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 60px;
            height: 60px;
            background: radial-gradient(circle, #ff0000, #8b0000);
            border-radius: 50%;
            transform: translate(-50%, -50%);
            box-shadow: 0 0 20px rgba(255, 0, 0, 0.8);
            z-index: 10;
            border: 4px solid #ffd700;
        }
        .wheel-pointer {
            position: absolute;
            top: -30px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 20px solid transparent;
            border-right: 20px solid transparent;
            border-top: 40px solid #ffd700;
            filter: drop-shadow(0 0 10px gold);
            z-index: 100;
        }
        .current-winner {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.9);
            padding: 15px;
            border-radius: 12px;
            text-align: center;
            z-index: 50;
            border: 2px solid #ffd700;
            min-width: 150px;
            font-size: 0.9em;
        }
        .winner-address {
            font-family: monospace;
            color: #ffd700;
            margin-bottom: 5px;
            word-break: break-all;
        }
        .winner-stats {
            font-size: 0.8em;
            color: #00ff88;
        }
        .joker-indicator {
            color: #ff00ff;
            font-weight: bold;
            text-shadow: 0 0 10px #ff00ff;
        }
        .mega-jackpot {
            background: linear-gradient(45deg, #ff0000, #ff6b00);
            padding: 15px;
            margin: 10px 0;
            border-radius: 15px;
            text-align: center;
            border: 3px solid #ffd700;
            box-shadow: 0 0 30px rgba(255, 107, 0, 0.5);
        }
        .mega-jackpot-title {
            font-size: 1.5em;
            font-weight: bold;
            margin-bottom: 10px;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.8);
        }
        .mega-jackpot-amount {
            font-size: 2.5em;
            font-weight: bold;
            color: #ffd700;
            text-shadow: 0 0 20px rgba(255, 215, 0, 0.8);
            margin: 10px 0;
        }
        .mega-jackpot-timer {
            font-size: 1.2em;
            color: white;
            margin: 10px 0;
        }
        .holders-list, .history-list {
            flex: 1;
            overflow-y: auto;
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
            padding-right: 5px;
        }
        .holder-card, .history-item {
            background: rgba(255, 255, 255, 0.05);
            padding: 10px;
            border-radius: 8px;
            border-left: 3px solid #ff6b00;
            font-size: 0.85em;
        }
        .history-item {
            border-left: 3px solid #ff0000;
        }
        .holder-address {
            font-family: monospace;
            margin-bottom: 3px;
        }
        .holder-tokens {
            color: #ffd700;
            font-size: 0.8em;
        }
        .joker-badge {
            background: #ff00ff;
            color: white;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 0.7em;
            margin-right: 5px;
            box-shadow: 0 0 10px #ff00ff;
        }
        .joker-bonus-badge {
            background: linear-gradient(45deg, #ff00ff, #00ffff);
            color: white;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 0.8em;
            margin-right: 5px;
            box-shadow: 0 0 15px #ff00ff;
            animation: glow 1s infinite alternate;
        }
        @keyframes glow {
            from { box-shadow: 0 0 10px #ff00ff; }
            to { box-shadow: 0 0 20px #00ffff, 0 0 30px #ff00ff; }
        }
        .joker-bonus-section {
            background: rgba(255, 0, 255, 0.1);
            border: 2px solid #ff00ff;
            margin-top: 10px;
            padding: 10px;
            border-radius: 10px;
        }
        .joker-bonus-title {
            color: #ff00ff;
            text-align: center;
            font-size: 1.1em;
            margin-bottom: 8px;
            text-shadow: 0 0 10px #ff00ff;
        }
        .joker-bonus-item {
            background: rgba(255, 0, 255, 0.2);
            padding: 8px;
            border-radius: 6px;
            margin: 5px 0;
            font-size: 0.8em;
            border-left: 3px solid #00ffff;
        }
        .countdown {
            font-size: 1.2em;
            text-align: center;
            color: #ffd700;
            margin: 10px 0;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }
        .stats-bar {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 10px;
            padding: 0 15px 10px 15px;
        }
        .stat-card {
            background: rgba(255, 255, 255, 0.1);
            padding: 12px;
            border-radius: 10px;
            text-align: center;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .stat-number {
            font-size: 1.5em;
            font-weight: bold;
            color: #ffd700;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }
        .stat-label {
            font-size: 0.8em;
            color: #ccc;
            margin-top: 3px;
        }
        .joker-stat {
            color: #ff00ff;
            text-shadow: 0 0 10px rgba(255, 0, 255, 0.5);
        }
        .joker-wallets-row {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            justify-content: center;
            margin-top: 10px;
            max-height: 80px;
            overflow-y: auto;
        }
        .joker-wallet-item {
            background: rgba(255, 0, 255, 0.2);
            padding: 8px 12px;
            border-radius: 20px;
            font-size: 0.8em;
            border: 1px solid #ff00ff;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .joker-wallet-jokers {
            background: #ff00ff;
            color: white;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.7em;
            font-weight: bold;
        }
        .rewards-section {
            background: rgba(0, 255, 136, 0.1);
            border: 2px solid #00ff88;
            margin: 20px;
            padding: 20px;
            border-radius: 15px;
            max-height: 300px;
            overflow-y: auto;
        }
        .rewards-title {
            color: #00ff88;
            text-align: center;
            font-size: 1.5em;
            margin-bottom: 15px;
            text-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
        }
        .rewards-item {
            background: rgba(0, 255, 136, 0.1);
            padding: 10px;
            border-radius: 8px;
            margin: 8px 0;
            border-left: 3px solid #00ff88;
            font-size: 0.8em;
        }
        .rewards-success {
            color: #00ff88;
            font-weight: bold;
        }
        .rewards-failed {
            color: #ff0000;
            font-weight: bold;
        }
        a {
            color: #00ff88;
            text-decoration: none;
            transition: color 0.3s;
        }
        a:hover {
            color: #ffd700;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }
        .winner-popup {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(45deg, #ff0000, #ff6b00);
            padding: 30px;
            border-radius: 20px;
            text-align: center;
            z-index: 1000;
            box-shadow: 0 0 60px rgba(255, 0, 0, 0.9);
            animation: popup 0.5s ease-out;
            border: 4px solid #ffd700;
            max-width: 400px;
        }
        @keyframes popup {
            from { transform: translate(-50%, -50%) scale(0); opacity: 0; }
            to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        ::-webkit-scrollbar {
            width: 6px;
        }
        ::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(255, 215, 0, 0.5);
            border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 215, 0, 0.7);
        }
    </style>
</head>
<body>
    <h1 class="powerball-header">🎡 POWERBALL WHEEL 🎡</h1>
    
    <div class="stats-bar">
        <div class="stat-card">
            <div class="stat-number" id="total-holders">${cache.holders.length}</div>
            <div class="stat-label">TOTAL HOLDERS</div>
        </div>
        <div class="stat-card">
            <div class="stat-number" id="total-supply">${cache.holders.reduce((sum, h) => sum + h.amount, 0).toLocaleString()}</div>
            <div class="stat-label">TOTAL TOKENS</div>
        </div>
        <div class="stat-card">
            <div class="stat-number" id="last-winner">${cache.spinHistory.length > 0 ? cache.spinHistory[0].address.slice(0, 4) + '...' + cache.spinHistory[0].address.slice(-4) : '-'}</div>
            <div class="stat-label">LAST WINNER</div>
        </div>
        <div class="stat-card">
            <div class="stat-number joker-stat" id="joker-count">${cache.jokerWallets.size}</div>
            <div class="stat-label">JOKER WALLETS</div>
        </div>
        <div class="stat-card">
            <div class="stat-number" id="next-spin">${timeUntilNextSpin}s</div>
            <div class="stat-label">NEXT SPIN</div>
        </div>
    </div>

    <div class="main-container">
        <div class="panel">
            <div class="panel-title">🏆 HOLDERS (${cache.holders.length})</div>
            <div class="holders-list" id="holders-container">
                ${cache.holders.map(holder => {
                    const jokerCount = cache.jokerWallets.get(holder.owner) || 0;
                    return `
                    <div class="holder-card">
                        <div class="holder-address">
                            <a href="https://solscan.io/account/${holder.owner}" target="_blank">
                                ${holder.owner.slice(0, 8)}...${holder.owner.slice(-8)}
                            </a>
                            ${jokerCount > 0 ? `<span class="joker-indicator">🎭×${jokerCount}</span>` : ''}
                        </div>
                        <div class="holder-tokens">${holder.amount.toLocaleString()} tokens</div>
                    </div>
                `}).join('')}
            </div>
        </div>

        <div class="panel" style="justify-content: center; align-items: center;">
            <div class="wheel-container">
                <div class="wheel-pointer"></div>
                <div class="wheel" id="wheel">
                    <div class="current-winner" id="current-winner">
                        ${cache.spinHistory.length > 0 ? `
                            <div class="winner-address">
                                ${cache.spinHistory[0].address.slice(0, 6)}...${cache.spinHistory[0].address.slice(-4)}
                            </div>
                            <div class="winner-stats">
                                ${cache.spinHistory[0].tokens.toLocaleString()} tokens<br>
                            </div>
                            ${cache.spinHistory[0].gotJoker ? `<div class="joker-indicator" style="margin-top: 5px;">🎭 ${cache.spinHistory[0].jokerCount}/3</div>` : ''}
                        ` : `
                            <div>Next spin in <span id="spin-timer">${timeUntilNextSpin}</span>s</div>
                        `}
                    </div>
                    <div class="wheel-center"></div>
                </div>
            </div>
            
            <div class="countdown" id="countdown">
                ${cache.isSpinning ? 'SPINNING...' : `Next Spin: <span id="countdown-timer">${timeUntilNextSpin}</span>s`}
            </div>

            <div class="mega-jackpot">
                <div class="mega-jackpot-title">🎰 MEGA JACKPOT 🎰</div>
                <div class="mega-jackpot-amount">$${megaJackpotAmount}</div>
                <div class="mega-jackpot-timer">
                    Time Left: <span id="mega-jackpot-timer">${megaJackpotHours}h ${megaJackpotMinutes}m</span>
                </div>
                <div style="font-size: 0.9em; opacity: 0.8;">+$1 every minute!</div>
            </div>

            <div class="joker-wallets-row" id="joker-wallets-container">
                ${Array.from(cache.jokerWallets.entries()).map(([wallet, count]) => `
                    <div class="joker-wallet-item">
                        <a href="https://solscan.io/account/${wallet}" target="_blank">
                            ${wallet.slice(0, 6)}...${wallet.slice(-4)}
                        </a>
                        <div class="joker-wallet-jokers">${count}</div>
                    </div>
                `).join('')}
            </div>

            ${cache.jokerBonusWinners.length > 0 ? `
            <div class="joker-bonus-section">
                <div class="joker-bonus-title">🎉 JOKER BONUS WINNERS 🎉</div>
                ${cache.jokerBonusWinners.map(wallet => {
                    const jokerCount = cache.jokerWallets.get(wallet) || 0;
                    return `
                    <div class="joker-bonus-item">
                        <span class="joker-bonus-badge">3</span>
                        <a href="https://solscan.io/account/${wallet}" target="_blank">
                            ${wallet.slice(0, 8)}...${wallet.slice(-8)}
                        </a>
                        <span style="margin-left: 5px; color: #ff00ff;">(${jokerCount} jokers)</span>
                    </div>
                `}).join('')}
            </div>
            ` : ''}
        </div>

        <div class="panel">
            <div class="panel-title">📜 WIN HISTORY</div>
            <div class="history-list" id="history-list">
                ${cache.spinHistory.map(spin => `
                    <div class="history-item">
                        ${spin.gotJoker ? 
                            (spin.isJokerBonus ? 
                                '<span class="joker-bonus-badge">3</span>' : 
                                '<span class="joker-badge">🎭</span>'
                            ) : ''
                        }
                        <strong>${spin.time.split(' ')[1]}</strong><br>
                        <a href="https://solscan.io/account/${spin.address}" target="_blank">
                            ${spin.address.slice(0, 8)}...${spin.address.slice(-8)}
                        </a><br>
                        ${spin.tokens.toLocaleString()} tokens
                        ${spin.gotJoker ? `<br><small class="joker-indicator">+1 Joker (${spin.jokerCount}/3)</small>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    </div>

    <div class="rewards-section">
        <div class="rewards-title">💰 REWARDS TRANSACTIONS</div>
        <div style="text-align: center; margin-bottom: 15px; font-size: 0.9em;">
            From: <a href="https://solscan.io/account/${REWARDS_WALLET}" target="_blank">${REWARDS_WALLET.slice(0, 8)}...${REWARDS_WALLET.slice(-8)}</a>
        </div>
        ${cache.rewardsTransactions.length > 0 ? cache.rewardsTransactions.map(tx => `
            <div class="rewards-item">
                <strong>${tx.timestamp}</strong><br>
                ${tx.to ? `
                    To: <a href="https://solscan.io/account/${tx.to}" target="_blank">${tx.to.slice(0, 8)}...${tx.to.slice(-8)}</a><br>
                    Amount: ${tx.amount.toFixed(4)} SOL
                ` : 'Transaction details not available'}<br>
                Status: <span class="${tx.success ? 'rewards-success' : 'rewards-failed'}">${tx.success ? '✅ SUCCESS' : '❌ FAILED'}</span>
                ${tx.signature ? `<br><a href="https://solscan.io/tx/${tx.signature}" target="_blank" style="font-size: 0.7em;">View Transaction</a>` : ''}
            </div>
        `).join('') : `
            <div style="text-align: center; padding: 20px; color: #ccc;">
                Loading rewards transactions...
            </div>
        `}
    </div>

    <script>
        let ws;
        let isSpinning = false;

        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}\`;
            
            ws = new WebSocket(wsUrl);
            
            ws.onopen = function() {
                console.log('WebSocket connected');
            };
            
            ws.onmessage = function(event) {
                const data = JSON.parse(event.data);
                
                switch(data.type) {
                    case 'INIT':
                        updateAllData(data.data);
                        break;
                    case 'UPDATE':
                        updateTimers(data.data);
                        break;
                    case 'SPIN_START':
                        startWheelSpin();
                        break;
                    case 'SPIN_RESULT':
                        showSpinResult(data.data);
                        break;
                }
            };
            
            ws.onclose = function() {
                console.log('WebSocket disconnected, reconnecting...');
                setTimeout(connectWebSocket, 3000);
            };
        }

        function updateAllData(data) {
            document.getElementById('total-holders').textContent = data.totalHolders;
            document.getElementById('total-supply').textContent = data.totalTokens.toLocaleString();
            document.getElementById('joker-count').textContent = data.jokerCount;
            document.getElementById('last-winner').textContent = data.spinHistory.length > 0 ? 
                data.spinHistory[0].address.slice(0, 4) + '...' + data.spinHistory[0].address.slice(-4) : '-';
            
            updateTimers(data);
            updateHistoryList(data.spinHistory);
            updateJokerWallets(data.jokerWallets);
            updateJokerBonusWinners(data.jokerBonusWinners);
        }

        function updateTimers(data) {
            document.getElementById('countdown-timer').textContent = data.timeUntilNextSpin;
            document.getElementById('spin-timer').textContent = data.timeUntilNextSpin;
            document.getElementById('next-spin').textContent = data.timeUntilNextSpin + 's';
            
            const megaHours = Math.floor(data.megaJackpotTimeLeft / (1000 * 60 * 60));
            const megaMinutes = Math.floor((data.megaJackpotTimeLeft % (1000 * 60 * 60)) / (1000 * 60));
            document.getElementById('mega-jackpot-timer').textContent = megaHours + 'h ' + megaMinutes + 'm';
            document.querySelector('.mega-jackpot-amount').textContent = '$' + data.megaJackpotAmount;
            
            if (data.isSpinning && !isSpinning) {
                startWheelSpin();
            }
        }

        function startWheelSpin() {
            isSpinning = true;
            const wheel = document.getElementById('wheel');
            const countdown = document.getElementById('countdown');
            
            countdown.innerHTML = 'SPINNING...';
            wheel.classList.add('wheel-spinning');
            
            document.getElementById('current-winner').innerHTML = '<div>Spinning...</div>';
        }

        function showSpinResult(data) {
            setTimeout(() => {
                const wheel = document.getElementById('wheel');
                wheel.classList.remove('wheel-spinning');
                wheel.style.transform = 'rotate(0deg)';
                
                isSpinning = false;
                
                const winner = data.winner;
                document.getElementById('current-winner').innerHTML = \`
                    <div class="winner-address">
                        \${winner.address.slice(0, 6)}...\${winner.address.slice(-4)}
                    </div>
                    <div class="winner-stats">
                        \${winner.tokens.toLocaleString()} tokens<br>
                    </div>
                    \${winner.gotJoker ? \`<div class="joker-indicator" style="margin-top: 5px;">🎭 \${winner.jokerCount}/3</div>\` : ''}
                \`;
                
                document.getElementById('last-winner').textContent = winner.address.slice(0, 4) + '...' + winner.address.slice(-4);
                document.getElementById('joker-count').textContent = data.jokerCount;
                document.getElementById('total-holders').textContent = data.totalHolders;
                document.getElementById('total-supply').textContent = data.totalTokens.toLocaleString();
                
                updateTimers(data);
                updateHistoryList(data.spinHistory);
                updateJokerWallets(data.jokerWallets);
                updateJokerBonusWinners(data.jokerBonusWinners);
                
            }, 1000);
        }

        function updateHistoryList(history) {
            const historyList = document.getElementById('history-list');
            historyList.innerHTML = history.map(spin => \`
                <div class="history-item">
                    \${spin.gotJoker ? 
                        (spin.isJokerBonus ? 
                            '<span class="joker-bonus-badge">3</span>' : 
                            '<span class="joker-badge">🎭</span>'
                        ) : ''
                    }
                    <strong>\${spin.time.split(' ')[1]}</strong><br>
                    <a href="https://solscan.io/account/\${spin.address}" target="_blank">
                        \${spin.address.slice(0, 8)}...\${spin.address.slice(-8)}
                    </a><br>
                    \${spin.tokens.toLocaleString()} tokens
                    \${spin.gotJoker ? \`<br><small class="joker-indicator">+1 Joker (\${spin.jokerCount}/3)</small>\` : ''}
                </div>
            \`).join('');
        }

        function updateJokerWallets(jokerWallets) {
            const container = document.getElementById('joker-wallets-container');
            container.innerHTML = jokerWallets.map(([wallet, count]) => \`
                <div class="joker-wallet-item">
                    <a href="https://solscan.io/account/\${wallet}" target="_blank">
                        \${wallet.slice(0, 6)}...\${wallet.slice(-4)}
                    </a>
                    <div class="joker-wallet-jokers">\${count}</div>
                </div>
            \`).join('');
        }

        function updateJokerBonusWinners(winners) {
            let container = document.querySelector('.joker-bonus-section');
            if (winners.length > 0) {
                if (!container) {
                    const centerPanel = document.querySelector('.panel:nth-child(2)');
                    centerPanel.innerHTML += \`
                        <div class="joker-bonus-section">
                            <div class="joker-bonus-title">🎉 JOKER BONUS WINNERS 🎉</div>
                            \${winners.map(wallet => \`
                                <div class="joker-bonus-item">
                                    <span class="joker-bonus-badge">3</span>
                                    <a href="https://solscan.io/account/\${wallet}" target="_blank">
                                        \${wallet.slice(0, 8)}...\${wallet.slice(-8)}
                                    </a>
                                </div>
                            \`).join('')}
                        </div>
                    \`;
                } else {
                    container.innerHTML = \`
                        <div class="joker-bonus-title">🎉 JOKER BONUS WINNERS 🎉</div>
                        \${winners.map(wallet => \`
                            <div class="joker-bonus-item">
                                <span class="joker-bonus-badge">3</span>
                                <a href="https://solscan.io/account/\${wallet}" target="_blank">
                                    \${wallet.slice(0, 8)}...\${wallet.slice(-8)}
                                </a>
                            </div>
                        \`).join('')}
                    \`;
                }
            } else if (container) {
                container.remove();
            }
        }

        function createWheelSlices() {
            const wheel = document.getElementById('wheel');
            const currentWinnerDiv = document.getElementById('current-winner');
            const wheelCenter = document.querySelector('.wheel-center');
            wheel.innerHTML = '';
            wheel.appendChild(currentWinnerDiv);
            wheel.appendChild(wheelCenter);
            
            const sliceCount = Math.min(${cache.holders.length}, 24);
            const angle = 360 / sliceCount;
            
            const wheelHolders = ${JSON.stringify(cache.holders)}.slice(0, sliceCount);
            
            wheelHolders.forEach((holder, index) => {
                const slice = document.createElement('div');
                slice.className = 'wheel-slice';
                slice.style.transform = \`rotate(\${index * angle}deg)\`;
                
                const shortAddress = \`\${holder.owner.slice(0, 4)}...\${holder.owner.slice(-3)}\`;
                slice.innerHTML = \`
                    <div style="transform: rotate(\${90 - angle/2}deg); transform-origin: left center;">
                        \${shortAddress}
                    </div>
                \`;
                
                wheel.appendChild(slice);
            });
        }

        document.addEventListener('DOMContentLoaded', function() {
            createWheelSlices();
            connectWebSocket();
        });
    </script>
</body>
</html>
    `);
});

const server = app.listen(process.env.PORT || 1000, async () => {
    console.log(`🎡 POWERPUMP WHEEL Server running on port ${process.env.PORT || 1000}`);
    console.log("⏰ Server handles all timing and spins every 30 seconds");
    console.log("🔌 WebSocket enabled for real-time updates");
    
    await getHolders();
    await getRewardsTransactions();
    
    setInterval(() => {
        autoSpin();
    }, SPIN_INTERVAL);
    
    setInterval(getHolders, 60000);
    setInterval(getRewardsTransactions, 120000);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
