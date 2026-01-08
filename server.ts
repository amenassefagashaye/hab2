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
  // Simple token validation - in production use JWT or similar
  return token === gameState.adminPassword;
}

function broadcastToPlayers(message: object, excludePlayerId?: string) {
  const messageStr = JSON.stringify(message);
  
  for (const [playerId, player] of gameState.players) {
    if (player.isAdmin) continue; // Don't send to admin
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
      
      // Broadcast to all players
      broadcastToPlayers({
        type: "NUMBER_CALLED",
        number: newNumber,
        calledNumbers: gameState.calledNumbers,
        totalCalled: gameState.calledNumbers.length
      });
      
      // Update admins
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
  
  // Serve static files for admin page
  if (url.pathname === "/admin" || url.pathname === "/admin.html") {
    const fileResponse = await serveDir(req, {
      fsRoot: ".",
      showDirListing: false,
      enableCors: true
    });
    
    // If file not found, return basic admin page
    if (fileResponse.status === 404) {
      const adminPage = `
<!DOCTYPE html>
<html>
<head>
    <title>Assefa Bingo - Admin Control</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: #2c3e50; color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
        .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .control-card { background: white; border: 1px solid #ddd; border-radius: 10px; padding: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .control-card h3 { margin-top: 0; color: #2c3e50; }
        .btn { padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; margin: 5px; }
        .btn-primary { background: #3498db; color: white; }
        .btn-success { background: #2ecc71; color: white; }
        .btn-danger { background: #e74c3c; color: white; }
        .btn-warning { background: #f39c12; color: white; }
        .stats { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 10px 0; }
        .connected-players { margin-top: 30px; }
        .player-list { background: white; border: 1px solid #ddd; border-radius: 5px; padding: 10px; max-height: 300px; overflow-y: auto; }
        .player-item { padding: 10px; border-bottom: 1px solid #eee; }
        .player-item:last-child { border-bottom: none; }
        .status-connected { color: #2ecc71; }
        .status-disconnected { color: #e74c3c; }
        #loginPanel { text-align: center; margin-top: 100px; }
        #loginPanel input { padding: 10px; margin: 10px; width: 200px; }
        #gamePanel { display: none; }
    </style>
</head>
<body>
    <div id="loginPanel">
        <div class="header">
            <h1>Assefa Bingo - Admin Login</h1>
            <p>Enter admin password to control the game</p>
        </div>
        <input type="password" id="passwordInput" placeholder="Admin Password">
        <button class="btn btn-primary" onclick="adminLogin()">Login</button>
        <div id="loginError" style="color: red; margin-top: 10px;"></div>
    </div>
    
    <div id="gamePanel">
        <div class="header">
            <h1>🎮 Assefa Bingo Game Control</h1>
            <div class="stats">
                <strong>Game ID:</strong> <span id="gameId">${gameState.currentGameId}</span> | 
                <strong>Status:</strong> <span id="gameStatus">Inactive</span> | 
                <strong>Players:</strong> <span id="playerCount">0</span> | 
                <strong>Called Numbers:</strong> <span id="calledCount">0</span>
            </div>
        </div>
        
        <div class="controls">
            <div class="control-card">
                <h3>Game Control</h3>
                <button class="btn btn-success" onclick="sendCommand('START_GAME')">Start Game</button>
                <button class="btn btn-danger" onclick="sendCommand('STOP_GAME')">Stop Game</button>
                <button class="btn btn-warning" onclick="sendCommand('RESET_GAME')">Reset Game</button>
            </div>
            
            <div class="control-card">
                <h3>Number Calling</h3>
                <button class="btn btn-primary" onclick="sendCommand('CALL_NUMBER')">Call Random Number</button>
                <button class="btn btn-primary" onclick="sendCommand('TOGGLE_AUTO_CALL')">Toggle Auto-Call</button>
                <div style="margin-top: 10px;">
                    <label>Auto-call Interval (ms): </label>
                    <input type="number" id="callInterval" value="${gameState.callInterval}" style="width: 100px;">
                    <button class="btn btn-primary" onclick="updateCallInterval()">Update</button>
                </div>
            </div>
            
            <div class="control-card">
                <h3>Game Settings</h3>
                <button class="btn btn-primary" onclick="sendCommand('GENERATE_NEW_GAME_ID')">New Game ID</button>
                <div style="margin-top: 10px;">
                    <label>Admin Password: </label>
                    <input type="password" id="newPassword" placeholder="New password">
                    <button class="btn btn-primary" onclick="updateAdminPassword()">Update</button>
                </div>
            </div>
        </div>
        
        <div class="control-card">
            <h3>Called Numbers</h3>
            <div id="calledNumbersDisplay" style="display: flex; flex-wrap: wrap; gap: 5px; min-height: 50px;">
                No numbers called yet
            </div>
            <div style="margin-top: 10px;">
                <button class="btn" onclick="sendCommand('CLEAR_NUMBERS')">Clear Called Numbers</button>
            </div>
        </div>
        
        <div class="connected-players">
            <h3>Connected Players</h3>
            <div class="player-list" id="playerList">
                No players connected
            </div>
        </div>
    </div>
    
    <script>
        let ws = null;
        let isAdmin = false;
        
        function adminLogin() {
            const password = document.getElementById('passwordInput').value;
            if (!password) {
                document.getElementById('loginError').textContent = 'Please enter password';
                return;
            }
            
            // Connect to WebSocket with admin token
            ws = new WebSocket(\`ws://\${window.location.host}/ws?admin=true&token=\${encodeURIComponent(password)}\`);
            
            ws.onopen = function() {
                console.log('Admin WebSocket connected');
                document.getElementById('loginError').textContent = '';
            };
            
            ws.onmessage = function(event) {
                const data = JSON.parse(event.data);
                
                if (data.type === 'AUTH_RESULT') {
                    if (data.success) {
                        isAdmin = true;
                        document.getElementById('loginPanel').style.display = 'none';
                        document.getElementById('gamePanel').style.display = 'block';
                        console.log('Admin authentication successful');
                    } else {
                        document.getElementById('loginError').textContent = 'Invalid admin password';
                        ws.close();
                    }
                } else if (data.type === 'GAME_STATE') {
                    updateGameState(data);
                } else if (data.type === 'PLAYER_UPDATE') {
                    updatePlayerList(data.players);
                }
            };
            
            ws.onclose = function() {
                console.log('Admin WebSocket disconnected');
                if (!isAdmin) {
                    document.getElementById('loginError').textContent = 'Connection failed';
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
            
            // Update called numbers display
            const numbersDiv = document.getElementById('calledNumbersDisplay');
            if (data.calledNumbers.length > 0) {
                numbersDiv.innerHTML = data.calledNumbers.map(num => 
                    \`<div style="background: #3498db; color: white; padding: 5px 10px; border-radius: 5px;">\${num}</div>\`
                ).join('');
            } else {
                numbersDiv.innerHTML = 'No numbers called yet';
            }
        }
        
        function updatePlayerList(players) {
            const playerList = document.getElementById('playerList');
            if (players.length > 0) {
                playerList.innerHTML = players.map(player => 
                    \`<div class="player-item">
                        <strong>\${player.name}</strong> (Board: \${player.boardId}) - 
                        <span class="status-connected">Connected</span>
                    </div>\`
                ).join('');
            } else {
                playerList.innerHTML = 'No players connected';
            }
        }
        
        function updateCallInterval() {
            const interval = document.getElementById('callInterval').value;
            sendCommand('UPDATE_CALL_INTERVAL', { interval: parseInt(interval) });
        }
        
        function updateAdminPassword() {
            const newPassword = document.getElementById('newPassword').value;
            if (newPassword && confirm('Are you sure you want to update the admin password?')) {
                sendCommand('UPDATE_ADMIN_PASSWORD', { password: newPassword });
                document.getElementById('newPassword').value = '';
            }
        }
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
      // ADMIN CONNECTION - Require password validation
      handleAdminConnection(socket, adminToken);
    } else {
      // PLAYER CONNECTION
      handlePlayerConnection(socket, params);
    }
    
    return response;
  }
  
  // Default route - serve player page
  const playerPage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Assefa Digital Bingo - Player</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f0f2f5; }
        .container { max-width: 800px; margin: 0 auto; }
        .header { background: #2c3e50; color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
        .game-area { display: grid; grid-template-columns: 1fr 2fr; gap: 20px; }
        .info-panel { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .bingo-board { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .bingo-row { display: flex; justify-content: center; margin: 5px 0; }
        .bingo-cell { width: 50px; height: 50px; border: 2px solid #3498db; margin: 0 5px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 18px; cursor: pointer; border-radius: 5px; }
        .bingo-cell.marked { background: #2ecc71; color: white; }
        .btn { padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
        .btn-primary { background: #3498db; color: white; }
        .btn-success { background: #2ecc71; color: white; }
        .btn-danger { background: #e74c3c; color: white; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Assefa Digital Bingo</h1>
            <p>Game ID: <span id="gameId">${gameState.currentGameId}</span></p>
            <p>Status: <span id="gameStatus">Waiting to start...</span></p>
        </div>
        
        <div class="game-area">
            <div class="info-panel">
                <h3>Called Numbers</h3>
                <div id="calledNumbers" style="min-height: 200px; border: 1px solid #ddd; padding: 10px; border-radius: 5px;">
                    No numbers called yet
                </div>
                <div style="margin-top: 20px;">
                    <h4>Player Info</h4>
                    <p>Name: <span id="playerName">Guest</span></p>
                    <p>Board: <span id="boardId">--</span></p>
                    <p>Connected Players: <span id="playerCount">0</span></p>
                </div>
            </div>
            
            <div class="bingo-board">
                <h3>Your Bingo Board</h3>
                <div id="boardDisplay">
                    Loading board...
                </div>
                <div style="margin-top: 20px;">
                    <button class="btn btn-success" id="bingoBtn" disabled onclick="claimBingo()">BINGO!</button>
                    <button class="btn btn-primary" onclick="joinGame()">Join Game</button>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        let ws = null;
        let playerId = null;
        let boardNumbers = [];
        
        function joinGame() {
            const playerName = prompt("Enter your name:", "Player" + Math.floor(Math.random() * 1000));
            if (!playerName) return;
            
            playerId = 'player_' + Date.now();
            ws = new WebSocket(\`ws://\${window.location.host}/ws?playerId=\${playerId}&name=\${encodeURIComponent(playerName)}\`);
            
            ws.onopen = function() {
                console.log('Connected to game server');
                document.getElementById('playerName').textContent = playerName;
            };
            
            ws.onmessage = function(event) {
                const data = JSON.parse(event.data);
                console.log('Received:', data);
                
                switch(data.type) {
                    case 'WELCOME':
                        boardNumbers = data.boardNumbers;
                        updateBoardDisplay();
                        document.getElementById('boardId').textContent = data.boardId;
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
                        alert(\`BINGO! Winner: \${data.winnerName} with pattern: \${data.pattern}\`);
                        break;
                    case 'GAME_STARTED':
                        alert('Game has started! Good luck!');
                        document.getElementById('gameStatus').textContent = 'Game Active';
                        break;
                    case 'GAME_STOPPED':
                        alert('Game has stopped');
                        document.getElementById('gameStatus').textContent = 'Game Stopped';
                        break;
                }
            };
            
            ws.onclose = function() {
                console.log('Disconnected from game server');
            };
        }
        
        function updateBoardDisplay() {
            const boardDiv = document.getElementById('boardDisplay');
            let html = '<div class="bingo-row">';
            boardNumbers.forEach((num, index) => {
                if (index > 0 && index % 5 === 0) {
                    html += '</div><div class="bingo-row">';
                }
                html += \`<div class="bingo-cell" id="cell-\${num}">\${num}</div>\`;
            });
            html += '</div>';
            boardDiv.innerHTML = html;
        }
        
        function updateCalledNumbers(newNumber, allNumbers) {
            const numbersDiv = document.getElementById('calledNumbers');
            numbersDiv.innerHTML = \`<h4>Last called: <span style="font-size: 24px; color: #e74c3c;">\${newNumber}</span></h4>\`;
            numbersDiv.innerHTML += allNumbers.map(num => \`<span style="display: inline-block; padding: 5px; margin: 2px; background: #3498db; color: white; border-radius: 3px;">\${num}</span>\`).join('');
        }
        
        function updateBoardMarks(calledNumbers) {
            calledNumbers.forEach(num => {
                const cell = document.getElementById(\`cell-\${num}\`);
                if (cell) {
                    cell.classList.add('marked');
                }
            });
            
            // Check for bingo
            checkForBingo();
        }
        
        function checkForBingo() {
            // Simple bingo check - in real app, implement proper pattern checking
            const markedCells = document.querySelectorAll('.bingo-cell.marked');
            if (markedCells.length >= 5) {
                document.getElementById('bingoBtn').disabled = false;
            }
        }
        
        function claimBingo() {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            
            ws.send(JSON.stringify({
                type: 'BINGO_CLAIM',
                playerId: playerId,
                claimedNumbers: boardNumbers.filter(num => 
                    document.getElementById(\`cell-\${num}\`).classList.contains('marked')
                )
            }));
        }
        
        function updateGameState(data) {
            document.getElementById('gameId').textContent = data.gameId;
            document.getElementById('gameStatus').textContent = data.gameActive ? 'Game Active' : 'Waiting';
        }
        
        // Auto-join on page load
        window.onload = function() {
            setTimeout(joinGame, 1000);
        };
    </script>
</body>
</html>`;
  
  return new Response(playerPage, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function handleAdminConnection(ws: WebSocket, token: string | null) {
  const adminId = "ADMIN-" + Date.now();
  
  // Verify admin token
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
  console.log(`Admin connected: ${adminId}`);
  
  // Send auth success
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
      
      // Only process admin commands
      if (data.type === "ADMIN_COMMAND") {
        handleAdminCommand(data, adminId);
      }
      
      // Update last active time
      const player = gameState.players.get(adminId);
      if (player) {
        player.lastActive = new Date();
      }
    } catch (error) {
      console.error("Error processing admin message:", error);
    }
  };
  
  ws.onclose = () => {
    console.log(`Admin disconnected: ${adminId}`);
    gameState.players.delete(adminId);
  };
  
  ws.onerror = (error) => {
    console.error(`Admin WebSocket error (${adminId}):`, error);
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
  console.log(`Player connected: ${playerName} (${playerId})`);
  
  // Generate random board numbers (1-75, 5x5 grid)
  const boardNumbers: number[] = [];
  for (let i = 0; i < 25; i++) {
    let num: number;
    do {
      num = generateNumber(1, 75);
    } while (boardNumbers.includes(num));
    boardNumbers.push(num);
  }
  
  // Send welcome message with board
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
  
  // Update all admins about new player
  updateAdminPlayerList();
  
  // Broadcast player count update to all
  broadcastPlayerCount();
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === "BINGO_CLAIM") {
        handleBingoClaim(playerId, data);
      }
      
      // Update last active time
      player.lastActive = new Date();
    } catch (error) {
      console.error("Error processing player message:", error);
    }
  };
  
  ws.onclose = () => {
    console.log(`Player disconnected: ${playerName} (${playerId})`);
    gameState.players.delete(playerId);
    updateAdminPlayerList();
    broadcastPlayerCount();
  };
  
  ws.onerror = (error) => {
    console.error(`Player WebSocket error (${playerId}):`, error);
  };
}

function handleAdminCommand(data: any, adminId: string) {
  const command = data.command;
  console.log(`Admin command received: ${command} from ${adminId}`);
  
  switch (command) {
    case "START_GAME":
      gameState.gameActive = true;
      gameState.gameStartedAt = new Date();
      
      // Broadcast game start to all players
      broadcastToPlayers({
        type: "GAME_STARTED",
        message: "Game has started!",
        gameId: gameState.currentGameId
      });
      
      // Update admins
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
        // All numbers have been called
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
        
        // Restart auto-call if it's running
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
        console.log("Admin password updated");
      }
      break;
  }
  
  // Send updated game state to requesting admin
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
  
  console.log(`BINGO claim from ${player.name} (${playerId})`);
  
  // Verify bingo claim (simplified - in real app, check patterns)
  const claimedNumbers = data.claimedNumbers || [];
  
  // Simple verification: all claimed numbers must be in called numbers
  const isValid = claimedNumbers.every((num: number) => 
    gameState.calledNumbers.includes(num)
  ) && claimedNumbers.length >= 5;
  
  if (isValid) {
    // Broadcast winner to all
    broadcastToPlayers({
      type: "BINGO_WINNER",
      winnerName: player.name,
      winnerId: playerId,
      pattern: "BINGO!",
      timestamp: new Date().toISOString()
    }, playerId); // Exclude the winner from broadcast
    
    // Notify winner directly
    player.ws.send(JSON.stringify({
      type: "BINGO_VERIFIED",
      success: true,
      message: "Congratulations! Your BINGO claim is verified!"
    }));
    
    // Update admins
    broadcastToAdmins({
      type: "BINGO_WINNER",
      winnerName: player.name,
      winnerId: playerId,
      pattern: "BINGO!",
      timestamp: new Date().toISOString()
    });
    
    // Stop the game
    gameState.gameActive = false;
    if (gameState.callTimer) {
      clearInterval(gameState.callTimer);
      gameState.callTimer = null;
    }
  } else {
    // Invalid claim
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

// Cleanup inactive players periodically
setInterval(() => {
  const now = new Date();
  const timeout = 5 * 60 * 1000; // 5 minutes
  
  for (const [playerId, player] of gameState.players) {
    if (now.getTime() - player.lastActive.getTime() > timeout) {
      console.log(`Removing inactive player: ${player.name} (${playerId})`);
      try {
        player.ws.close();
      } catch (error) {
        // Ignore close errors
      }
      gameState.players.delete(playerId);
    }
  }
  
  if (gameState.players.size > 0) {
    updateAdminPlayerList();
    broadcastPlayerCount();
  }
}, 60000); // Check every minute

console.log(`🎮 Assefa Bingo Server starting on port 8000`);
console.log(`🔐 Admin password: ${gameState.adminPassword}`);
console.log(`🎯 Game ID: ${gameState.currentGameId}`);

serve(handleRequest, { port: 8000 });
