const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const express = require("express");
const WebSocket = require('ws');
const http = require('http');

// CONFIG
const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=07ed88b0-3573-4c79-8d62-3a2cbd5c141a";
const DEFAULT_TOKEN_MINT = "6xhkDDydGj5o1sFXrW7Tt493g3BnaVHnEh2Cs7R6pump";
const POLL_INTERVAL_MS = 1300;
const WHEEL_SPIN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let currentTokenMint = DEFAULT_TOKEN_MINT;
let tokenSupply = 0;
let allHolders = [];
let wheelHistory = [];
let lastSpinTime = null;
let nextSpinTime = null;
let isSpinning = false;
let currentWinner = null;
let wheelPositions = [];
let connection = new Connection(RPC_ENDPOINT, { commitment: "confirmed" });

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const wsClients = new Set();

// Middleware to parse JSON bodies
app.use(express.json());
app.use(express.static('public'));

wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
    ws.send(JSON.stringify(getCurrentWheelData()));
});

function broadcastUpdate() {
    const data = getCurrentWheelData();
    wsClients.forEach(ws => {
        if (ws.readyState === 1) ws.send(JSON.stringify(data));
    });
}

function getCurrentWheelData() {
    return {
        currentTokenMint,
        tokenSupply,
        totalHolders: allHolders.length,
        wheelHistory: wheelHistory.slice(-10), // Last 10 spins
        lastSpinTime,
        nextSpinTime,
        isSpinning,
        currentWinner,
        wheelPositions,
        timeUntilNextSpin: nextSpinTime ? Math.max(0, nextSpinTime - Date.now()) : 0
    };
}

async function fetchAllTokenHolders(mintAddress) {
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
        
        const holders = accounts
            .map((acc) => {
                const parsed = acc.account.data.parsed;
                return {
                    address: acc.pubkey.toBase58(),
                    owner: parsed.info.owner,
                    amount: Number(parsed.info.tokenAmount.amount) / Math.pow(10, parsed.info.tokenAmount.decimals),
                };
            })
            .filter((a) => a.amount > 0);
        
        return holders;
    } catch (e) {
        console.error("Error fetching token holders:", e.message);
        return [];
    }
}

async function fetchTokenSupply(mintAddress) {
    try {
        const mintPublicKey = new PublicKey(mintAddress);
        const supplyInfo = await connection.getTokenSupply(mintPublicKey);
        return supplyInfo && supplyInfo.value ? supplyInfo.value.uiAmount || 0 : 0;
    } catch (e) {
        console.error("Error fetching token supply:", e.message);
        return 0;
    }
}

function calculateWheelPositions(holders) {
    if (holders.length === 0) return [];
    
    const totalTokens = holders.reduce((sum, holder) => sum + holder.amount, 0);
    const positions = [];
    let currentAngle = 0;
    
    // Sort holders by amount (descending) for better visual distribution
    const sortedHolders = [...holders].sort((a, b) => b.amount - a.amount);
    
    for (const holder of sortedHolders) {
        const sliceAngle = (holder.amount / totalTokens) * 360;
        const percentage = (holder.amount / totalTokens) * 100;
        
        positions.push({
            holder: holder.owner,
            tokens: holder.amount,
            percentage: percentage,
            startAngle: currentAngle,
            endAngle: currentAngle + sliceAngle,
            color: getRandomColor()
        });
        
        currentAngle += sliceAngle;
    }
    
    return positions;
}

function getRandomColor() {
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
        '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7BDE2'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

function selectWinner(holders) {
    if (holders.length === 0) return null;
    
    const totalTokens = holders.reduce((sum, holder) => sum + holder.amount, 0);
    let randomPoint = Math.random() * totalTokens;
    
    for (const holder of holders) {
        if (randomPoint < holder.amount) {
            return holder;
        }
        randomPoint -= holder.amount;
    }
    
    // Fallback to last holder if something goes wrong
    return holders[holders.length - 1];
}

async function spinWheel() {
    if (isSpinning || allHolders.length === 0) return;
    
    isSpinning = true;
    broadcastUpdate();
    
    console.log(`🎡 Starting Powerball wheel spin for ${allHolders.length} holders...`);
    
    // Simulate spinning animation
    for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log(`🔄 Spinning... ${i + 1}/3`);
    }
    
    const winner = selectWinner(allHolders);
    currentWinner = winner;
    
    const spinResult = {
        timestamp: new Date().toISOString(),
        winner: winner.owner,
        tokens: winner.tokens,
        percentage: (winner.tokens / tokenSupply) * 100,
        totalHolders: allHolders.length,
        tokenMint: currentTokenMint
    };
    
    wheelHistory.push(spinResult);
    
    // Keep only last 50 spins
    if (wheelHistory.length > 50) {
        wheelHistory = wheelHistory.slice(-50);
    }
    
    isSpinning = false;
    lastSpinTime = Date.now();
    nextSpinTime = lastSpinTime + WHEEL_SPIN_INTERVAL_MS;
    
    console.log(`🎉 POWERBALL WINNER: ${winner.owner}`);
    console.log(`🏆 Tokens: ${winner.tokens.toLocaleString()} (${spinResult.percentage.toFixed(4)}% of supply)`);
    console.log(`📊 Total holders: ${allHolders.length}`);
    console.log(`⏰ Next spin: ${new Date(nextSpinTime).toLocaleTimeString()}`);
    
    broadcastUpdate();
    return spinResult;
}

async function updateTokenData() {
    try {
        console.log(`🔄 Updating token data for ${currentTokenMint}...`);
        
        const [holders, supply] = await Promise.all([
            fetchAllTokenHolders(currentTokenMint),
            fetchTokenSupply(currentTokenMint)
        ]);
        
        allHolders = holders;
        tokenSupply = supply;
        wheelPositions = calculateWheelPositions(holders);
        
        console.log(`✅ Updated: ${holders.length} holders, ${supply.toLocaleString()} total supply`);
        broadcastUpdate();
        
        return true;
    } catch (error) {
        console.error('❌ Error updating token data:', error.message);
        return false;
    }
}

// API Routes
app.get("/", (req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
    <title>POWERBALL TOKEN WHEEL</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #0a0a0a;
            color: #00ff41;
            font-family: 'JetBrains Mono', monospace;
            min-height: 100vh;
            overflow-x: auto;
            font-size: 12px;
            line-height: 1.4;
        }
        .terminal-container {
            padding: 20px;
            max-width: 1400px;
            margin: 0 auto;
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid #00ff41;
            box-shadow: 0 0 20px #00ff4130;
        }
        .game-header {
            text-align: center;
            margin-bottom: 30px;
            color: #ffff00;
            font-size: 24px;
            font-weight: 700;
            text-shadow: 0 0 10px #ffff0080;
        }
        .token-input-section {
            margin: 20px 0;
            padding: 20px;
            border: 2px solid #00ffff;
            background: rgba(0, 255, 255, 0.05);
            text-align: center;
        }
        .token-input {
            width: 500px;
            max-width: 90%;
            padding: 10px;
            background: #000;
            border: 2px solid #00ff41;
            color: #00ff41;
            font-family: 'JetBrains Mono', monospace;
            margin: 10px;
        }
        .token-button {
            padding: 10px 20px;
            background: #00ff41;
            color: #000;
            border: none;
            font-family: 'JetBrains Mono', monospace;
            font-weight: 700;
            cursor: pointer;
            margin: 5px;
        }
        .token-button:hover {
            background: #ffff00;
        }
        .wheel-container {
            position: relative;
            width: 400px;
            height: 400px;
            margin: 0 auto;
            border: 4px solid #ff00ff;
            border-radius: 50%;
            overflow: hidden;
        }
        .wheel-slice {
            position: absolute;
            width: 100%;
            height: 100%;
            clip-path: polygon(50% 50%, 50% 0%, 100% 0%, 100% 100%, 50% 100%);
            transform-origin: 50% 50%;
        }
        .wheel-pointer {
            position: absolute;
            top: -20px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 15px solid transparent;
            border-right: 15px solid transparent;
            border-top: 30px solid #ffff00;
            z-index: 10;
        }
        .spinning {
            animation: spin 0.1s linear infinite;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .winner-section {
            margin: 20px 0;
            padding: 20px;
            border: 2px solid #ffff00;
            background: rgba(255, 255, 0, 0.05);
            text-align: center;
        }
        .winner-address {
            font-size: 16px;
            font-weight: 700;
            color: #ffff00;
            word-break: break-all;
            margin: 10px 0;
        }
        .winner-details {
            font-size: 14px;
            color: #00ff41;
        }
        .history-section {
            margin: 20px 0;
            padding: 20px;
            border: 2px solid #00ffff;
            background: rgba(0, 255, 255, 0.05);
        }
        .history-title {
            color: #00ffff;
            font-weight: 700;
            margin-bottom: 15px;
            text-align: center;
        }
        .history-list {
            max-height: 300px;
            overflow-y: auto;
        }
        .history-item {
            padding: 10px;
            margin: 5px 0;
            background: rgba(0, 255, 255, 0.1);
            border-left: 3px solid #00ffff;
        }
        .stats-section {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .stat-card {
            padding: 15px;
            border: 1px solid #00ff41;
            background: rgba(0, 255, 65, 0.05);
            text-align: center;
        }
        .stat-value {
            font-size: 18px;
            font-weight: 700;
            color: #ffff00;
            margin: 5px 0;
        }
        .stat-label {
            font-size: 11px;
            color: #00ff41;
            opacity: 0.8;
        }
        .connection-status {
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 5px 10px;
            background: #000;
            border: 1px solid #00ff41;
            font-size: 10px;
        }
        .status-connected { color: #00ff41; }
        .status-disconnected { color: #ff4444; }
        .countdown {
            font-size: 20px;
            font-weight: 700;
            color: #ff00ff;
            text-align: center;
            margin: 20px 0;
        }
        @media (max-width: 768px) {
            .wheel-container {
                width: 300px;
                height: 300px;
            }
            .token-input {
                width: 90%;
            }
        }
    </style>
</head>
<body>
    <div class="connection-status">
        <span id="connection-indicator">●</span> 
        <span id="connection-text">CONNECTING...</span>
    </div>
    
    <div class="terminal-container">
        <div class="game-header">
            🎡 POWERBALL TOKEN WHEEL 🎡
        </div>
        
        <div class="token-input-section">
            <div style="margin-bottom: 15px; color: #00ffff;">
                Enter Token Mint Address to Start the Game
            </div>
            <input type="text" class="token-input" id="token-input" placeholder="Enter token mint address..." value="${currentTokenMint}">
            <br>
            <button class="token-button" onclick="updateToken()">UPDATE TOKEN</button>
            <button class="token-button" onclick="refreshData()">REFRESH DATA</button>
        </div>
        
        <div class="stats-section">
            <div class="stat-card">
                <div class="stat-label">CURRENT TOKEN</div>
                <div class="stat-value" id="current-token">${currentTokenMint}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">TOTAL HOLDERS</div>
                <div class="stat-value" id="total-holders">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">TOKEN SUPPLY</div>
                <div class="stat-value" id="token-supply">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">NEXT SPIN IN</div>
                <div class="stat-value" id="next-spin">--:--</div>
            </div>
        </div>
        
        <div class="countdown" id="countdown">
            Next spin: Calculating...
        </div>
        
        <div class="wheel-container" id="wheel-container">
            <div class="wheel-pointer"></div>
            <div id="wheel-slices"></div>
        </div>
        
        <div class="winner-section" id="winner-section" style="display: none;">
            <div style="font-size: 20px; color: #ffff00; margin-bottom: 15px;">🎉 CURRENT WINNER 🎉</div>
            <div class="winner-address" id="winner-address"></div>
            <div class="winner-details" id="winner-details"></div>
        </div>
        
        <div class="history-section">
            <div class="history-title">📋 SPIN HISTORY 📋</div>
            <div class="history-list" id="history-list"></div>
        </div>
    </div>

    <script>
        let ws;
        let countdownInterval;
        
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(\`\${protocol}//\${window.location.host}\`);
            
            ws.onopen = () => {
                document.getElementById('connection-indicator').className = 'status-connected';
                document.getElementById('connection-text').textContent = 'CONNECTED';
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                updateWheel(data);
            };
            
            ws.onclose = () => {
                document.getElementById('connection-indicator').className = 'status-disconnected';
                document.getElementById('connection-text').textContent = 'RECONNECTING...';
                setTimeout(connectWebSocket, 3000);
            };
        }
        
        function updateWheel(data) {
            document.getElementById('current-token').textContent = data.currentTokenMint;
            document.getElementById('total-holders').textContent = data.totalHolders.toLocaleString();
            document.getElementById('token-supply').textContent = data.tokenSupply.toLocaleString();
            
            // Update wheel visualization
            const wheelSlices = document.getElementById('wheel-slices');
            wheelSlices.innerHTML = '';
            wheelSlices.className = data.isSpinning ? 'wheel-slices spinning' : 'wheel-slices';
            
            data.wheelPositions.forEach((slice, index) => {
                const sliceEl = document.createElement('div');
                sliceEl.className = 'wheel-slice';
                sliceEl.style.backgroundColor = slice.color;
                sliceEl.style.transform = \`rotate(\${slice.startAngle}deg)\`;
                sliceEl.title = \`\${slice.holder.substring(0, 8)}... - \${slice.tokens.toLocaleString()} tokens (\${slice.percentage.toFixed(2)}%)\`;
                wheelSlices.appendChild(sliceEl);
            });
            
            // Update winner section
            if (data.currentWinner) {
                document.getElementById('winner-section').style.display = 'block';
                document.getElementById('winner-address').innerHTML = \`
                    <a href="https://solscan.io/account/\${data.currentWinner.owner}" target="_blank" style="color: #ffff00;">
                        \${data.currentWinner.owner}
                    </a>
                \`;
                document.getElementById('winner-details').innerHTML = \`
                    \${data.currentWinner.tokens.toLocaleString()} tokens | \${((data.currentWinner.tokens / data.tokenSupply) * 100).toFixed(4)}% of supply
                \`;
            }
            
            // Update history
            const historyList = document.getElementById('history-list');
            historyList.innerHTML = data.wheelHistory.reverse().map(spin => \`
                <div class="history-item">
                    <div style="font-weight: 700;">
                        <a href="https://solscan.io/account/\${spin.winner}" target="_blank" style="color: #00ffff;">
                            \${spin.winner.substring(0, 8)}...\${spin.winner.substring(spin.winner.length - 8)}
                        </a>
                    </div>
                    <div style="font-size: 11px; color: #ccc;">
                        \${new Date(spin.timestamp).toLocaleString()} | \${spin.tokens.toLocaleString()} tokens (\${spin.percentage.toFixed(4)}%) | \${spin.totalHolders} holders
                    </div>
                </div>
            \`).join('');
            
            // Update countdown
            updateCountdown(data.timeUntilNextSpin);
        }
        
        function updateCountdown(timeUntilNextSpin) {
            if (countdownInterval) clearInterval(countdownInterval);
            
            function update() {
                const timeLeft = Math.max(0, timeUntilNextSpin);
                const minutes = Math.floor(timeLeft / 60000);
                const seconds = Math.floor((timeLeft % 60000) / 1000);
                
                document.getElementById('countdown').innerHTML = \`
                    🎡 Next Powerball Spin: \${minutes.toString().padStart(2, '0')}:\${seconds.toString().padStart(2, '0')}
                \`;
                
                document.getElementById('next-spin').textContent = \`\${minutes}m \${seconds}s\`;
                
                timeUntilNextSpin -= 1000;
            }
            
            update();
            countdownInterval = setInterval(update, 1000);
        }
        
        async function updateToken() {
            const tokenInput = document.getElementById('token-input').value.trim();
            if (!tokenInput) return;
            
            try {
                const response = await fetch('/api/update-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tokenMint: tokenInput })
                });
                
                const result = await response.json();
                if (result.success) {
                    alert('Token updated successfully!');
                } else {
                    alert('Error: ' + result.error);
                }
            } catch (error) {
                alert('Error updating token: ' + error.message);
            }
        }
        
        async function refreshData() {
            try {
                await fetch('/api/refresh-data', { method: 'POST' });
                alert('Data refresh initiated!');
            } catch (error) {
                alert('Error refreshing data: ' + error.message);
            }
        }
        
        connectWebSocket();
    </script>
</body>
</html>
    `);
});

app.post("/api/update-token", async (req, res) => {
    try {
        const { tokenMint } = req.body;
        
        if (!tokenMint) {
            return res.json({ success: false, error: "Token mint is required" });
        }
        
        // Validate the token mint format
        try {
            new PublicKey(tokenMint);
        } catch (e) {
            return res.json({ success: false, error: "Invalid token mint address" });
        }
        
        currentTokenMint = tokenMint;
        connection = new Connection(RPC_ENDPOINT, { commitment: "confirmed" });
        
        // Reset game state
        allHolders = [];
        wheelHistory = [];
        currentWinner = null;
        wheelPositions = [];
        lastSpinTime = null;
        nextSpinTime = null;
        
        // Update token data
        await updateTokenData();
        
        res.json({ success: true, message: "Token updated successfully" });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.post("/api/refresh-data", async (req, res) => {
    try {
        await updateTokenData();
        res.json({ success: true, message: "Data refreshed successfully" });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get("/api/status", (req, res) => {
    res.json(getCurrentWheelData());
});

const PORT = process.env.PORT || 1000;
server.listen(PORT, () => {
    console.log(`🎡 Powerball Wheel Server running on http://localhost:${PORT}`);
    console.log(`⏰ Wheel spins every 15 minutes`);
    console.log(`💰 Token holders have winning chances proportional to their holdings`);
    
    // Initialize with default token
    updateTokenData().then(() => {
        // Schedule first spin
        nextSpinTime = Date.now() + WHEEL_SPIN_INTERVAL_MS;
        console.log(`⏰ First spin scheduled for: ${new Date(nextSpinTime).toLocaleTimeString()}`);
    });
});

// Main game loop
async function gameLoop() {
    while (true) {
        try {
            // Update token data every minute
            await updateTokenData();
            
            // Check if it's time to spin the wheel
            const now = Date.now();
            if (nextSpinTime && now >= nextSpinTime && !isSpinning && allHolders.length > 0) {
                await spinWheel();
            }
            
            await new Promise(resolve => setTimeout(resolve, 60000)); // Check every minute
        } catch (error) {
            console.error('Error in game loop:', error);
            await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds on error
        }
    }
}

// Start the game loop
gameLoop().catch(console.error);
