# Race Condition Analysis - Reconnection Logic

## Executive Summary

**Critical Race Condition Found:** Game state can change between `applyReconnectionState()` reading game state and the client receiving messages. This is a **severe** issue that could result in:
- Client receiving stale board state
- Client not aware of ships that have been sunk
- Turn information being incorrect
- Opponent not being notified of shots during reconnection window

---

## Issue 1: TOCTOU (Time-of-Check-Time-of-Use) on Game State

### Location
`handler.ts` lines 230-297 (`applyReconnectionState`)

### Problem
```typescript
// Line 234: Read game state
const game = getGameByUsername(username);

// Lines 243-249: 10+ lines of code execute here
// In this window, opponent could:
// - Fire a shot and hit/sink the user's ship
// - Forfeit the game
// - Opponent's game could be marked as finished

// Line 258: Use game.currentTurn (potentially stale now)
const yourTurn = game.currentTurn === idx;

// Lines 266-296: Send messages based on potentially stale game.status
if (game.status === "playing") {
  // What if status changed to "finished" here?
  const playingShots = getShotHistoryWithResults(game, idx);
  const ships = player.board ? serializeBoardForReconnect(player.board) : [];
  // Send stale data to client
}
```

### Race Condition Scenario

**Timeline:**
```
T0:  Player A disconnects
     - handleDisconnect() called
     - setDisconnectTimer() sets 60-second timeout
     - opponent (Player B) is notified

T1:  Player A reconnects immediately (< 60 seconds)
     - WebSocket open handler calls applyReconnectionState()
     - Line 234: game = getGameByUsername("PlayerA") // gets game reference

T2:  [RACE WINDOW]
     - applyReconnectionState() continues executing
     - Meanwhile, Player B sends a shot to the same game

T3:  Player B's shot arrives on different thread/event loop iteration
     - handleShoot() called for Player B
     - Line 529: processShot() executes
     - Line 66 (shooting.ts): shooterPlayer.shots.add(coordinate)
     - Line 78 (shooting.ts): ship.hits.add(coordinate) // HIT!
     - Line 94 (shooting.ts): switchTurn(game) // Turn switched
     - Line 97 (shooting.ts): persistGames()

T4:  Back to applyReconnectionState() in Player A's reconnection thread
     - Line 258: const yourTurn = game.currentTurn === idx
     - BUT: game.currentTurn was just switched by Player B's shot!
     - yourTurn will be INCORRECT
     
T5:  Lines 273-280 execute
     - const playingShots = getShotHistoryWithResults(game, idx)
     - This WILL include Player B's recent shot (consistent)
     - BUT: The game.currentTurn used on line 258 is already outdated
     
T6:  Messages sent to reconnecting player:
     - game_start message with WRONG yourTurn value
     - reconnect_game_state with CORRECT shots (including the one that just fired)
     - CLIENT RECEIVES CONTRADICTORY STATE
```

### Concrete Example

**Setup:**
- Player A and B are in a game, playing phase
- Player A's turn is TRUE
- Player A disconnects at T0
- Player B is waiting for Player A to shoot

**Execution:**
```
T0: Player A disconnects
    - game.currentTurn = 0 (Player A's turn)
    - Disconnect timer set for 60 seconds

T1: Player A reconnects
    - applyReconnectionState() starts
    - Line 258: yourTurn = (game.currentTurn === 0) = true // Correct!
    - Currently preparing to send game_start with yourTurn=true

T1.5: [Meanwhile] Player B gets impatient, fires a shot at "A1"
    - handleShoot() processes
    - Shot recorded as hit
    - Line 94: switchTurn() executes: game.currentTurn = 1 // Now it's B's turn!
    - game persisted

T2: Back in applyReconnectionState() for Player A
    - Has already calculated yourTurn = true (from T1, before turn switched!)
    - Sends game_start with yourTurn=true
    - Sends reconnect_game_state with shots including ["A1" with hit=true, sunk=null]
    
T3: Player A receives:
    - game_start: { yourTurn: true }
    - reconnect_game_state: { shots: [{ coordinate: "A1", hit: true, sunk: null }] }
    
RESULT: 
- Player A thinks it's their turn
- But actually it's Player B's turn now!
- Player A will try to shoot
- Server will reject with "It's not your turn"
- User experience: confusing error
```

---

## Issue 2: Game Status Change During Reconnection

### Location
`handler.ts` lines 234-296 (`applyReconnectionState`)

### Problem
```typescript
const game = getGameByUsername(username);
if (!game || game.status === "finished") {
  // This check happens ONCE at line 235
  // But game.status could change between here and line 266-296
  return;
}

// ... many lines of code ...

if (game.status === "playing") {
  // What if the game ended due to opponent's shot sinking the last ship?
  // game.status could have changed to "finished" by now!
  // We'll send game_start anyway
  send(ws, {
    type: "game_start",
    yourTurn,
    opponent: opponentUsername || "Unknown",
    gameId: game.id,
  });
  // Send reconnect_game_state with wrong context
}
```

### Race Condition Scenario

**Timeline:**
```
T0: Player A disconnects
    - 5 ships on opponent's board (Player B's)
    - 4 of Player B's ships already sunk
    - 1 ship remains (destroyer, 2 tiles)

T1: Player A reconnects
    - applyReconnectionState() starts
    - Line 235: game.status = "playing" ✓
    - Line 266: game.status === "playing" → true
    - Enters playing phase block
    - Calculates yourTurn, shots, ships
    - Preparing to send game_start

T1.5: [Meanwhile] Player B shoots opponent's last ship (Player A's destroyer)
    - handleShoot() for Player B
    - Both tiles of destroyer hit
    - Line 85 (shooting.ts): areAllShipsSunk() returns true
    - Line 86: gameOver = true
    - Line 575 (handler.ts): endGame(game, "PlayerB", "victory")
    - Line 163 (game.ts): game.status = "finished"
    - Player A's ships are now all sunk
    - Game over!

T2: Back in applyReconnectionState() for Player A
    - Still in line 266-280 block
    - game.status hasn't been re-checked
    - Proceeds to send:
      - game_start message
      - reconnect_game_state message

T3: Player A receives:
    - game_start message (game already finished!)
    - reconnect_game_state with destroyed ships
    
RESULT:
- Player A was never told the game ended
- Player A will see game_start message
- Confused about game state
- May not transition to game over screen properly
```

---

## Issue 3: Opponent Reconnection Notification Race

### Location
`handler.ts` lines 243-249

### Problem
```typescript
if (game.disconnectedPlayer === username) {
  clearDisconnectTimer(game);
  const opponentUsername = getOpponentUsername(game, username);
  if (opponentUsername) {
    sendToUser(opponentUsername, { type: "opponent_reconnected" });
  }
}

// What if opponent is also reconnecting at the same time?
// What if opponent's WebSocket just closed?
// sendToUser() might fail silently
```

### Race Condition Scenario

**Timeline:**
```
T0: Both players disconnect simultaneously
    - Player A's handleDisconnect() runs
    - Player B's handleDisconnect() runs
    - Both disconnect timers set
    - Both marked as disconnected

T1: Player A reconnects
    - applyReconnectionState() for Player A
    - Line 247: sendToUser("PlayerB", opponent_reconnected)
    - Player B's session.ws is null (still disconnected)
    - sendToUser() fails silently

T2: Player B reconnects 10 seconds later
    - applyReconnectionState() for Player B
    - Line 247: sendToUser("PlayerA", opponent_reconnected)
    - This succeeds (Player A is connected)
    - But Player A never got the first opponent_reconnected message

RESULT:
- Player A doesn't know Player B reconnected
- Player B gets opponent_reconnected notification
- Asymmetric state
```

---

## Issue 4: Stale Data in reconnect_game_state

### Location
`reconnect.ts` lines 20-45 (`getShotHistoryWithResults`)

### Problem
```typescript
export function getShotHistoryWithResults(
  game: Game,
  playerIndex: number
): SerializedShot[] {
  // ...
  const opponentBoard = game.players[opponentIndex].board;
  if (!opponentBoard) return [];

  const shots: SerializedShot[] = [];
  for (const coordinate of player.shots) {
    // Line 34: Read opponent's board state
    const hit = opponentBoard.allShipTiles.has(coordinate);
    let sunk: ShipType | null = null;
    if (hit) {
      const ship = getShipAtCoordinate(opponentBoard, coordinate);
      if (ship && isShipSunk(ship)) {
        sunk = ship.type;
      }
    }
    shots.push({ coordinate, hit, sunk });
  }
  return shots;
}
```

### Issue
The shots array is derived from current board state, but:
1. During applyReconnectionState(), the shot history is being computed
2. WHILE this computation happens, opponent could be firing new shots
3. The derived shot results could be inconsistent with player.shots Set

### Example
```
T0: Player A reconnects
    - applyReconnectionState() called
    - Line 273: const playingShots = getShotHistoryWithResults(game, idx)
    - Iterating through player.shots: ["B5", "C6", "D7"]

T0.5: [During iteration] Player B fires a new shot (not at A)
    - handleShoot() runs
    - But doesn't affect Player A's shots iteration

T1: getShotHistoryWithResults() completes
    - Returns shot history
    - All data derived from current board state at T0.5
```

**This is less critical than Issue 1-3** because shots are derived from the current board state which is consistent, but the timing could still cause issues if board state changes mid-iteration.

---

## Issue 5: Missing Game State Validation on Reconnect

### Location
`handler.ts` lines 251-260

### Problem
```typescript
const playerIndex = getPlayerIndex(game, username);
if (playerIndex < 0) {
  // Error handling
  return;
}
const idx = playerIndex as 0 | 1;
const yourTurn = game.currentTurn === idx;
const opponentUsername = getOpponentUsername(game, username);
const player = game.players[idx];

// No validation that:
// - opponent is still in the game
// - opponent hasn't been removed
// - game hasn't been modified
```

If the game is removed from memory while `applyReconnectionState()` is executing, the `game` reference could become invalid, but accessing it directly is still safe (JavaScript reference is stable). However, consistency is not guaranteed.

---

## Severity Assessment

| Issue | Severity | Impact | Likelihood |
|-------|----------|--------|------------|
| Issue 1: TOCTOU on yourTurn | **CRITICAL** | Wrong turn state sent to client | **HIGH** (will occur if opponent shoots during reconnection window) |
| Issue 2: Game status change | **CRITICAL** | Game ending not communicated | **MEDIUM** (depends on shot timing) |
| Issue 3: Opponent reconnection race | **MEDIUM** | Notification missed | **LOW-MEDIUM** |
| Issue 4: Shot history derivation | **LOW** | Potential inconsistency | **LOW** |
| Issue 5: Missing validation | **LOW** | Edge case handling | **VERY LOW** |

---

## Recommended Fixes

### Fix 1: Atomic Game State Read

Use a snapshot/immutable approach:
```typescript
export function applyReconnectionState(
  ws: ServerWebSocket<WebSocketData>,
  username: string
): void {
  const game = getGameByUsername(username);
  if (!game || game.status === "finished") {
    setUserStatus(username, "lobby");
    return;
  }

  // Create an IMMUTABLE snapshot of game state at this moment
  const playerIndex = getPlayerIndex(game, username);
  if (playerIndex < 0) {
    setUserStatus(username, "lobby");
    return;
  }
  const idx = playerIndex as 0 | 1;
  
  // SNAPSHOT - these become immutable values for this reconnection
  const snapshot = {
    gameId: game.id,
    status: game.status,
    currentTurn: game.currentTurn,
    yourTurn: game.currentTurn === idx,
    opponentUsername: getOpponentUsername(game, username),
    shipCount: game.players[idx].board?.ships.length ?? 0,
  };

  // Now use snapshot for all subsequent operations
  setUserStatus(username, "in_game");

  if (game.disconnectedPlayer === username) {
    clearDisconnectTimer(game);
    if (snapshot.opponentUsername) {
      sendToUser(snapshot.opponentUsername, { type: "opponent_reconnected" });
    }
  }

  // Check game status using snapshot (immutable)
  if (snapshot.status === "playing") {
    send(ws, {
      type: "game_start",
      yourTurn: snapshot.yourTurn,  // Use snapshot
      opponent: snapshot.opponentUsername || "Unknown",
      gameId: snapshot.gameId,
    });
    
    const playingShots = getShotHistoryWithResults(game, idx);
    const ships = game.players[idx].board 
      ? serializeBoardForReconnect(game.players[idx].board!) 
      : [];
    
    send(ws, {
      type: "reconnect_game_state",
      gameId: snapshot.gameId,
      ships,
      shots: playingShots,
    });
  } else if (snapshot.status === "setup") {
    if (game.players[idx].ready) {
      send(ws, { type: "waiting_for_opponent" });
    }
    const ships = game.players[idx].board 
      ? serializeBoardForReconnect(game.players[idx].board!) 
      : [];
    send(ws, {
      type: "reconnect_game_state",
      gameId: snapshot.gameId,
      ships,
      shots: [],
    });
  } else {
    setUserStatus(username, "lobby");
  }
}
```

**Why this helps:**
- Captures game state at one moment in time
- All subsequent decisions based on consistent snapshot
- Even if game state changes, reconnecting player gets coherent view
- Player might not get latest updates, but won't see contradictory state

### Fix 2: Double-Check After Message Send (Optional but Safer)

```typescript
export function applyReconnectionState(
  ws: ServerWebSocket<WebSocketData>,
  username: string
): void {
  const game = getGameByUsername(username);
  if (!game || game.status === "finished") {
    setUserStatus(username, "lobby");
    return;
  }

  const playerIndex = getPlayerIndex(game, username);
  const idx = playerIndex as 0 | 1;
  
  // Send initial messages
  if (game.status === "playing") {
    const snapshot = {
      gameId: game.id,
      yourTurn: game.currentTurn === idx,
      opponent: getOpponentUsername(game, username),
    };
    
    send(ws, {
      type: "game_start",
      yourTurn: snapshot.yourTurn,
      opponent: snapshot.opponent || "Unknown",
      gameId: snapshot.gameId,
    });
    
    // ... send reconnect_game_state ...
    
    // SAFETY CHECK: Verify game state didn't change drastically
    const gameAfter = getGameByUsername(username);
    if (!gameAfter || gameAfter.status !== "playing") {
      // Send game_over or error message
      send(ws, {
        type: "error",
        code: "GAME_STATE_CHANGED",
        message: "Game state changed during reconnection, please refresh",
      });
    }
  }
}
```

### Fix 3: Use Message Queuing for Critical Operations

Serialize reconnection operations to prevent concurrent modifications:
```typescript
// This would require architectural changes
// Add a lock/queue per game to ensure serialized access
const gameOperationQueue = new Map<string, Promise<void>>();

export async function applyReconnectionStateAtomic(
  ws: ServerWebSocket<WebSocketData>,
  username: string
): Promise<void> {
  const game = getGameByUsername(username);
  if (!game) return;

  // Ensure this game's operations are serialized
  const currentQueue = gameOperationQueue.get(game.id) ?? Promise.resolve();
  
  const operation = currentQueue.then(() => {
    // Safe to execute now - no concurrent operations
    return new Promise<void>((resolve) => {
      applyReconnectionStateLogic(ws, username);
      resolve();
    });
  });

  gameOperationQueue.set(game.id, operation);
}
```

---

## Testing Recommendations

### Test 1: Opponent Shoots During Reconnection
```
1. Two players in game, Player A's turn
2. Player A disconnects
3. Immediately reconnect Player A
4. Before reconnection completes, Player B shoots
5. Verify Player A receives correct turn state
```

### Test 2: Game Ends During Reconnection
```
1. Two players in game
2. Player A has one ship with 1 tile remaining
3. Player A disconnects
4. Player B shoots the final tile
5. Immediately Player A tries to reconnect
6. Verify Player A gets game_over message, not game_start
```

### Test 3: Both Players Reconnect Simultaneously
```
1. Two players disconnect
2. Both reconnect at exact same time
3. Verify both receive opponent_reconnected notifications
4. Verify both get consistent game state
```

### Test 4: Shot Fired Then Reconnect
```
1. Player A shoots
2. Before opponent responds, Player A's connection drops
3. Player A reconnects
4. Verify reconnected state includes the shot they just fired
```

---

## Summary

The reconnection logic has **critical race conditions** due to:
1. Reading game state once, then using it multiple times over many lines of code
2. No atomic operations for state capture and messaging
3. No validation that game state didn't change during the reconnection process

**Recommendation:** Implement Fix 1 (atomic snapshot approach) immediately. This is the minimal change with maximum safety improvement.
