import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

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
  callTimer: null
};

// Generate unique game ID
function generateGameId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Generate unique numbers for Bingo (1-75)
function generateUniqueNumbers(count: number, max: number = 75): number[] {
  const numbers = new Set<number>();
  while (numbers.size < count) {
    numbers.add(Math.floor(Math.random() * max) + 1);
  }
  return Array.from(numbers);
}

// Get letter for Bingo number
function getBingoLetter(number: number): string {
  if (number <= 15) return "B";
  if (number <= 30) return "I";
  if (number <= 45) return "N";
  if (number <= 60) return "G";
  if (number <= 75) return "O";
  return "";
}

// Validate Bingo claim
function validateBingoClaim(
  markedNumbers: number[],
  calledNumbers: number[],
  pattern: string
): boolean {
  // Check if all marked numbers are in called numbers
  for (const num of markedNumbers) {
    if (!calledNumbers.includes(num)) {
      return false;
    }
  }
  
  // Additional pattern validation can be added here
  // For now, just validate that numbers are called
  return true;
}

// Broadcast message to all players
function broadcastToAll(message: any, excludePlayerId?: string) {
  const data = JSON.stringify(message);
  gameState.players.forEach((player) => {
    if (player.id !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  });
}

// Broadcast to admins only
function broadcastToAdmins(message: any) {
  const data = JSON.stringify(message);
  gameState.players.forEach((player) => {
    if (player.isAdmin && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  });
}

// Update game state and notify all
function updateGameState() {
  const stateMessage = {
    type: "game_state",
    gameActive: gameState.gameActive,
    calledNumbers: gameState.calledNumbers,
    playersCount: gameState.players.size,
    gameId: gameState.currentGameId,
    gameStartedAt: gameState.gameStartedAt
  };
  
  broadcastToAll(stateMessage);
  
  // Also send to admins with more details
  const adminStateMessage = {
    ...stateMessage,
    type: "admin_game_state",
    players: Array.from(gameState.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      boardId: p.boardId,
      isAdmin: p.isAdmin,
      lastActive: p.lastActive
    })),
    autoCallEnabled: gameState.autoCallEnabled,
    callInterval: gameState.callInterval
  };
  
  broadcastToAdmins(adminStateMessage);
}

// Start auto-calling numbers
function startAutoCall() {
  if (gameState.callTimer) {
    clearInterval(gameState.callTimer);
  }
  
  gameState.callTimer = setInterval(() => {
    if (gameState.gameActive && gameState.autoCallEnabled) {
      callNextNumber();
    }
  }, gameState.callInterval);
}

// Stop auto-calling
function stopAutoCall() {
  if (gameState.callTimer) {
    clearInterval(gameState.callTimer);
    gameState.callTimer = null;
  }
}

// Call next number
function callNextNumber() {
  if (!gameState.gameActive || gameState.calledNumbers.length >= 75) {
    return;
  }
  
  // Generate unique number not called yet
  let newNumber: number;
  do {
    newNumber = Math.floor(Math.random() * 75) + 1;
  } while (gameState.calledNumbers.includes(newNumber));
  
  gameState.calledNumbers.push(newNumber);
  const letter = getBingoLetter(newNumber);
  
  // Broadcast to all players
  const numberMessage = {
    type: "number_called",
    number: newNumber,
    letter: letter,
    calledNumbers: gameState.calledNumbers,
    totalCalled: gameState.calledNumbers.length
  };
  
  broadcastToAll(numberMessage);
  updateGameState();
  
  console.log(`Number called: ${letter}${newNumber}`);
}

// Handle WebSocket connections
async function handleWebSocket(req: Request): Promise<Response> {
  const { socket, response } = Deno.upgradeWebSocket(req);
  
  const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let player: Player | null = null;
  
  socket.onopen = () => {
    console.log(`WebSocket connected: ${playerId}`);
  };
  
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(playerId, socket, data);
    } catch (error) {
      console.error("Error parsing message:", error);
      socket.send(JSON.stringify({
        type: "error",
        message: "Invalid message format"
      }));
    }
  };
  
  socket.onclose = () => {
    console.log(`WebSocket closed: ${playerId}`);
    if (player) {
      gameState.players.delete(playerId);
      
      // Notify others
      broadcastToAll({
        type: "player_left",
        playerId: playerId,
        playerName: player.name,
        playersCount: gameState.players.size
      });
      
      updateGameState();
    }
  };
  
  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
  
  function handleMessage(playerId: string, ws: WebSocket, data: any) {
    switch (data.type) {
      case "player_join":
        handlePlayerJoin(playerId, ws, data);
        break;
      
      case "admin_join":
        handleAdminJoin(playerId, ws, data);
        break;
      
      case "start_game":
        handleStartGame(playerId);
        break;
      
      case "stop_game":
        handleStopGame(playerId);
        break;
      
      case "reset_game":
        handleResetGame(playerId);
        break;
      
      case "call_number":
        handleCallNumber(playerId);
        break;
      
      case "bingo_claim":
        handleBingoClaim(playerId, data);
        break;
      
      case "validate_bingo":
        handleValidateBingo(playerId, data);
        break;
      
      case "ping":
        handlePing(playerId);
        break;
      
      default:
        ws.send(JSON.stringify({
          type: "error",
          message: "Unknown message type"
        }));
    }
  }
  
  function handlePlayerJoin(playerId: string, ws: WebSocket, data: any) {
    player = {
      id: playerId,
      name: data.playerName || "Player",
      boardId: data.boardId || Math.floor(Math.random() * 100) + 1,
      ws: ws,
      joinedAt: new Date(),
      isAdmin: false,
      lastActive: new Date()
    };
    
    gameState.players.set(playerId, player);
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: "welcome",
      playerId: playerId,
      gameState: {
        gameActive: gameState.gameActive,
        calledNumbers: gameState.calledNumbers,
        playersCount: gameState.players.size,
        gameId: gameState.currentGameId
      }
    }));
    
    // Notify others
    broadcastToAll({
      type: "player_joined",
      playerId: playerId,
      playerName: player.name,
      playersCount: gameState.players.size
    }, playerId);
    
    updateGameState();
    
    console.log(`Player joined: ${player.name} (${playerId})`);
  }
  
  function handleAdminJoin(playerId: string, ws: WebSocket, data: any) {
    // Verify admin password
    if (data.password !== gameState.adminPassword) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Invalid admin password"
      }));
      return;
    }
    
    player = {
      id: playerId,
      name: "Admin",
      boardId: 0,
      ws: ws,
      joinedAt: new Date(),
      isAdmin: true,
      lastActive: new Date()
    };
    
    gameState.players.set(playerId, player);
    
    // Send admin welcome
    ws.send(JSON.stringify({
      type: "admin_welcome",
      playerId: playerId,
      gameState: {
        gameActive: gameState.gameActive,
        calledNumbers: gameState.calledNumbers,
        playersCount: gameState.players.size,
        gameId: gameState.currentGameId,
        players: Array.from(gameState.players.values()).map(p => ({
          id: p.id,
          name: p.name,
          boardId: p.boardId,
          isAdmin: p.isAdmin
        }))
      }
    }));
    
    console.log(`Admin joined: ${playerId}`);
  }
  
  function handleStartGame(playerId: string) {
    const player = gameState.players.get(playerId);
    if (!player || !player.isAdmin) {
      return;
    }
    
    gameState.gameActive = true;
    gameState.gameStartedAt = new Date();
    gameState.calledNumbers = [];
    
    // Start auto-call if enabled
    if (gameState.autoCallEnabled) {
      startAutoCall();
    }
    
    broadcastToAll({
      type: "game_started",
      startedAt: gameState.gameStartedAt
    });
    
    updateGameState();
    
    console.log("Game started by admin");
  }
  
  function handleStopGame(playerId: string) {
    const player = gameState.players.get(playerId);
    if (!player || !player.isAdmin) {
      return;
    }
    
    gameState.gameActive = false;
    stopAutoCall();
    
    broadcastToAll({
      type: "game_stopped"
    });
    
    updateGameState();
    
    console.log("Game stopped by admin");
  }
  
  function handleResetGame(playerId: string) {
    const player = gameState.players.get(playerId);
    if (!player || !player.isAdmin) {
      return;
    }
    
    gameState.gameActive = false;
    gameState.calledNumbers = [];
    gameState.gameStartedAt = null;
    gameState.currentGameId = generateGameId();
    stopAutoCall();
    
    broadcastToAll({
      type: "game_reset",
      gameId: gameState.currentGameId
    });
    
    updateGameState();
    
    console.log("Game reset by admin");
  }
  
  function handleCallNumber(playerId: string) {
    const player = gameState.players.get(playerId);
    if (!player || !player.isAdmin) {
      return;
    }
    
    callNextNumber();
  }
  
  function handleBingoClaim(playerId: string, data: any) {
    const player = gameState.players.get(playerId);
    if (!player || !gameState.gameActive) {
      return;
    }
    
    // Validate the claim
    const isValid = validateBingoClaim(
      data.markedNumbers || [],
      gameState.calledNumbers,
      data.patterns?.[0] || ""
    );
    
    // Notify the player
    player.ws.send(JSON.stringify({
      type: "bingo_validated",
      valid: isValid,
      patterns: data.patterns
    }));
    
    if (isValid) {
      // Notify admins for final validation
      broadcastToAdmins({
        type: "bingo_claim",
        playerId: playerId,
        playerName: player.name,
        patterns: data.patterns,
        markedNumbers: data.markedNumbers,
        calledNumbers: gameState.calledNumbers
      });
      
      console.log(`Bingo claim from ${player.name}: ${data.patterns?.join(", ")}`);
    }
  }
  
  function handleValidateBingo(playerId: string, data: any) {
    const admin = gameState.players.get(playerId);
    if (!admin || !admin.isAdmin) {
      return;
    }
    
    const player = gameState.players.get(data.playerId);
    if (!player) {
      return;
    }
    
    if (data.valid) {
      // Declare winner
      broadcastToAll({
        type: "winner_declared",
        winnerId: player.id,
        winnerName: player.name,
        pattern: data.patterns?.[0] || "Bingo",
        prize: calculatePrizeAmount()
      });
      
      // Stop the game
      gameState.gameActive = false;
      stopAutoCall();
      updateGameState();
      
      console.log(`Winner declared: ${player.name}`);
    } else {
      // Reject claim
      player.ws.send(JSON.stringify({
        type: "bingo_rejected",
        message: "Bingo claim was rejected by admin"
      }));
    }
  }
  
  function handlePing(playerId: string) {
    const player = gameState.players.get(playerId);
    if (player) {
      player.lastActive = new Date();
      player.ws.send(JSON.stringify({
        type: "pong",
        timestamp: Date.now()
      }));
    }
  }
  
  function calculatePrizeAmount(): number {
    // Simple prize calculation based on players and numbers called
    const basePrize = 1000;
    const playerMultiplier = Math.max(1, gameState.players.size / 10);
    const numbersMultiplier = gameState.calledNumbers.length / 75;
    
    return Math.floor(basePrize * playerMultiplier * numbersMultiplier);
  }
  
  return response;
}

// Serve static files for frontend
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  // WebSocket endpoint
  if (url.pathname === "/ws") {
    return handleWebSocket(req);
  }
  
  // Serve frontend files
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  
  // Remove leading slash
  if (filePath.startsWith("/")) {
    filePath = filePath.substring(1);
  }
  
  // Default to index.html
  if (!filePath || filePath === "") {
    filePath = "index.html";
  }
  
  try {
    // For Deno Deploy, we'll serve from the current directory
    // In production, you might want to serve from a different location
    const file = await Deno.readTextFile(`./frontend/${filePath}`);
    
    // Determine content type
    let contentType = "text/html";
    if (filePath.endsWith(".css")) contentType = "text/css";
    if (filePath.endsWith(".js")) contentType = "application/javascript";
    if (filePath.endsWith(".png")) contentType = "image/png";
    if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) contentType = "image/jpeg";
    
    return new Response(file, {
      headers: { "Content-Type": contentType },
    });
  } catch (error) {
    console.error(`File not found: ${filePath}`, error);
    return new Response("File not found", { status: 404 });
  }
}

// Clean up inactive players periodically
setInterval(() => {
  const now = new Date();
  const inactiveThreshold = 5 * 60 * 1000; // 5 minutes
  
  gameState.players.forEach((player, playerId) => {
    if (now.getTime() - player.lastActive.getTime() > inactiveThreshold) {
      console.log(`Removing inactive player: ${player.name}`);
      player.ws.close();
      gameState.players.delete(playerId);
    }
  });
  
  if (gameState.players.size > 0) {
    updateGameState();
  }
}, 60 * 1000); // Check every minute

// Start the server
console.log("Server starting on http://localhost:8000");
serve(handleRequest, { port: 8000 });