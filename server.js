const { Connection, PublicKey } = require("@solana/web3.js");
const express = require("express");

// CONFIG
const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const TOKEN_MINT = "8KK76tofUfbe7pTh1yRpbQpTkYwXKUjLzEBtAUTwpump";
const SPIN_INTERVAL = 30 * 1000; // 30 seconds

// In-memory cache (no JSON files)
let cache = {
    holders: [],
    spinHistory: [],
    jokerWallets: new Map(), // wallet -> joker count
    jokerBonusWinners: [], // wallets that reached 3 jokers
    lastSpinTime: Date.now(),
    nextSpinTime: Date.now() + SPIN_INTERVAL,
    isSpinning: false
};

let connection = new Connection(RPC_ENDPOINT);
const app = express();

app.use(express.static('public'));
app.use(express.json());

// Get token holders with 0.01% to 5% filter
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
        
        // First get all holders
        const allHolders = accounts.map(acc => ({
            address: acc.pubkey.toBase58(),
            owner: acc.account.data.parsed.info.owner,
            amount: Number(acc.account.data.parsed.info.tokenAmount.amount)
        })).filter(h => h.amount > 0);
        
        // Calculate total supply
        const totalSupply = allHolders.reduce((sum, h) => sum + h.amount, 0);
        
        // Filter holders with 0.01% to 5% of total supply
        cache.holders = allHolders.filter(holder => {
            const percentage = (holder.amount / totalSupply) * 100;
            return percentage >= 0.01 && percentage <= 5;
        });
        
        console.log(`Updated ${cache.holders.length} eligible holders (0.01% - 5% range)`);
    } catch (e) {
        console.error("Error:", e.message);
    }
}

// Spin the wheel with COMPLETELY RANDOM selection and JOKER RESPIN
function spinWheel() {
    if (cache.holders.length === 0) return null;
    
    // COMPLETELY RANDOM SELECTION - not weighted by token amount
    const randomIndex = Math.floor(Math.random() * cache.holders.length);
    const winnerHolder = cache.holders[randomIndex];
    
    if (!winnerHolder) return null;
    
    // EVERY WINNER GETS A JOKER
    const getsJoker = true;
    let jokerCount = cache.jokerWallets.get(winnerHolder.owner) || 0;
    jokerCount++;
    cache.jokerWallets.set(winnerHolder.owner, jokerCount);
    
    console.log(`🎭 JOKER ASSIGNED to ${winnerHolder.owner.slice(0, 8)}... Total: ${jokerCount}`);
    
    // Check if this wallet reached 3 jokers
    let isNewBonusWinner = false;
    if (jokerCount === 3) {
        if (!cache.jokerBonusWinners.includes(winnerHolder.owner)) {
            cache.jokerBonusWinners.push(winnerHolder.owner);
            isNewBonusWinner = true;
            console.log(`🎉🎉🎉 JOKER BONUS TRIGGERED for ${winnerHolder.owner.slice(0, 8)}... 🎉🎉🎉`);
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
    if (cache.spinHistory.length > 50) cache.spinHistory.pop();
    
    // Update spin timing
    cache.lastSpinTime = Date.now();
    cache.nextSpinTime = cache.lastSpinTime + SPIN_INTERVAL;
    
    console.log(`🎉 WINNER: ${winner.address.slice(0, 8)}... | Joker: ${getsJoker} | Total Jokers: ${jokerCount}`);
    return winner;
}

// Auto-spin function (called by server interval)
function autoSpin() {
    if (!cache.isSpinning && cache.holders.length > 0) {
        cache.isSpinning = true;
        console.log('🔄 SERVER: Auto-spin triggered');
        spinWheel();
        cache.isSpinning = false;
    }
}

// Serve HTML
app.get("/", (req, res) => {
    const jokerBonusList = cache.jokerBonusWinners.map(wallet => {
        const jokerCount = cache.jokerWallets.get(wallet) || 0;
        return { wallet, jokerCount };
    });

    const timeUntilNextSpin = Math.max(0, Math.floor((cache.nextSpinTime - Date.now()) / 1000));
    
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>POWERBALL WHEEL OF HOLDERS</title>
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
            height: calc(100vh - 120px);
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
        
        /* WHEEL STYLES */
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
        }
        .wheel-spinning {
            animation: spin 0.1s linear infinite;
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
        
        /* HOLDERS LIST */
        .holders-list {
            flex: 1;
            overflow-y: auto;
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
            padding-right: 5px;
        }
        .holder-card {
            background: rgba(255, 255, 255, 0.05);
            padding: 10px;
            border-radius: 8px;
            border-left: 3px solid #ff6b00;
            font-size: 0.85em;
        }
        .holder-address {
            font-family: monospace;
            margin-bottom: 3px;
        }
        .holder-tokens {
            color: #ffd700;
            font-size: 0.8em;
        }
        
        /* HISTORY LIST */
        .history-list {
            flex: 1;
            overflow-y: auto;
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
            padding-right: 5px;
        }
        .history-item {
            background: rgba(255, 255, 255, 0.05);
            padding: 10px;
            border-radius: 8px;
            border-left: 3px solid #ff0000;
            font-size: 0.8em;
            position: relative;
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
        
        /* JOKER BONUS SECTION */
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
        
        /* CONTROLS */
        .controls {
            text-align: center;
            margin: 10px 0;
        }
        .countdown {
            font-size: 1.2em;
            text-align: center;
            color: #ffd700;
            margin: 10px 0;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }
        
        /* STATS BAR */
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
        
        /* JOKER WALLETS ROW */
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
        
        /* LINKS */
        a {
            color: #00ff88;
            text-decoration: none;
            transition: color 0.3s;
        }
        a:hover {
            color: #ffd700;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }
        
        /* SCROLLBARS */
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
        <!-- LEFT PANEL - HOLDERS -->
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

        <!-- CENTER PANEL - WHEEL -->
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
                                ${cache.spinHistory[0].percentage}%
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

            <!-- JOKER WALLETS ROW -->
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

            <!-- JOKER BONUS SECTION -->
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

        <!-- RIGHT PANEL - HISTORY -->
        <div class="panel">
            <div class="panel-title">📜 SPIN HISTORY</div>
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

    <script>
        // Simple auto-refresh to get latest data from server
        setInterval(() => {
            location.reload();
        }, 5000); // Refresh every 5 seconds to get latest data
        
        // Update countdown display
        function updateCountdown() {
            const timeLeft = ${timeUntilNextSpin};
            if (timeLeft > 0) {
                document.getElementById('countdown-timer').textContent = timeLeft;
                document.getElementById('spin-timer').textContent = timeLeft;
                document.getElementById('next-spin').textContent = timeLeft + 's';
            }
        }
        
        // Initial update
        updateCountdown();
    </script>
</body>
</html>
    `);
});

// API to get current data
app.get("/api/data", (req, res) => {
    const timeUntilNextSpin = Math.max(0, Math.floor((cache.nextSpinTime - Date.now()) / 1000));
    
    res.json({
        holders: cache.holders,
        totalTokens: cache.holders.reduce((sum, h) => sum + h.amount, 0),
        spinHistory: cache.spinHistory,
        jokerWallets: Object.fromEntries(cache.jokerWallets),
        jokerBonusWinners: cache.jokerBonusWinners,
        timeUntilNextSpin: timeUntilNextSpin,
        isSpinning: cache.isSpinning,
        lastWinner: cache.spinHistory.length > 0 ? cache.spinHistory[0] : null
    });
});

// Start server
const PORT = process.env.PORT || 1000;
app.listen(PORT, async () => {
    console.log(`🎡 POWERBALL WHEEL Server running on port ${PORT}`);
    console.log("⏰ Server handles all timing and spins every 30 seconds");
    console.log("🎲 COMPLETELY RANDOM selection (0.01% - 5% holders only)");
    console.log("🎭 Joker system: EVERY WINNER gets 1 joker, 3 jokers = bonus!");
    console.log("🔄 Client auto-refreshes every 5 seconds");
    console.log("💾 Using in-memory cache (no JSON files)");
    
    await getHolders();
    
    // Server handles all timing and spins
    setInterval(() => {
        autoSpin();
    }, SPIN_INTERVAL);
    
    // Refresh holders every minute
    setInterval(getHolders, 60000);
});

