import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.177.0/http/file_server.ts";

// Game State
interface Player {
  id: string;
  name: string;
  boardId: number;
  ws: WebSocket;
  joinedAt: Date;
  isAdmin: boolean;
  lastActive: Date;
}

interface GameState {
  gameActive: boolean;
  calledNumbers: number[];
  players: Map<string, Player>;
  gameStartedAt: Date | null;
  currentGameId: string;
  adminPassword: string;
  autoCallEnabled: boolean;
  callInterval: number;
  callTimer: number | null;
  lastCalledNumber: number | null;
}

// Initialize game state
const gameState: GameState = {
  gameActive: false,
  calledNumbers: [],
  players: new Map(),
  gameStartedAt: null,
  currentGameId: generateGameId(),
  adminPassword: "asse2123",
  autoCallEnabled: false,
  callInterval: 7000, // 7 seconds
  callTimer: null,
  lastCalledNumber: null
};

// Helper functions
function generateGameId(): string {
  return "BINGO-" + Date.now().toString(36).toUpperCase();
}

function generatePlayerId(): string {
  return "PLAYER-" + Math.random().toString(36).substr(2, 9);
}

function generateNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function validateAdminToken(token: string): boolean {
  return token === gameState.adminPassword;
}

function broadcastToPlayers(message: object, excludePlayerId?: string) {
  const messageStr = JSON.stringify(message);
  
  for (const [playerId, player] of gameState.players) {
    if (player.isAdmin) continue;
    if (playerId === excludePlayerId) continue;
    
    try {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(messageStr);
      }
    } catch (error) {
      console.error(`Error broadcasting to player ${playerId}:`, error);
    }
  }
}

function broadcastToAdmins(message: object) {
  const messageStr = JSON.stringify(message);
  
  for (const [playerId, player] of gameState.players) {
    if (!player.isAdmin) continue;
    
    try {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(messageStr);
      }
    } catch (error) {
      console.error(`Error broadcasting to admin ${playerId}:`, error);
    }
  }
}

function startAutoCall() {
  if (gameState.callTimer) {
    clearInterval(gameState.callTimer);
  }
  
  gameState.callTimer = setInterval(() => {
    if (gameState.gameActive && gameState.calledNumbers.length < 75) {
      let newNumber: number;
      do {
        newNumber = generateNumber(1, 75);
      } while (gameState.calledNumbers.includes(newNumber));
      
      gameState.calledNumbers.push(newNumber);
      gameState.lastCalledNumber = newNumber;
      
      broadcastToPlayers({
        type: "NUMBER_CALLED",
        number: newNumber,
        calledNumbers: gameState.calledNumbers,
        totalCalled: gameState.calledNumbers.length
      });
      
      broadcastToAdmins({
        type: "NUMBER_CALLED",
        number: newNumber,
        calledNumbers: gameState.calledNumbers,
        totalCalled: gameState.calledNumbers.length
      });
    }
  }, gameState.callInterval);
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  // Serve admin page
  if (url.pathname === "/admin" || url.pathname === "/admin.html") {
    const fileResponse = await serveDir(req, {
      fsRoot: ".",
      showDirListing: false,
      enableCors: true
    });
    
    if (fileResponse.status === 404) {
      const adminPage = `
<!DOCTYPE html>
<html>
<head>
    <title>Assefa Bingo - Admin Control</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f6fa; }
        .header { background: linear-gradient(135deg, #2c3e50, #4a6491); color: white; padding: 30px; border-radius: 15px; margin-bottom: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 25px; margin-bottom: 40px; }
        .control-card { background: white; border: none; border-radius: 15px; padding: 25px; box-shadow: 0 6px 15px rgba(0,0,0,0.08); transition: transform 0.3s, box-shadow 0.3s; }
        .control-card:hover { transform: translateY(-5px); box-shadow: 0 12px 20px rgba(0,0,0,0.12); }
        .control-card h3 { margin-top: 0; color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        .btn { padding: 12px 25px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 600; margin: 8px; transition: all 0.3s; display: inline-flex; align-items: center; gap: 8px; }
        .btn:hover { transform: scale(1.05); }
        .btn i { font-size: 18px; }
        .btn-primary { background: linear-gradient(135deg, #3498db, #2980b9); color: white; }
        .btn-success { background: linear-gradient(135deg, #2ecc71, #27ae60); color: white; }
        .btn-danger { background: linear-gradient(135deg, #e74c3c, #c0392b); color: white; }
        .btn-warning { background: linear-gradient(135deg, #f39c12, #e67e22); color: white; }
        .stats { background: white; padding: 20px; border-radius: 10px; margin: 20px 0; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .stat-item { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; }
        .stat-value { font-size: 28px; font-weight: bold; color: #2c3e50; display: block; }
        .stat-label { color: #7f8c8d; font-size: 14px; }
        .connected-players { margin-top: 40px; }
        .player-list { background: white; border-radius: 10px; padding: 15px; max-height: 400px; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .player-item { padding: 12px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
        .player-item:last-child { border-bottom: none; }
        .player-info { display: flex; gap: 15px; align-items: center; }
        .player-avatar { width: 40px; height: 40px; background: #3498db; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; }
        .status-connected { color: #2ecc71; font-weight: bold; }
        .status-disconnected { color: #e74c3c; }
        #loginPanel { text-align: center; margin-top: 100px; }
        .login-card { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); max-width: 400px; margin: 0 auto; }
        .login-card h1 { color: #2c3e50; margin-bottom: 10px; }
        .login-card p { color: #7f8c8d; margin-bottom: 30px; }
        .form-control { width: 100%; padding: 15px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; margin: 10px 0; transition: border 0.3s; }
        .form-control:focus { border-color: #3498db; outline: none; }
        #gamePanel { display: none; }
        .numbers-grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 8px; margin: 20px 0; }
        .number-badge { background: #3498db; color: white; padding: 10px; border-radius: 8px; text-align: center; font-weight: bold; font-size: 18px; }
        .number-badge.recent { background: #e74c3c; animation: pulse 2s infinite; }
        @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }
        .game-id-display { background: #2c3e50; color: white; padding: 15px; border-radius: 10px; font-family: monospace; font-size: 20px; text-align: center; margin: 20px 0; }
        .copy-btn { background: #7f8c8d; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; margin-left: 10px; }
        .copy-btn:hover { background: #95a5a6; }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
    <div id="loginPanel">
        <div class="login-card">
            <h1>🎮 Assefa Bingo Admin</h1>
            <p>Enter admin password to control the game</p>
            <input type="password" id="passwordInput" class="form-control" placeholder="Enter admin password" autocomplete="current-password">
            <button class="btn btn-primary" onclick="adminLogin()" style="width: 100%; padding: 15px; font-size: 18px;">
                <i class="fas fa-sign-in-alt"></i> Login
            </button>
            <div id="loginError" style="color: #e74c3c; margin-top: 15px; min-height: 20px;"></div>
            <div style="margin-top: 30px; color: #7f8c8d; font-size: 14px;">
                <p><i class="fas fa-info-circle"></i> Default password: <strong>asse2123</strong></p>
                <p><i class="fas fa-share-alt"></i> Share player link: <code id="playerLink"></code></p>
            </div>
        </div>
    </div>
    
    <div id="gamePanel">
        <div class="header">
            <h1><i class="fas fa-gamepad"></i> Assefa Bingo Game Control Panel</h1>
            <div class="stats">
                <div class="stat-grid">
                    <div class="stat-item">
                        <span class="stat-label">Game ID</span>
                        <span class="stat-value" id="gameId">${gameState.currentGameId}</span>
                        <button class="copy-btn" onclick="copyGameId()"><i class="fas fa-copy"></i> Copy</button>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Game Status</span>
                        <span class="stat-value" id="gameStatus">Inactive</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Connected Players</span>
                        <span class="stat-value" id="playerCount">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Called Numbers</span>
                        <span class="stat-value" id="calledCount">0</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="controls">
            <div class="control-card">
                <h3><i class="fas fa-play-circle"></i> Game Control</h3>
                <button class="btn btn-success" onclick="sendCommand('START_GAME')">
                    <i class="fas fa-play"></i> Start Game
                </button>
                <button class="btn btn-danger" onclick="sendCommand('STOP_GAME')">
                    <i class="fas fa-stop"></i> Stop Game
                </button>
                <button class="btn btn-warning" onclick="sendCommand('RESET_GAME')">
                    <i class="fas fa-redo"></i> Reset Game
                </button>
            </div>
            
            <div class="control-card">
                <h3><i class="fas fa-bullhorn"></i> Number Calling</h3>
                <button class="btn btn-primary" onclick="sendCommand('CALL_NUMBER')">
                    <i class="fas fa-random"></i> Call Random Number
                </button>
                <button class="btn btn-primary" id="autoCallBtn" onclick="sendCommand('TOGGLE_AUTO_CALL')">
                    <i class="fas fa-robot"></i> Auto-Call: OFF
                </button>
                <div style="margin-top: 20px;">
                    <label><i class="fas fa-clock"></i> Call Interval (seconds): </label>
                    <input type="range" id="callInterval" min="1" max="30" value="${gameState.callInterval/1000}" style="width: 200px; margin: 0 10px;">
                    <span id="intervalValue">${gameState.callInterval/1000}s</span>
                    <button class="btn" onclick="updateCallInterval()" style="margin-left: 10px;">Update</button>
                </div>
            </div>
            
            <div class="control-card">
                <h3><i class="fas fa-cog"></i> Game Settings</h3>
                <button class="btn btn-primary" onclick="sendCommand('GENERATE_NEW_GAME_ID')">
                    <i class="fas fa-sync"></i> New Game ID
                </button>
                <div style="margin-top: 20px;">
                    <label><i class="fas fa-key"></i> Change Admin Password: </label>
                    <input type="password" id="newPassword" class="form-control" placeholder="New password" style="margin: 10px 0;">
                    <button class="btn btn-primary" onclick="updateAdminPassword()">
                        <i class="fas fa-save"></i> Update Password
                    </button>
                </div>
            </div>
        </div>
        
        <div class="control-card">
            <h3><i class="fas fa-list-ol"></i> Called Numbers</h3>
            <div style="margin: 20px 0;">
                <h4>Last Called: <span id="lastCalled" style="font-size: 36px; color: #e74c3c; margin-left: 10px;">--</span></h4>
            </div>
            <div id="calledNumbersDisplay" class="numbers-grid">
                No numbers called yet
            </div>
            <div style="margin-top: 20px;">
                <button class="btn" onclick="sendCommand('CLEAR_NUMBERS')">
                    <i class="fas fa-trash"></i> Clear All Numbers
                </button>
            </div>
        </div>
        
        <div class="connected-players">
            <h3><i class="fas fa-users"></i> Connected Players (<span id="playersCount">0</span>)</h3>
            <div class="player-list" id="playerList">
                <div style="text-align: center; padding: 40px; color: #7f8c8d;">
                    <i class="fas fa-user-slash" style="font-size: 48px; margin-bottom: 15px;"></i>
                    <p>No players connected yet</p>
                </div>
            </div>
        </div>
        
        <div style="margin-top: 40px; text-align: center; color: #7f8c8d; font-size: 14px;">
            <p><i class="fas fa-share-alt"></i> Share player link: <code id="shareLink"></code></p>
            <button class="btn" onclick="copyPlayerLink()" style="margin-left: 10px;">
                <i class="fas fa-copy"></i> Copy Link
            </button>
        </div>
    </div>
    
    <script>
        let ws = null;
        let isAdmin = false;
        let gameId = "${gameState.currentGameId}";
        let serverUrl = window.location.origin.replace('http', 'ws');
        
        // Set player link
        const playerUrl = window.location.origin + '/';
        document.getElementById('playerLink').textContent = playerUrl;
        document.getElementById('shareLink').textContent = playerUrl;
        
        function adminLogin() {
            const password = document.getElementById('passwordInput').value;
            if (!password) {
                document.getElementById('loginError').textContent = 'Please enter password';
                return;
            }
            
            ws = new WebSocket(\`\${serverUrl}/ws?admin=true&token=\${encodeURIComponent(password)}\`);
            
            ws.onopen = function() {
                console.log('Admin WebSocket connected');
                document.getElementById('loginError').textContent = '';
            };
            
            ws.onmessage = function(event) {
                const data = JSON.parse(event.data);
                console.log('Admin received:', data.type);
                
                switch(data.type) {
                    case 'AUTH_RESULT':
                        if (data.success) {
                            isAdmin = true;
                            document.getElementById('loginPanel').style.display = 'none';
                            document.getElementById('gamePanel').style.display = 'block';
                            console.log('Admin authentication successful');
                        } else {
                            document.getElementById('loginError').textContent = 'Invalid admin password';
                            ws.close();
                        }
                        break;
                        
                    case 'GAME_STATE':
                        updateGameState(data);
                        break;
                        
                    case 'PLAYER_UPDATE':
                        updatePlayerList(data.players);
                        break;
                        
                    case 'NUMBER_CALLED':
                        updateCalledNumbers(data.number, data.calledNumbers);
                        break;
                        
                    case 'AUTO_CALL_TOGGLED':
                        document.getElementById('autoCallBtn').innerHTML = 
                            \`<i class="fas fa-robot"></i> Auto-Call: \${data.enabled ? 'ON' : 'OFF'}\`;
                        break;
                        
                    case 'BINGO_WINNER':
                        alert(\`🎉 BINGO! Winner: \${data.winnerName}\n🎯 Pattern: \${data.pattern}\`);
                        break;
                }
            };
            
            ws.onclose = function() {
                console.log('Admin WebSocket disconnected');
                if (!isAdmin) {
                    document.getElementById('loginError').textContent = 'Connection failed or invalid password';
                } else {
                    alert('Disconnected from server. Please refresh.');
                }
            };
        }
        
        function sendCommand(command, data = {}) {
            if (!ws || ws.readyState !== WebSocket.OPEN || !isAdmin) {
                alert('Not connected as admin');
                return;
            }
            
            ws.send(JSON.stringify({
                type: 'ADMIN_COMMAND',
                command: command,
                ...data
            }));
        }
        
        function updateGameState(data) {
            document.getElementById('gameStatus').textContent = data.gameActive ? 'Active' : 'Inactive';
            document.getElementById('gameId').textContent = data.gameId;
            document.getElementById('playerCount').textContent = data.playerCount;
            document.getElementById('calledCount').textContent = data.calledNumbers.length;
            document.getElementById('lastCalled').textContent = data.lastCalledNumber || '--';
            
            // Update game ID variable
            gameId = data.gameId;
            
            // Update called numbers display
            updateCalledNumbersDisplay(data.calledNumbers);
        }
        
        function updateCalledNumbers(newNumber, allNumbers) {
            document.getElementById('lastCalled').textContent = newNumber || '--';
            document.getElementById('calledCount').textContent = allNumbers.length;
            updateCalledNumbersDisplay(allNumbers);
        }
        
        function updateCalledNumbersDisplay(numbers) {
            const numbersDiv = document.getElementById('calledNumbersDisplay');
            if (numbers.length > 0) {
                let html = '';
                for (let i = 1; i <= 75; i++) {
                    const isCalled = numbers.includes(i);
                    const isRecent = numbers.length > 0 && i === numbers[numbers.length - 1];
                    html += \`<div class="number-badge \${isRecent ? 'recent' : ''}" style="background: \${isCalled ? '#3498db' : '#ecf0f1'}; color: \${isCalled ? 'white' : '#7f8c8d'};">\${i}</div>\`;
                }
                numbersDiv.innerHTML = html;
            } else {
                numbersDiv.innerHTML = 'No numbers called yet';
            }
        }
        
        function updatePlayerList(players) {
            const playerList = document.getElementById('playerList');
            const playersCount = document.getElementById('playersCount');
            
            playersCount.textContent = players.length;
            
            if (players.length > 0) {
                let html = '';
                players.forEach(player => {
                    const initial = player.name.charAt(0).toUpperCase();
                    const joinTime = new Date(player.joinedAt).toLocaleTimeString();
                    html += \`
                    <div class="player-item">
                        <div class="player-info">
                            <div class="player-avatar">\${initial}</div>
                            <div>
                                <strong>\${player.name}</strong><br>
                                <small>Board #\${player.boardId} | Joined: \${joinTime}</small>
                            </div>
                        </div>
                        <span class="status-connected">Connected</span>
                    </div>
                    \`;
                });
                playerList.innerHTML = html;
            } else {
                playerList.innerHTML = \`
                <div style="text-align: center; padding: 40px; color: #7f8c8d;">
                    <i class="fas fa-user-slash" style="font-size: 48px; margin-bottom: 15px;"></i>
                    <p>No players connected yet</p>
                </div>
                \`;
            }
        }
        
        function updateCallInterval() {
            const intervalInput = document.getElementById('callInterval');
            const interval = parseInt(intervalInput.value) * 1000;
            sendCommand('UPDATE_CALL_INTERVAL', { interval: interval });
        }
        
        function updateAdminPassword() {
            const newPassword = document.getElementById('newPassword').value;
            if (newPassword && confirm('Are you sure you want to update the admin password?')) {
                sendCommand('UPDATE_ADMIN_PASSWORD', { password: newPassword });
                document.getElementById('newPassword').value = '';
                alert('Admin password updated! New password: ' + newPassword);
            }
        }
        
        function copyGameId() {
            navigator.clipboard.writeText(gameId);
            alert('Game ID copied to clipboard: ' + gameId);
        }
        
        function copyPlayerLink() {
            navigator.clipboard.writeText(playerUrl);
            alert('Player link copied to clipboard!');
        }
        
        // Update interval display when slider changes
        document.getElementById('callInterval').addEventListener('input', function() {
            document.getElementById('intervalValue').textContent = this.value + 's';
        });
        
        // Auto-focus password input
        document.getElementById('passwordInput').focus();
        
        // Enter key to login
        document.getElementById('passwordInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                adminLogin();
            }
        });
    </script>
</body>
</html>`;
      
      return new Response(adminPage, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    
    return fileResponse;
  }
  
  // Handle WebSocket connections
  if (url.pathname === "/ws") {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 400 });
    }
    
    const { socket, response } = Deno.upgradeWebSocket(req);
    const params = new URLSearchParams(url.search);
    const isAdminConnection = params.get("admin") === "true";
    const adminToken = params.get("token");
    
    if (isAdminConnection) {
      handleAdminConnection(socket, adminToken);
    } else {
      handlePlayerConnection(socket, params);
    }
    
    return response;
  }
  
  // Player page
  const playerPage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Assefa Digital Bingo</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            margin: 0; 
            padding: 20px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .container { 
            max-width: 900px; 
            width: 100%;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .header { 
            background: linear-gradient(135deg, #2c3e50, #4a6491);
            color: white; 
            padding: 30px; 
            text-align: center;
        }
        .header h1 { 
            margin: 0 0 10px 0;
            font-size: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 15px;
        }
        .header p { 
            margin: 5px 0; 
            opacity: 0.9;
        }
        .game-area { 
            padding: 30px;
            display: grid;
            grid-template-columns: 1fr 2fr;
            gap: 30px;
        }
        @media (max-width: 768px) {
            .game-area { grid-template-columns: 1fr; }
        }
        .info-panel { 
            background: #f8f9fa;
            border-radius: 15px;
            padding: 25px;
        }
        .bingo-board { 
            background: white;
            border-radius: 15px;
            padding: 25px;
            border: 2px solid #e0e0e0;
        }
        .bingo-grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 10px;
            margin: 20px 0;
        }
        .bingo-cell {
            aspect-ratio: 1;
            background: #f8f9fa;
            border: 2px solid #3498db;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
        }
        .bingo-cell:hover {
            transform: scale(1.05);
            background: #e3f2fd;
        }
        .bingo-cell.marked {
            background: linear-gradient(135deg, #2ecc71, #27ae60);
            color: white;
            border-color: #27ae60;
        }
        .bingo-cell.center {
            background: #f39c12;
            color: white;
            border-color: #e67e22;
        }
        .btn {
            padding: 15px 30px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-size: 18px;
            font-weight: 600;
            margin: 10px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            transition: all 0.3s;
        }
        .btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 7px 14px rgba(0,0,0,0.1);
        }
        .btn-primary {
            background: linear-gradient(135deg, #3498db, #2980b9);
            color: white;
        }
        .btn-success {
            background: linear-gradient(135deg, #2ecc71, #27ae60);
            color: white;
        }
        .btn-danger {
            background: linear-gradient(135deg, #e74c3c, #c0392b);
            color: white;
        }
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
        }
        .called-numbers {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 15px 0;
            min-height: 150px;
            max-height: 300px;
            overflow-y: auto;
            padding: 10px;
            background: white;
            border-radius: 10px;
            border: 1px solid #e0e0e0;
        }
        .number-badge {
            background: #3498db;
            color: white;
            width: 50px;
            height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 10px;
            font-size: 20px;
            font-weight: bold;
        }
        .number-badge.recent {
            background: #e74c3c;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
        }
        .player-info {
            background: white;
            padding: 20px;
            border-radius: 10px;
            margin-top: 20px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
        }
        .status-connected {
            color: #2ecc71;
            font-weight: bold;
        }
        .status-disconnected {
            color: #e74c3c;
        }
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .modal-content {
            background: white;
            padding: 40px;
            border-radius: 20px;
            max-width: 500px;
            width: 90%;
            text-align: center;
        }
        .form-control {
            width: 100%;
            padding: 15px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 16px;
            margin: 10px 0;
            transition: border 0.3s;
        }
        .form-control:focus {
            border-color: #3498db;
            outline: none;
        }
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #2c3e50;
            color: white;
            padding: 15px 25px;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            z-index: 1000;
            animation: slideIn 0.3s;
        }
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        .game-id {
            background: rgba(255,255,255,0.1);
            padding: 10px 20px;
            border-radius: 50px;
            font-family: monospace;
            margin-top: 10px;
            display: inline-block;
        }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><i class="fas fa-dice"></i> Assefa Digital Bingo</h1>
            <p>Join the exciting bingo game with friends and family!</p>
            <div class="game-id" id="gameIdDisplay">Game ID: ${gameState.currentGameId}</div>
        </div>
        
        <div class="game-area">
            <div class="info-panel">
                <h2><i class="fas fa-bullhorn"></i> Called Numbers</h2>
                <div id="calledNumbers" class="called-numbers">
                    <div style="text-align: center; width: 100%; padding: 40px; color: #7f8c8d;">
                        <i class="fas fa-hourglass-half" style="font-size: 48px; margin-bottom: 15px;"></i>
                        <p>Waiting for numbers...</p>
                    </div>
                </div>
                
                <div class="player-info">
                    <h3><i class="fas fa-user"></i> Player Info</h3>
                    <p>Name: <span id="playerName" style="font-weight: bold;">Guest</span></p>
                    <p>Board #: <span id="boardId" style="font-weight: bold;">--</span></p>
                    <p>Status: <span id="connectionStatus" class="status-disconnected">Disconnected</span></p>
                    <p>Connected Players: <span id="playerCount" style="font-weight: bold;">0</span></p>
                </div>
                
                <div style="margin-top: 20px; text-align: center;">
                    <button class="btn btn-danger" onclick="resetGame()">
                        <i class="fas fa-redo"></i> Leave Game
                    </button>
                </div>
            </div>
            
            <div class="bingo-board">
                <h2><i class="fas fa-th-large"></i> Your Bingo Board</h2>
                <div id="boardDisplay" class="bingo-grid">
                    <!-- Board will be generated here -->
                </div>
                
                <div style="text-align: center; margin-top: 30px;">
                    <button class="btn btn-success btn-lg" id="bingoBtn" onclick="claimBingo()" disabled>
                        <i class="fas fa-trophy"></i> BINGO!
                    </button>
                </div>
                
                <div style="margin-top: 20px; text-align: center;">
                    <button class="btn btn-primary" onclick="joinGame()" id="joinBtn">
                        <i class="fas fa-sign-in-alt"></i> Join Game
                    </button>
                    <button class="btn" onclick="window.open('/admin', '_blank')">
                        <i class="fas fa-user-shield"></i> Admin Panel
                    </button>
                </div>
            </div>
        </div>
        
        <div style="padding: 20px 30px; background: #f8f9fa; border-top: 1px solid #e0e0e0; text-align: center; color: #7f8c8d;">
            <p>© 2024 Assefa Digital Bingo | Game ID: <span id="currentGameId">${gameState.currentGameId}</span></p>
        </div>
    </div>
    
    <!-- Join Modal -->
    <div class="modal" id="joinModal" style="display: flex;">
        <div class="modal-content">
            <h2><i class="fas fa-user-plus"></i> Join Bingo Game</h2>
            <p>Enter your name to join the game</p>
            
            <input type="text" id="inputPlayerName" class="form-control" 
                   placeholder="Your name" maxlength="20" autocomplete="off">
            
            <div style="margin: 20px 0;">
                <label style="display: block; text-align: left; margin-bottom: 5px;">
                    <i class="fas fa-hashtag"></i> Board Number (Optional)
                </label>
                <select id="inputBoardNumber" class="form-control">
                    <option value="">Random Board</option>
                    ${Array.from({length: 100}, (_, i) => i + 1).map(num => 
                      `<option value="${num}">Board #${num}</option>`
                    ).join('')}
                </select>
            </div>
            
            <button class="btn btn-primary" onclick="submitJoin()" style="width: 100%; padding: 15px;">
                <i class="fas fa-play"></i> Join Game
            </button>
        </div>
    </div>
    
    <div id="toastContainer"></div>
    
    <script>
        let ws = null;
        let playerId = null;
        let playerName = null;
        let boardNumbers = [];
        let boardId = null;
        
        function joinGame() {
            document.getElementById('joinModal').style.display = 'flex';
            document.getElementById('inputPlayerName').focus();
        }
        
        function submitJoin() {
            const nameInput = document.getElementById('inputPlayerName');
            const boardSelect = document.getElementById('inputBoardNumber');
            
            if (!nameInput.value.trim()) {
                showToast('Please enter your name', 'error');
                return;
            }
            
            playerName = nameInput.value.trim();
            boardId = boardSelect.value || Math.floor(Math.random() * 100) + 1;
            playerId = 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            // Connect to WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}/ws?playerId=\${playerId}&name=\${encodeURIComponent(playerName)}&boardId=\${boardId}\`;
            
            ws = new WebSocket(wsUrl);
            
            ws.onopen = function() {
                console.log('Connected to bingo server');
                document.getElementById('connectionStatus').textContent = 'Connected';
                document.getElementById('connectionStatus').className = 'status-connected';
                document.getElementById('playerName').textContent = playerName;
                document.getElementById('boardId').textContent = boardId;
                document.getElementById('joinBtn').style.display = 'none';
                document.getElementById('joinModal').style.display = 'none';
                showToast('Successfully joined the game!', 'success');
            };
            
            ws.onmessage = function(event) {
                const data = JSON.parse(event.data);
                console.log('Received:', data.type);
                
                switch(data.type) {
                    case 'WELCOME':
                        boardNumbers = data.boardNumbers;
                        boardId = data.boardId;
                        updateBoardDisplay();
                        updateGameState(data);
                        break;
                        
                    case 'NUMBER_CALLED':
                        updateCalledNumbers(data.number, data.calledNumbers);
                        updateBoardMarks(data.calledNumbers);
                        break;
                        
                    case 'GAME_STATE':
                        updateGameState(data);
                        break;
                        
                    case 'PLAYER_UPDATE':
                        document.getElementById('playerCount').textContent = data.playerCount;
                        break;
                        
                    case 'BINGO_WINNER':
                        showBingoWinner(data);
                        break;
                        
                    case 'BINGO_VERIFIED':
                        if (data.success) {
                            showToast('🎉 Congratulations! Your BINGO is verified!', 'success');
                        } else {
                            showToast('❌ Invalid BINGO claim. Please check your numbers.', 'error');
                        }
                        break;
                        
                    case 'GAME_STARTED':
                        showToast('🚀 Game has started! Good luck!', 'info');
                        break;
                        
                    case 'GAME_STOPPED':
                        showToast('⏹️ Game has been stopped', 'info');
                        break;
                        
                    case 'GAME_RESET':
                        showToast('🔄 Game has been reset', 'info');
                        resetPlayerBoard();
                        break;
                        
                    case 'NUMBERS_CLEARED':
                        showToast('🧹 Called numbers cleared', 'info');
                        document.getElementById('calledNumbers').innerHTML = 
                            '<div style="text-align: center; width: 100%; padding: 40px; color: #7f8c8d;">' +
                            '<i class="fas fa-hourglass-half" style="font-size: 48px; margin-bottom: 15px;"></i>' +
                            '<p>Waiting for numbers...</p></div>';
                        break;
                        
                    case 'NEW_GAME_ID':
                        document.getElementById('gameIdDisplay').textContent = 'Game ID: ' + data.gameId;
                        document.getElementById('currentGameId').textContent = data.gameId;
                        break;
                }
            };
            
            ws.onclose = function() {
                console.log('Disconnected from server');
                document.getElementById('connectionStatus').textContent = 'Disconnected';
                document.getElementById('connectionStatus').className = 'status-disconnected';
                document.getElementById('joinBtn').style.display = 'inline-flex';
                showToast('Disconnected from server', 'error');
            };
            
            ws.onerror = function(error) {
                console.error('WebSocket error:', error);
                showToast('Connection error', 'error');
            };
        }
        
        function updateBoardDisplay() {
            const boardDiv = document.getElementById('boardDisplay');
            let html = '';
            
            // Generate 5x5 grid
            for (let i = 0; i < 25; i++) {
                const num = boardNumbers[i];
                const isCenter = i === 12;
                const displayNum = isCenter ? 'FREE' : num;
                
                html += \`
                <div class="bingo-cell \${isCenter ? 'center' : ''}" 
                     id="cell-\${i}" 
                     data-number="\${num}"
                     onclick="toggleMark(\${i})">
                    \${displayNum}
                </div>\`;
            }
            
            boardDiv.innerHTML = html;
        }
        
        function updateCalledNumbers(newNumber, allNumbers) {
            const numbersDiv = document.getElementById('calledNumbers');
            
            if (allNumbers.length === 0) {
                numbersDiv.innerHTML = 
                    '<div style="text-align: center; width: 100%; padding: 40px; color: #7f8c8d;">' +
                    '<i class="fas fa-hourglass-half" style="font-size: 48px; margin-bottom: 15px;"></i>' +
                    '<p>Waiting for numbers...</p></div>';
                return;
            }
            
            let html = '';
            allNumbers.forEach(num => {
                const isRecent = num === newNumber;
                html += \`<div class="number-badge \${isRecent ? 'recent' : ''}">\${num}</div>\`;
            });
            numbersDiv.innerHTML = html;
            
            // Scroll to bottom
            numbersDiv.scrollTop = numbersDiv.scrollHeight;
        }
        
        function updateBoardMarks(calledNumbers) {
            // Mark cells that have been called
            for (let i = 0; i < 25; i++) {
                const cell = document.getElementById(\`cell-\${i}\`);
                const cellNumber = cell.getAttribute('data-number');
                
                if (calledNumbers.includes(parseInt(cellNumber)) || i === 12) {
                    cell.classList.add('marked');
                }
            }
            
            // Check for bingo
            checkForBingo();
        }
        
        function toggleMark(cellIndex) {
            if (cellIndex === 12) return; // Can't mark free space
            
            const cell = document.getElementById(\`cell-\${cellIndex}\`);
            cell.classList.toggle('marked');
            
            // Check for bingo after manual mark
            checkForBingo();
        }
        
        function checkForBingo() {
            // Count marked cells
            const markedCells = document.querySelectorAll('.bingo-cell.marked').length;
            
            // Enable bingo button if at least 5 cells are marked (including free space)
            if (markedCells >= 5) {
                document.getElementById('bingoBtn').disabled = false;
            } else {
                document.getElementById('bingoBtn').disabled = true;
            }
        }
        
        function claimBingo() {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                showToast('Not connected to server', 'error');
                return;
            }
            
            // Get marked numbers
            const markedCells = document.querySelectorAll('.bingo-cell.marked');
            const claimedNumbers = [];
            
            markedCells.forEach(cell => {
                const num = cell.getAttribute('data-number');
                if (num && cell.id !== 'cell-12') { // Exclude free space
                    claimedNumbers.push(parseInt(num));
                }
            });
            
            ws.send(JSON.stringify({
                type: 'BINGO_CLAIM',
                playerId: playerId,
                claimedNumbers: claimedNumbers
            }));
            
            showToast('🎯 BINGO claimed! Waiting for verification...', 'info');
        }
        
        function showBingoWinner(data) {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'flex';
            modal.innerHTML = \`
                <div class="modal-content">
                    <div style="font-size: 72px; color: gold; margin-bottom: 20px;">
                        <i class="fas fa-trophy"></i>
                    </div>
                    <h2>🎉 BINGO! 🎉</h2>
                    <h3 style="color: #2c3e50;">\${data.winnerName}</h3>
                    <p style="font-size: 18px; color: #7f8c8d; margin: 20px 0;">
                        has won the game!
                    </p>
                    <p style="background: #f8f9fa; padding: 15px; border-radius: 10px;">
                        Pattern: <strong>\${data.pattern}</strong>
                    </p>
                    <button class="btn btn-primary" onclick="this.parentElement.parentElement.remove()" 
                            style="margin-top: 30px; padding: 12px 30px;">
                        Continue
                    </button>
                </div>
            \`;
            document.body.appendChild(modal);
        }
        
        function updateGameState(data) {
            document.getElementById('gameIdDisplay').textContent = 'Game ID: ' + data.gameId;
            document.getElementById('currentGameId').textContent = data.gameId;
        }
        
        function resetGame() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
            
            playerId = null;
            playerName = null;
            boardNumbers = [];
            boardId = null;
            
            document.getElementById('playerName').textContent = 'Guest';
            document.getElementById('boardId').textContent = '--';
            document.getElementById('playerCount').textContent = '0';
            document.getElementById('connectionStatus').textContent = 'Disconnected';
            document.getElementById('connectionStatus').className = 'status-disconnected';
            document.getElementById('joinBtn').style.display = 'inline-flex';
            document.getElementById('bingoBtn').disabled = true;
            
            // Reset board display
            document.getElementById('boardDisplay').innerHTML = '';
            
            // Reset called numbers
            document.getElementById('calledNumbers').innerHTML = 
                '<div style="text-align: center; width: 100%; padding: 40px; color: #7f8c8d;">' +
                '<i class="fas fa-hourglass-half" style="font-size: 48px; margin-bottom: 15px;"></i>' +
                '<p>Waiting for numbers...</p></div>';
        }
        
        function resetPlayerBoard() {
            // Remove marks from all cells except center
            for (let i = 0; i < 25; i++) {
                const cell = document.getElementById(\`cell-\${i}\`);
                if (cell && i !== 12) {
                    cell.classList.remove('marked');
                }
            }
            document.getElementById('bingoBtn').disabled = true;
        }
        
        function showToast(message, type) {
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.style.background = type === 'error' ? '#e74c3c' : 
                                   type === 'success' ? '#2ecc71' : '#3498db';
            toast.innerHTML = \`
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-\${type === 'error' ? 'exclamation-circle' : 
                                     type === 'success' ? 'check-circle' : 'info-circle'}"></i>
                    <span>\${message}</span>
                </div>
            \`;
            
            document.getElementById('toastContainer').appendChild(toast);
            
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.3s';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
        
        // Auto-focus name input when modal opens
        document.getElementById('inputPlayerName').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                submitJoin();
            }
        });
        
        // Close modal when clicking outside
        document.getElementById('joinModal').addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
            }
        });
        
        // Auto-join after page load (with delay)
        window.addEventListener('load', function() {
            setTimeout(() => {
                if (!playerId) {
                    joinGame();
                }
            }, 1000);
        });
    </script>
</body>
</html>`;
  
  return new Response(playerPage, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function handleAdminConnection(ws: WebSocket, token: string | null) {
  const adminId = "ADMIN-" + Date.now();
  
  if (!token || !validateAdminToken(token)) {
    ws.send(JSON.stringify({
      type: "AUTH_RESULT",
      success: false,
      message: "Invalid admin password"
    }));
    ws.close();
    return;
  }
  
  const adminPlayer: Player = {
    id: adminId,
    name: "ADMIN",
    boardId: 0,
    ws: ws,
    joinedAt: new Date(),
    isAdmin: true,
    lastActive: new Date()
  };
  
  gameState.players.set(adminId, adminPlayer);
  console.log(`🔧 Admin connected: ${adminId}`);
  
  ws.send(JSON.stringify({
    type: "AUTH_RESULT",
    success: true,
    message: "Admin authenticated successfully"
  }));
  
  // Send current game state
  ws.send(JSON.stringify({
    type: "GAME_STATE",
    gameActive: gameState.gameActive,
    gameId: gameState.currentGameId,
    calledNumbers: gameState.calledNumbers,
    playerCount: Array.from(gameState.players.values()).filter(p => !p.isAdmin).length,
    lastCalledNumber: gameState.lastCalledNumber,
    autoCallEnabled: gameState.autoCallEnabled,
    callInterval: gameState.callInterval
  }));
  
  // Send player list
  updateAdminPlayerList();
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === "ADMIN_COMMAND") {
        handleAdminCommand(data, adminId);
      }
      
      const player = gameState.players.get(adminId);
      if (player) {
        player.lastActive = new Date();
      }
    } catch (error) {
      console.error("Error processing admin message:", error);
    }
  };
  
  ws.onclose = () => {
    console.log(`🔧 Admin disconnected: ${adminId}`);
    gameState.players.delete(adminId);
  };
  
  ws.onerror = (error) => {
    console.error(`🔧 Admin WebSocket error (${adminId}):`, error);
  };
}

function handlePlayerConnection(ws: WebSocket, params: URLSearchParams) {
  const playerId = params.get("playerId") || generatePlayerId();
  const playerName = params.get("name") || `Player${Math.floor(Math.random() * 1000)}`;
  const boardId = parseInt(params.get("boardId") || "0") || Math.floor(Math.random() * 100) + 1;
  
  const player: Player = {
    id: playerId,
    name: playerName,
    boardId: boardId,
    ws: ws,
    joinedAt: new Date(),
    isAdmin: false,
    lastActive: new Date()
  };
  
  gameState.players.set(playerId, player);
  console.log(`🎮 Player connected: ${playerName} (Board #${boardId})`);
  
  // Generate random board numbers
  const boardNumbers: number[] = [];
  for (let i = 0; i < 25; i++) {
    if (i === 12) {
      boardNumbers.push(0); // Center free space
    } else {
      let num: number;
      do {
        num = generateNumber(1, 75);
      } while (boardNumbers.includes(num));
      boardNumbers.push(num);
    }
  }
  
  ws.send(JSON.stringify({
    type: "WELCOME",
    playerId: playerId,
    playerName: playerName,
    boardId: boardId,
    boardNumbers: boardNumbers,
    gameId: gameState.currentGameId,
    gameActive: gameState.gameActive,
    calledNumbers: gameState.calledNumbers
  }));
  
  updateAdminPlayerList();
  broadcastPlayerCount();
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === "BINGO_CLAIM") {
        handleBingoClaim(playerId, data);
      }
      
      player.lastActive = new Date();
    } catch (error) {
      console.error("Error processing player message:", error);
    }
  };
  
  ws.onclose = () => {
    console.log(`🎮 Player disconnected: ${playerName} (${playerId})`);
    gameState.players.delete(playerId);
    updateAdminPlayerList();
    broadcastPlayerCount();
  };
  
  ws.onerror = (error) => {
    console.error(`🎮 Player WebSocket error (${playerId}):`, error);
  };
}

function handleAdminCommand(data: any, adminId: string) {
  const command = data.command;
  console.log(`🔧 Admin command: ${command} from ${adminId}`);
  
  switch (command) {
    case "START_GAME":
      gameState.gameActive = true;
      gameState.gameStartedAt = new Date();
      
      broadcastToPlayers({
        type: "GAME_STARTED",
        message: "Game has started!",
        gameId: gameState.currentGameId
      });
      
      broadcastToAdmins({
        type: "GAME_STATE_UPDATE",
        gameActive: true,
        gameStartedAt: gameState.gameStartedAt
      });
      break;
      
    case "STOP_GAME":
      gameState.gameActive = false;
      if (gameState.callTimer) {
        clearInterval(gameState.callTimer);
        gameState.callTimer = null;
      }
      
      broadcastToPlayers({
        type: "GAME_STOPPED",
        message: "Game has been stopped"
      });
      
      broadcastToAdmins({
        type: "GAME_STATE_UPDATE",
        gameActive: false
      });
      break;
      
    case "RESET_GAME":
      gameState.calledNumbers = [];
      gameState.gameActive = false;
      gameState.gameStartedAt = null;
      gameState.lastCalledNumber = null;
      
      if (gameState.callTimer) {
        clearInterval(gameState.callTimer);
        gameState.callTimer = null;
      }
      
      broadcastToPlayers({
        type: "GAME_RESET",
        message: "Game has been reset"
      });
      
      broadcastToAdmins({
        type: "GAME_STATE_UPDATE",
        gameActive: false,
        calledNumbers: []
      });
      break;
      
    case "CALL_NUMBER":
      if (gameState.calledNumbers.length >= 75) {
        return;
      }
      
      let newNumber: number;
      do {
        newNumber = generateNumber(1, 75);
      } while (gameState.calledNumbers.includes(newNumber));
      
      gameState.calledNumbers.push(newNumber);
      gameState.lastCalledNumber = newNumber;
      
      broadcastToPlayers({
        type: "NUMBER_CALLED",
        number: newNumber,
        calledNumbers: gameState.calledNumbers,
        totalCalled: gameState.calledNumbers.length
      });
      
      broadcastToAdmins({
        type: "NUMBER_CALLED",
        number: newNumber,
        calledNumbers: gameState.calledNumbers,
        totalCalled: gameState.calledNumbers.length
      });
      break;
      
    case "TOGGLE_AUTO_CALL":
      gameState.autoCallEnabled = !gameState.autoCallEnabled;
      
      if (gameState.autoCallEnabled) {
        startAutoCall();
      } else if (gameState.callTimer) {
        clearInterval(gameState.callTimer);
        gameState.callTimer = null;
      }
      
      broadcastToAdmins({
        type: "AUTO_CALL_TOGGLED",
        enabled: gameState.autoCallEnabled
      });
      break;
      
    case "UPDATE_CALL_INTERVAL":
      const interval = data.interval;
      if (interval && interval >= 1000 && interval <= 30000) {
        gameState.callInterval = interval;
        
        if (gameState.autoCallEnabled && gameState.callTimer) {
          clearInterval(gameState.callTimer);
          startAutoCall();
        }
      }
      break;
      
    case "CLEAR_NUMBERS":
      gameState.calledNumbers = [];
      gameState.lastCalledNumber = null;
      
      broadcastToPlayers({
        type: "NUMBERS_CLEARED",
        message: "Called numbers have been cleared"
      });
      
      broadcastToAdmins({
        type: "GAME_STATE_UPDATE",
        calledNumbers: []
      });
      break;
      
    case "GENERATE_NEW_GAME_ID":
      gameState.currentGameId = generateGameId();
      
      broadcastToPlayers({
        type: "NEW_GAME_ID",
        gameId: gameState.currentGameId
      });
      
      broadcastToAdmins({
        type: "GAME_STATE_UPDATE",
        gameId: gameState.currentGameId
      });
      break;
      
    case "UPDATE_ADMIN_PASSWORD":
      if (data.password && data.password.length >= 4) {
        gameState.adminPassword = data.password;
        console.log("🔐 Admin password updated");
      }
      break;
  }
  
  const admin = gameState.players.get(adminId);
  if (admin && admin.ws.readyState === WebSocket.OPEN) {
    admin.ws.send(JSON.stringify({
      type: "GAME_STATE",
      gameActive: gameState.gameActive,
      gameId: gameState.currentGameId,
      calledNumbers: gameState.calledNumbers,
      playerCount: Array.from(gameState.players.values()).filter(p => !p.isAdmin).length,
      lastCalledNumber: gameState.lastCalledNumber,
      autoCallEnabled: gameState.autoCallEnabled,
      callInterval: gameState.callInterval
    }));
  }
}

function handleBingoClaim(playerId: string, data: any) {
  const player = gameState.players.get(playerId);
  if (!player) return;
  
  console.log(`🎉 BINGO claim from ${player.name} (${playerId})`);
  
  const claimedNumbers = data.claimedNumbers || [];
  
  const isValid = claimedNumbers.every((num: number) => 
    gameState.calledNumbers.includes(num)
  ) && claimedNumbers.length >= 5;
  
  if (isValid) {
    broadcastToPlayers({
      type: "BINGO_WINNER",
      winnerName: player.name,
      winnerId: playerId,
      pattern: "BINGO!",
      timestamp: new Date().toISOString()
    }, playerId);
    
    player.ws.send(JSON.stringify({
      type: "BINGO_VERIFIED",
      success: true,
      message: "Congratulations! Your BINGO claim is verified!"
    }));
    
    broadcastToAdmins({
      type: "BINGO_WINNER",
      winnerName: player.name,
      winnerId: playerId,
      pattern: "BINGO!",
      timestamp: new Date().toISOString()
    });
    
    gameState.gameActive = false;
    if (gameState.callTimer) {
      clearInterval(gameState.callTimer);
      gameState.callTimer = null;
    }
  } else {
    player.ws.send(JSON.stringify({
      type: "BINGO_VERIFIED",
      success: false,
      message: "Invalid BINGO claim. Please check your numbers."
    }));
  }
}

function updateAdminPlayerList() {
  const playerList = Array.from(gameState.players.values())
    .filter(p => !p.isAdmin)
    .map(p => ({
      id: p.id,
      name: p.name,
      boardId: p.boardId,
      joinedAt: p.joinedAt.toISOString(),
      lastActive: p.lastActive.toISOString()
    }));
  
  broadcastToAdmins({
    type: "PLAYER_UPDATE",
    players: playerList,
    totalPlayers: playerList.length
  });
}

function broadcastPlayerCount() {
  const playerCount = Array.from(gameState.players.values()).filter(p => !p.isAdmin).length;
  
  broadcastToPlayers({
    type: "PLAYER_UPDATE",
    playerCount: playerCount
  });
  
  broadcastToAdmins({
    type: "PLAYER_COUNT_UPDATE",
    playerCount: playerCount
  });
}

// Cleanup inactive players
setInterval(() => {
  const now = new Date();
  const timeout = 5 * 60 * 1000;
  
  for (const [playerId, player] of gameState.players) {
    if (now.getTime() - player.lastActive.getTime() > timeout) {
      console.log(`Removing inactive player: ${player.name} (${playerId})`);
      try {
        player.ws.close();
      } catch (error) {}
      gameState.players.delete(playerId);
    }
  }
  
  if (gameState.players.size > 0) {
    updateAdminPlayerList();
    broadcastPlayerCount();
  }
}, 60000);

// Get local IP address for network access
async function getLocalIP(): Promise<string> {
  try {
    const interfaces = Deno.networkInterfaces();
    for (const iface of interfaces) {
      if (iface.family === "IPv4" && !iface.address.startsWith("127.") && !iface.address.startsWith("169.254.")) {
        return iface.address;
      }
    }
  } catch (error) {
    console.log("Could not retrieve network interfaces");
  }
  return "localhost";
}

// Start server with network information
getLocalIP().then(localIp => {
  console.log("\n" + "=".repeat(50));
  console.log("🎮 AS
