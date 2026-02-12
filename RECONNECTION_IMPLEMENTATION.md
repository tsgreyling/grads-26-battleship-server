# Battleship Game - Reconnection Implementation Guide

## Overview
When a user disconnects and reconnects mid-game, the server restores their complete game state including ships, shots, and turn information. This document details the exact message flow and payload structures.

---

## Reconnection Flow

### Step 1: User Reconnects with Session Token

**Frontend Action:**
When the user returns (page reload, browser restart, etc.), the frontend should:
1. Check for stored `sessionToken` in localStorage
2. Establish WebSocket connection with token in URL query parameter

**WebSocket Connection URL:**
```
ws://server:port/?token=<sessionToken>
```

**Example:**
```
ws://localhost:8080/?token=550e8400-e29b-41d4-a716-446655440000
```

---

### Step 2: Server WebSocket Open Handler

When the WebSocket connects with a valid token, the server automatically sends:

#### Message 1: `auth_success`
```json
{
  "type": "auth_success",
  "sessionToken": "550e8400-e29b-41d4-a716-446655440000",
  "user": {
    "username": "player1",
    "stats": {
      "gamesPlayed": 5,
      "wins": 3,
      "losses": 2
    }
  }
}
```

**When:** Immediately after successful session validation
**Frontend Handling:** Store session token, update user info display

---

### Step 3: Apply Reconnection State

After `auth_success`, the server calls `applyReconnectionState()` which:
1. Checks if user has an active game
2. Clears any disconnect timeout
3. Notifies opponent of reconnection
4. Sends game state messages

#### Message 2: `game_start` (if in playing phase)
```json
{
  "type": "game_start",
  "yourTurn": true,
  "opponent": "player2",
  "gameId": "game-uuid-12345"
}
```

**When:** Sent if game status is "playing"
**Frontend Handling:** 
- Display game board
- Highlight if it's the player's turn
- Store game ID

#### Message 2b: `waiting_for_opponent` (if in setup phase)
```json
{
  "type": "waiting_for_opponent"
}
```

**When:** Sent if game status is "setup" and player has placed ships
**Frontend Handling:** Display "Waiting for opponent to place ships"

---

### Step 4: Reconnect Game State

#### Message 3: `reconnect_game_state` (CRITICAL)
```json
{
  "type": "reconnect_game_state",
  "gameId": "game-uuid-12345",
  "ships": [
    {
      "type": "carrier",
      "tiles": ["A1", "A2", "A3", "A4", "A5"],
      "hits": ["A1", "A3"]
    },
    {
      "type": "battleship",
      "tiles": ["C5", "C6", "C7", "C8"],
      "hits": ["C5"]
    },
    {
      "type": "cruiser",
      "tiles": ["E2", "F2", "G2"],
      "hits": []
    },
    {
      "type": "submarine",
      "tiles": ["H8", "H9", "H10"],
      "hits": ["H9"]
    },
    {
      "type": "destroyer",
      "tiles": ["J3", "J4"],
      "hits": []
    }
  ],
  "shots": [
    {
      "coordinate": "B5",
      "hit": false,
      "sunk": null
    },
    {
      "coordinate": "D4",
      "hit": true,
      "sunk": null
    },
    {
      "coordinate": "F8",
      "hit": true,
      "sunk": "submarine"
    },
    {
      "coordinate": "K11",
      "hit": false,
      "sunk": null
    },
    {
      "coordinate": "L12",
      "hit": true,
      "sunk": null
    }
  ]
}
```

**When:** After `game_start` (or `waiting_for_opponent` if in setup)
**Key Points:**
- `ships`: Array of the player's placed ships with ALL tiles occupied by that ship
- `hits`: Coordinates within the ship that have been hit by opponent
- `shots`: All shots the player has fired at opponent's board
- Each shot has result: `hit` (boolean), `sunk` (null or the ship type that was sunk)

**Frontend Handling (Critical Steps):**

1. **Render Own Board:**
   - Place each ship at exact coordinates in `tiles`
   - Mark tiles in `hits` with visual hit indicator (explosion, different color)
   - Display ships as placed and partially/fully sunk based on hits

2. **Render Opponent Board:**
   - For each shot in `shots`:
     - If `hit: false` → Show miss marker (e.g., water splash)
     - If `hit: true` and `sunk: null` → Show hit marker (e.g., fire/damaged)
     - If `sunk: "shiptype"` → Show sunk indicator and possibly highlight all tiles of that ship
   - Create a grid showing all fired shots with their results

3. **Game State Restoration:**
   - Coordinate system: Columns A-L (0-11), Rows 1-12 (0-11)
   - Format: String coordinates like "A1", "B7", "L12"
   - Verify shot count and last turn from `game_start.yourTurn`

---

## Complete Reconnection Sequence Diagram

```
Client                              Server
  |                                   |
  |------ WebSocket Connect --------->|
  |        (with token in URL)         |
  |                                   |
  |<----- auth_success Message -------|
  |  (session restored, user data)    |
  |                                   |
  |<----- game_start Message ---------|
  |  (yourTurn, opponent, gameId)     |
  |                                   |
  |<----- reconnect_game_state -------|
  |  (ships[] + shots[])              |
  |                                   |
  |------ Client Renders Board -------|
  |  (restore full game UI)           |
  |                                   |
```

---

## Board Reconstruction Examples

### Example 1: Player with 3 Ships Placed, 2 Shots Fired

**Incoming Message:**
```json
{
  "type": "reconnect_game_state",
  "gameId": "abc123",
  "ships": [
    {
      "type": "carrier",
      "tiles": ["A1", "B1", "C1", "D1", "E1"],
      "hits": ["B1", "D1"]
    },
    {
      "type": "battleship",
      "tiles": ["A5", "A6", "A7", "A8"],
      "hits": []
    },
    {
      "type": "cruiser",
      "tiles": ["F1", "G1", "H1"],
      "hits": ["F1"]
    }
  ],
  "shots": [
    {
      "coordinate": "F5",
      "hit": true,
      "sunk": null
    },
    {
      "coordinate": "G7",
      "hit": false,
      "sunk": null
    }
  ]
}
```

**Frontend Rendering:**
- **Own Board (left side):**
  - Carrier: A1(unhit), B1(HIT), C1(unhit), D1(HIT), E1(unhit)
  - Battleship: A5, A6, A7, A8 (all unhit)
  - Cruiser: F1(HIT), G1, H1 (partially hit)
  
- **Enemy Board (right side):**
  - F5: Hit marker (red/fire)
  - G7: Miss marker (blue/water)

---

### Example 2: Player Mid-Game with Multiple Shots and Sunk Ship

**Incoming Message:**
```json
{
  "type": "reconnect_game_state",
  "gameId": "xyz789",
  "ships": [
    {
      "type": "carrier",
      "tiles": ["A1", "A2", "A3", "A4", "A5"],
      "hits": ["A1", "A2", "A3", "A4", "A5"]  // FULLY SUNK
    },
    {
      "type": "battleship",
      "tiles": ["C3", "C4", "C5", "C6"],
      "hits": []
    },
    {
      "type": "cruiser",
      "tiles": ["F2", "G2", "H2"],
      "hits": ["F2", "G2"]  // PARTIALLY SUNK
    },
    {
      "type": "submarine",
      "tiles": ["J5", "J6", "J7"],
      "hits": ["J5"]
    },
    {
      "type": "destroyer",
      "tiles": ["L8", "L9"],
      "hits": []
    }
  ],
  "shots": [
    {"coordinate": "B2", "hit": false, "sunk": null},
    {"coordinate": "B3", "hit": true, "sunk": null},
    {"coordinate": "C3", "hit": true, "sunk": null},
    {"coordinate": "D5", "hit": true, "sunk": "battleship"},
    {"coordinate": "D6", "hit": true, "sunk": "battleship"},
    {"coordinate": "D7", "hit": true, "sunk": "battleship"},
    {"coordinate": "D8", "hit": true, "sunk": "battleship"},  // Fully destroyed
    {"coordinate": "F1", "hit": false, "sunk": null},
    {"coordinate": "K4", "hit": true, "sunk": null},
    {"coordinate": "L10", "hit": false, "sunk": null}
  ]
}
```

**Frontend Analysis:**
- Own carrier: 5/5 hits → SUNK (show sunk animation)
- Own cruiser: 2/3 hits → DAMAGED (show damage state)
- Own submarine: 1/3 hits → DAMAGED
- Own battleship: 0/4 hits → INTACT
- Own destroyer: 0/2 hits → INTACT

- Opponent's board shows:
  - 6 hits total (B3, C3, D5, D6, D7, D8, K4)
  - 1 sunk ship (battleship - 4 hits in a row D5-D8)
  - 3 misses

---

## Coordinate System Reference

**Columns:** A-L (left to right)
```
A B C D E F G H I J K L
0 1 2 3 4 5 6 7 8 9 10 11 (internal index)
```

**Rows:** 1-12 (top to bottom)
```
1  → index 0
2  → index 1
...
12 → index 11
```

**Coordinate Format:** String like "A1", "L12", "F7"
- Always uppercase letter
- Always 1-2 digit number

---

## Edge Cases

### Case 1: Setup Phase - No Shots Yet
```json
{
  "type": "reconnect_game_state",
  "gameId": "game123",
  "ships": [
    {
      "type": "carrier",
      "tiles": ["A1", "A2", "A3", "A4", "A5"],
      "hits": []
    }
    // ... other ships
  ],
  "shots": []  // Empty during setup
}
```

### Case 2: All Ships Sunk (Game Nearly Over)
```json
{
  "shots": [
    {"coordinate": "A1", "hit": true, "sunk": "carrier"},
    {"coordinate": "B2", "hit": true, "sunk": "battleship"},
    {"coordinate": "C3", "hit": true, "sunk": "cruiser"},
    {"coordinate": "D4", "hit": true, "sunk": "submarine"},
    {"coordinate": "E5", "hit": true, "sunk": "destroyer"}
  ]
}
```
- All opponent's ships are sunk
- Next shot would end the game
- Highlight this state prominently

### Case 3: No Ships Placed Yet (Setup Just Started)
```json
{
  "type": "reconnect_game_state",
  "gameId": "game456",
  "ships": [],  // No ships placed yet
  "shots": []
}
```
- Client should show empty board
- Enable ship placement UI

---

## Implementation Checklist

- [ ] Store sessionToken in localStorage on auth_success
- [ ] Include sessionToken in WebSocket URL when reconnecting
- [ ] Parse `reconnect_game_state` message
- [ ] Create data structures for ships (type, tiles, hits) and shots
- [ ] Render own board with ship placements and hit indicators
- [ ] Render opponent board with shot history and results
- [ ] Handle setup phase (empty shots array)
- [ ] Handle playing phase (with yourTurn from game_start)
- [ ] Detect sunk ships (all tiles in hits array match all tiles in tiles array)
- [ ] Display game state correctly: whose turn, what ships are sunk
- [ ] Handle opponent reconnection notification
- [ ] Test reconnection with various game states (setup, mid-game, nearly won)

---

## Message Ordering Guarantee

The server guarantees this order:
1. `auth_success` (always first)
2. `game_start` OR `waiting_for_opponent` (if active game exists)
3. `reconnect_game_state` (after game state message)

**DO NOT** rely on receiving these in a different order. Frontend should wait for all three before rendering final game state.
