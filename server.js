const { Connection, PublicKey } = require("@solana/web3.js");
const express = require("express");

// CONFIG
const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const TOKEN_MINT = "8KK76tofUfbe7pTh1yRpbQpTkYwXKUjLzEBtAUTwpump";
const SPIN_INTERVAL = 15 * 60 * 1000; // 15 minutes

// In-memory cache (no JSON files)
let cache = {
    holders: [],
    spinHistory: [],
    jokerWallets: new Map(), // wallet -> joker count
    jokerBonusWinners: [] // wallets that reached 3 jokers
};

let connection = new Connection(RPC_ENDPOINT);
const app = express();

app.use(express.static('public'));

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

// Spin the wheel with joker logic
function spinWheel() {
    if (cache.holders.length === 0) return null;
    
    const totalTokens = cache.holders.reduce((sum, h) => sum + h.amount, 0);
    let random = Math.random() * totalTokens;
    let winnerHolder = null;
    
    for (const holder of cache.holders) {
        if (random < holder.amount) {
            winnerHolder = holder;
            break;
        }
        random -= holder.amount;
    }
    
    if (!winnerHolder) return null;
    
    // Check if winner gets a joker (10% chance)
    const getsJoker = Math.random() < 0.1;
    let jokerCount = cache.jokerWallets.get(winnerHolder.owner) || 0;
    
    if (getsJoker) {
        jokerCount++;
        cache.jokerWallets.set(winnerHolder.owner, jokerCount);
        console.log(`🎭 JOKER ASSIGNED to ${winnerHolder.owner.slice(0, 8)}... Total: ${jokerCount}`);
        
        // Check if this wallet reached 3 jokers
        if (jokerCount === 3) {
            if (!cache.jokerBonusWinners.includes(winnerHolder.owner)) {
                cache.jokerBonusWinners.push(winnerHolder.owner);
                console.log(`🎉🎉🎉 JOKER BONUS TRIGGERED for ${winnerHolder.owner.slice(0, 8)}... 🎉🎉🎉`);
            }
        }
    }
    
    const winner = {
        address: winnerHolder.owner,
        tokens: winnerHolder.amount,
        time: new Date().toLocaleString(),
        percentage: (winnerHolder.amount / totalTokens * 100).toFixed(4),
        gotJoker: getsJoker,
        jokerCount: jokerCount,
        isJokerBonus: jokerCount === 3
    };
    
    cache.spinHistory.unshift(winner);
    if (cache.spinHistory.length > 50) cache.spinHistory.pop();
    
    console.log(`🎉 WINNER: ${winner.address.slice(0, 8)}... | Joker: ${getsJoker} | Total Jokers: ${jokerCount}`);
    return winner;
}

// Serve HTML
app.get("/", (req, res) => {
    const jokerBonusList = cache.jokerBonusWinners.map(wallet => {
        const jokerCount = cache.jokerWallets.get(wallet) || 0;
        return { wallet, jokerCount };
    });

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
            overflow: hidden;
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
            transition: transform 4s cubic-bezier(0.2, 0.8, 0.2, 1);
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
        .spin-button {
            background: linear-gradient(45deg, #ff0000, #ff6b00);
            border: none;
            padding: 15px 40px;
            font-size: 1.2em;
            color: white;
            border-radius: 50px;
            cursor: pointer;
            font-weight: bold;
            box-shadow: 0 0 20px rgba(255, 107, 0, 0.5);
            transition: all 0.3s;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .spin-button:hover {
            transform: scale(1.05);
            box-shadow: 0 0 30px rgba(255, 107, 0, 0.8);
        }
        .spin-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
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
        
        /* WINNER POPUP */
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
            <div class="stat-number" id="last-winner">-</div>
            <div class="stat-label">LAST WINNER</div>
        </div>
        <div class="stat-card">
            <div class="stat-number joker-stat" id="joker-count">${cache.jokerWallets.size}</div>
            <div class="stat-label">JOKER WALLETS</div>
        </div>
        <div class="stat-card">
            <div class="stat-number" id="next-spin">15:00</div>
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
                        <div>SPIN THE WHEEL!</div>
                    </div>
                    <div class="wheel-center"></div>
                </div>
            </div>
            
            <div class="countdown" id="countdown">
                Next Spin: <span id="countdown-timer">15:00</span>
            </div>
            
            <div class="controls">
                <button class="spin-button" onclick="spinWheel()" id="spin-btn">🎡 SPIN 🎡</button>
            </div>

            <!-- JOKER BONUS SECTION -->
            ${jokerBonusList.length > 0 ? `
            <div class="joker-bonus-section">
                <div class="joker-bonus-title">🎉 JOKER BONUS WINNERS 🎉</div>
                ${jokerBonusList.map(bonus => `
                    <div class="joker-bonus-item">
                        <span class="joker-bonus-badge">3</span>
                        <a href="https://solscan.io/account/${bonus.wallet}" target="_blank">
                            ${bonus.wallet.slice(0, 8)}...${bonus.wallet.slice(-8)}
                        </a>
                    </div>
                `).join('')}
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
                        ${spin.tokens.toLocaleString()} tokens (${spin.percentage}%)
                        ${spin.gotJoker ? `<br><small class="joker-indicator">+1 Joker (${spin.jokerCount}/3)</small>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    </div>

    <audio id="spinSound" src="https://assets.mixkit.co/sfx/preview/mixkit-slot-machine-wheel-1931.mp3"></audio>
    <audio id="winSound" src="https://assets.mixkit.co/sfx/preview/mixkit-winning-chimes-2015.mp3"></audio>
    <audio id="tickSound" src="https://assets.mixkit.co/sfx/preview/mixkit-arcade-game-jump-coin-216.mp3"></audio>
    <audio id="jokerSound" src="https://assets.mixkit.co/sfx/preview/mixkit-extra-bonus-in-a-video-game-2043.mp3"></audio>

    <script>
        let countdown = 15 * 60;
        let isSpinning = false;
        let currentWinner = null;
        
        // Create wheel slices with holder addresses
        function createWheelSlices() {
            const wheel = document.getElementById('wheel');
            // Clear existing slices except center and current winner
            const currentWinnerDiv = document.getElementById('current-winner');
            const wheelCenter = document.querySelector('.wheel-center');
            wheel.innerHTML = '';
            wheel.appendChild(currentWinnerDiv);
            wheel.appendChild(wheelCenter);
            
            const sliceCount = Math.min(holders.length, 24);
            const angle = 360 / sliceCount;
            
            // Get top holders for the wheel
            const wheelHolders = [...holders]
                .sort((a, b) => b.amount - a.amount)
                .slice(0, sliceCount);
            
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
        
        // Countdown timer
        function updateCountdown() {
            countdown--;
            if (countdown <= 0) {
                countdown = 15 * 60;
                autoSpin();
            }
            const mins = Math.floor(countdown / 60);
            const secs = countdown % 60;
            const timerText = \`\${mins}:\${secs.toString().padStart(2, '0')}\`;
            document.getElementById('countdown-timer').textContent = timerText;
            document.getElementById('next-spin').textContent = timerText;
        }
        
        // Auto spin every 15 minutes
        function autoSpin() {
            if (!isSpinning) {
                spinWheel();
            }
        }
        
        // Spin wheel function
        async function spinWheel() {
            if (isSpinning) return;
            
            isSpinning = true;
            document.getElementById('spin-btn').disabled = true;
            
            // Play spin sound
            document.getElementById('spinSound').play();
            
            const wheel = document.getElementById('wheel');
            wheel.classList.add('wheel-spinning');
            
            // Update current winner display to show spinning
            document.getElementById('current-winner').innerHTML = '<div>SPINNING...</div>';
            
            // Play tick sounds during spin
            const tickInterval = setInterval(() => {
                document.getElementById('tickSound').play();
            }, 150);
            
            try {
                const response = await fetch('/spin', { method: 'POST' });
                const winner = await response.json();
                
                setTimeout(() => {
                    clearInterval(tickInterval);
                    wheel.classList.remove('wheel-spinning');
                    
                    if (winner && winner.address) {
                        // Play win sound
                        document.getElementById('winSound').play();
                        
                        // Play joker sound if they got one
                        if (winner.gotJoker) {
                            setTimeout(() => {
                                document.getElementById('jokerSound').play();
                            }, 1000);
                        }
                        
                        // Update current winner display
                        let winnerHTML = \`
                            <div class="winner-address">
                                \${winner.address.slice(0, 6)}...\${winner.address.slice(-4)}
                            </div>
                            <div class="winner-stats">
                                \${winner.tokens.toLocaleString()} tokens<br>
                                \${winner.percentage}%
                            </div>
                        \`;
                        
                        if (winner.gotJoker) {
                            winnerHTML += \`
                                <div class="joker-indicator" style="margin-top: 5px;">
                                    🎭 +1 JOKER! (\${winner.jokerCount}/3)
                                </div>
                            \`;
                        }
                        
                        document.getElementById('current-winner').innerHTML = winnerHTML;
                        
                        // Show winner popup
                        showWinnerPopup(winner);
                        
                        // Update stats
                        document.getElementById('last-winner').textContent = 
                            winner.address.slice(0, 4) + '...' + winner.address.slice(-4);
                        document.getElementById('joker-count').textContent = 
                            cache.jokerWallets.size;
                    }
                    
                    isSpinning = false;
                    document.getElementById('spin-btn').disabled = false;
                    
                    // Reload page after showing winner to update history
                    setTimeout(() => location.reload(), 5000);
                    
                }, 4000);
                
            } catch (error) {
                console.error('Spin error:', error);
                isSpinning = false;
                document.getElementById('spin-btn').disabled = false;
                wheel.classList.remove('wheel-spinning');
                clearInterval(tickInterval);
            }
        }
        
        // Show winner popup
        function showWinnerPopup(winner) {
            const popup = document.createElement('div');
            popup.className = 'winner-popup';
            
            let popupHTML = \`
                <h2 style="font-size: 2em; margin-bottom: 15px;">🎉 WINNER! 🎉</h2>
                <div style="font-size: 1.1em; margin: 10px 0; font-family: monospace;">
                    \${winner.address.slice(0, 12)}...\${winner.address.slice(-12)}
                </div>
                <div style="font-size: 1.5em; color: #ffd700; margin: 10px 0;">
                    🪙 \${winner.tokens.toLocaleString()} TOKENS
                </div>
                <div style="font-size: 1em;">
                    📊 \${winner.percentage}% of supply
                </div>
            \`;
            
            if (winner.gotJoker) {
                popupHTML += \`
                    <div style="font-size: 1.8em; color: #ff00ff; margin: 15px 0; text-shadow: 0 0 20px #ff00ff;">
                        🎭 JOKER AWARDED! 🎭
                    </div>
                    <div style="font-size: 1.2em;">
                        Total Jokers: \${winner.jokerCount}/3
                    </div>
                \`;
                
                if (winner.isJokerBonus) {
                    popupHTML += \`
                        <div style="font-size: 2em; color: #00ffff; margin: 15px 0; text-shadow: 0 0 20px #00ffff;">
                            🎉🎉 JOKER BONUS! 🎉🎉
                        </div>
                    \`;
                }
            }
            
            popup.innerHTML = popupHTML;
            document.body.appendChild(popup);
            
            setTimeout(() => {
                document.body.removeChild(popup);
            }, 4500);
        }
        
        // Initialize
        createWheelSlices();
        setInterval(updateCountdown, 1000);
        
        // Auto-refresh data every minute
        setInterval(() => {
            if (!isSpinning) {
                location.reload();
            }
        }, 60000);
    </script>
</body>
</html>
    `);
});

// API to spin wheel
app.post("/spin", (req, res) => {
    const winner = spinWheel();
    res.json(winner || { error: "No holders available" });
});

// API to get current data
app.get("/api/data", (req, res) => {
    res.json({
        holders: cache.holders.length,
        totalTokens: cache.holders.reduce((sum, h) => sum + h.amount, 0),
        spinHistory: cache.spinHistory,
        jokerWallets: Object.fromEntries(cache.jokerWallets),
        jokerBonusWinners: cache.jokerBonusWinners
    });
});

// Start server
const PORT = process.env.PORT || 1000;
app.listen(PORT, async () => {
    console.log(`🎡 POWERBALL WHEEL Server running on port ${PORT}`);
    console.log("⏰ Auto-spinning every 15 minutes");
    console.log("💰 Weighted chances (0.01% - 5% holders only)");
    console.log("🎭 Joker system: 10% chance per spin, 3 jokers = bonus!");
    console.log("💾 Using in-memory cache (no JSON files)");
    
    await getHolders();
    
    // Auto-spin every 15 minutes
    setInterval(() => {
        spinWheel();
    }, SPIN_INTERVAL);
    
    // Refresh holders every minute
    setInterval(getHolders, 60000);
});

