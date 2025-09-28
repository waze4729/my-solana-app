const { Connection, PublicKey } = require("@solana/web3.js");
const express = require("express");

// CONFIG
const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const TOKEN_MINT = "8KK76tofUfbe7pTh1yRpbQpTkYwXKUjLzEBtAUTwpump";
const SPIN_INTERVAL = 15 * 60 * 1000; // 15 minutes

let holders = [];
let spinHistory = [];
let connection = new Connection(RPC_ENDPOINT);
const app = express();

app.use(express.static('public'));

// Get token holders
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
        
        // Filter out holders with more than 5% of total supply
        holders = allHolders.filter(holder => {
            const percentage = (holder.amount / totalSupply) * 100;
            return percentage <= 5; // Only include holders with 5% or less
        });
        
        console.log(`Updated ${holders.length} eligible holders (excluded ${allHolders.length - holders.length} holders with >5% supply)`);
    } catch (e) {
        console.error("Error:", e.message);
    }
}

// Spin the wheel
function spinWheel() {
    if (holders.length === 0) return null;
    
    const totalTokens = holders.reduce((sum, h) => sum + h.amount, 0);
    let random = Math.random() * totalTokens;
    
    for (const holder of holders) {
        if (random < holder.amount) {
            const winner = {
                address: holder.owner,
                tokens: holder.amount,
                time: new Date().toLocaleString(),
                percentage: (holder.amount / totalTokens * 100).toFixed(4)
            };
            spinHistory.unshift(winner);
            if (spinHistory.length > 50) spinHistory.pop();
            
            console.log(`🎉 POWERBALL WINNER: ${winner.address}`);
            return winner;
        }
        random -= holder.amount;
    }
    return null;
}

// Serve HTML
app.get("/", (req, res) => {
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
            overflow-x: hidden;
        }
        .powerball-header {
            text-align: center;
            padding: 20px;
            background: linear-gradient(45deg, #ff0000, #ff6b00);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            font-size: 3em;
            text-shadow: 0 0 30px rgba(255, 107, 0, 0.5);
            margin-bottom: 20px;
        }
        .stats-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            padding: 0 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 15px;
            text-align: center;
            backdrop-filter: blur(10px);
            border: 2px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        .stat-number {
            font-size: 2em;
            font-weight: bold;
            color: #ffd700;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }
        .stat-label {
            font-size: 0.9em;
            color: #ccc;
            margin-top: 5px;
        }
        
        /* GIANT WHEEL DESIGN */
        .wheel-container {
            position: relative;
            width: 600px;
            height: 600px;
            margin: 30px auto;
        }
        .wheel {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: linear-gradient(45deg, #ff0000, #ff6b00, #ffd700, #00ff88, #0066ff);
            position: relative;
            overflow: hidden;
            border: 10px solid #ffd700;
            box-shadow: 0 0 50px rgba(255, 215, 0, 0.5);
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
            padding-left: 60px;
            font-size: 12px;
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
            width: 80px;
            height: 80px;
            background: radial-gradient(circle, #ff0000, #8b0000);
            border-radius: 50%;
            transform: translate(-50%, -50%);
            box-shadow: 0 0 30px rgba(255, 0, 0, 0.8);
            z-index: 10;
            border: 5px solid #ffd700;
        }
        .wheel-pointer {
            position: absolute;
            top: -40px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 30px solid transparent;
            border-right: 30px solid transparent;
            border-top: 60px solid #ffd700;
            filter: drop-shadow(0 0 20px gold);
            z-index: 100;
        }
        .wheel-pointer::after {
            content: '';
            position: absolute;
            top: -70px;
            left: -10px;
            width: 20px;
            height: 20px;
            background: #ff0000;
            border-radius: 50%;
        }
        
        .controls {
            text-align: center;
            margin: 20px 0;
        }
        .spin-button {
            background: linear-gradient(45deg, #ff0000, #ff6b00);
            border: none;
            padding: 20px 60px;
            font-size: 1.5em;
            color: white;
            border-radius: 50px;
            cursor: pointer;
            font-weight: bold;
            box-shadow: 0 0 30px rgba(255, 107, 0, 0.5);
            transition: all 0.3s;
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        .spin-button:hover {
            transform: scale(1.05);
            box-shadow: 0 0 40px rgba(255, 107, 0, 0.8);
        }
        .spin-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        .countdown {
            font-size: 1.5em;
            text-align: center;
            color: #ffd700;
            margin: 15px 0;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }
        .holders-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 10px;
            padding: 20px;
            max-height: 400px;
            overflow-y: auto;
        }
        .holder-card {
            background: rgba(255, 255, 255, 0.05);
            padding: 12px;
            border-radius: 8px;
            border-left: 4px solid #ff6b00;
        }
        .holder-address {
            font-family: monospace;
            font-size: 0.9em;
            margin-bottom: 5px;
        }
        .holder-tokens {
            color: #ffd700;
            font-size: 0.8em;
        }
        .history-section {
            background: rgba(0, 0, 0, 0.5);
            margin: 20px;
            padding: 20px;
            border-radius: 15px;
            border: 2px solid rgba(255, 255, 255, 0.1);
        }
        .history-title {
            color: #ffd700;
            text-align: center;
            margin-bottom: 15px;
            font-size: 1.5em;
        }
        .history-item {
            background: rgba(255, 255, 255, 0.05);
            padding: 12px;
            margin: 8px 0;
            border-radius: 8px;
            border-left: 4px solid #ff0000;
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
            padding: 40px;
            border-radius: 25px;
            text-align: center;
            z-index: 1000;
            box-shadow: 0 0 80px rgba(255, 0, 0, 0.9);
            animation: popup 0.5s ease-out;
            border: 5px solid #ffd700;
        }
        @keyframes popup {
            from { transform: translate(-50%, -50%) scale(0); opacity: 0; }
            to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        .current-winner {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            padding: 20px;
            border-radius: 15px;
            text-align: center;
            z-index: 50;
            border: 3px solid #ffd700;
            min-width: 200px;
        }
        .winner-address {
            font-family: monospace;
            font-size: 1.1em;
            color: #ffd700;
            margin-bottom: 10px;
            word-break: break-all;
        }
        .winner-stats {
            font-size: 0.9em;
            color: #00ff88;
        }
    </style>
</head>
<body>
    <h1 class="powerball-header">🎡POWERBALL WHEEL OF HOLDERS 🎡</h1>
    
    <div class="stats-row">
        <div class="stat-card">
            <div class="stat-number" id="total-holders">${holders.length}</div>
            <div class="stat-label">TOTAL HOLDERS</div>
        </div>
        <div class="stat-card">
            <div class="stat-number" id="total-supply">${holders.reduce((sum, h) => sum + h.amount, 0).toLocaleString()}</div>
            <div class="stat-label">TOTAL TOKENS</div>
        </div>
        <div class="stat-card">
            <div class="stat-number" id="next-spin">15:00</div>
            <div class="stat-label">NEXT SPIN</div>
        </div>
    </div>

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
        <button class="spin-button" onclick="spinWheel()" id="spin-btn">🎡 SPIN THE WHEEL 🎡</button>
    </div>

    <div class="stats-row">
        <div class="stat-card">
            <div class="stat-number" id="last-winner">-</div>
            <div class="stat-label">LAST WINNER</div>
        </div>
        <div class="stat-card">
            <div class="stat-number" id="winner-tokens">-</div>
            <div class="stat-label">WINNER TOKENS</div>
        </div>
        <div class="stat-card">
            <div class="stat-number" id="spin-count">${spinHistory.length}</div>
            <div class="stat-label">TOTAL SPINS</div>
        </div>
    </div>

    <div class="holders-grid" id="holders-container">
        ${holders.map(holder => `
            <div class="holder-card">
                <div class="holder-address">
                    <a href="https://solscan.io/account/${holder.owner}" target="_blank">
                        ${holder.owner.slice(0, 12)}...${holder.owner.slice(-12)}
                    </a>
                </div>
                <div class="holder-tokens">${holder.amount.toLocaleString()} tokens</div>
            </div>
        `).join('')}
    </div>

    <div class="history-section">
        <div class="history-title">🏆 SPIN HISTORY</div>
        <div id="history-list">
            ${spinHistory.map(spin => `
                <div class="history-item">
                    <strong>${spin.time}</strong> - 
                    <a href="https://solscan.io/account/${spin.address}" target="_blank">
                        ${spin.address.slice(0, 12)}...${spin.address.slice(-12)}
                    </a> - 
                    ${spin.tokens.toLocaleString()} tokens (${spin.percentage}%)
                </div>
            `).join('')}
        </div>
    </div>

    <audio id="spinSound" src="https://assets.mixkit.co/sfx/preview/mixkit-slot-machine-wheel-1931.mp3"></audio>
    <audio id="winSound" src="https://assets.mixkit.co/sfx/preview/mixkit-winning-chimes-2015.mp3"></audio>
    <audio id="tickSound" src="https://assets.mixkit.co/sfx/preview/mixkit-arcade-game-jump-coin-216.mp3"></audio>

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
            
            const sliceCount = Math.min(holders.length, 36); // Max 36 slices for readability
            const angle = 360 / sliceCount;
            
            // Get top holders for the wheel (or all if less than 36)
            const wheelHolders = [...holders]
                .sort((a, b) => b.amount - a.amount)
                .slice(0, sliceCount);
            
            wheelHolders.forEach((holder, index) => {
                const slice = document.createElement('div');
                slice.className = 'wheel-slice';
                slice.style.transform = \`rotate(\${index * angle}deg)\`;
                
                // Shorten address for display
                const shortAddress = \`\${holder.owner.slice(0, 6)}...\${holder.owner.slice(-4)}\`;
                slice.innerHTML = \`
                    <div style="transform: rotate(\${90 - angle/2}deg); transform-origin: left center;">
                        \${shortAddress}<br>
                        <small>\${(holder.amount/1000).toFixed(0)}K</small>
                    </div>
                \`;
                
                wheel.appendChild(slice);
            });
            
            console.log(\`Created wheel with \${wheelHolders.length} holders\`);
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
                        
                        // Update current winner display
                        document.getElementById('current-winner').innerHTML = \`
                            <div class="winner-address">
                                \${winner.address.slice(0, 8)}...\${winner.address.slice(-8)}
                            </div>
                            <div class="winner-stats">
                                \${winner.tokens.toLocaleString()} tokens<br>
                                \${winner.percentage}%
                            </div>
                        \`;
                        
                        // Show winner popup
                        showWinnerPopup(winner);
                        
                        // Update stats
                        document.getElementById('last-winner').textContent = 
                            winner.address.slice(0, 6) + '...' + winner.address.slice(-6);
                        document.getElementById('winner-tokens').textContent = 
                            winner.tokens.toLocaleString();
                        document.getElementById('spin-count').textContent = 
                            parseInt(document.getElementById('spin-count').textContent) + 1;
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
            popup.innerHTML = \`
                <h2 style="font-size: 2.5em; margin-bottom: 20px;">🎉 WHEEL WINNER! 🎉</h2>
                <div style="font-size: 1.3em; margin: 15px 0; font-family: monospace;">
                    <a href="https://solscan.io/account/\${winner.address}" target="_blank" style="color: white;">
                        \${winner.address}
                    </a>
                </div>
                <div style="font-size: 1.8em; color: #ffd700; margin: 15px 0;">
                    🪙 \${winner.tokens.toLocaleString()} TOKENS
                </div>
                <div style="font-size: 1.2em;">
                    📊 \${winner.percentage}% of total supply
                </div>
                <div style="margin-top: 20px; font-size: 1em; opacity: 0.9;">
                    ⚖️ Weighted by token holdings
                </div>
            \`;
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
        holders: holders.length,
        totalTokens: holders.reduce((sum, h) => sum + h.amount, 0),
        spinHistory: spinHistory
    });
});

// Start server
// Start server
const PORT = process.env.PORT || 1000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🎡 WHEEL OF HOLDERS Server running on port ${PORT}`);
    console.log("⏰ Auto-spinning every 15 minutes");
    console.log("💰 Weighted chances based on token holdings");
    console.log("🎯 Wheel shows actual holder addresses!");
    
    await getHolders();
    
    // Auto-spin every 15 minutes
    setInterval(() => {
        spinWheel();
    }, SPIN_INTERVAL);
    
    // Refresh holders every minute
    setInterval(getHolders, 60000);
});


// Debug route to check port and environment
app.get("/debug", (req, res) => {
    res.json({
        port: process.env.PORT,
        node_env: process.env.NODE_ENV,
        message: "Powerball Wheel Debug Info"
    });
});

