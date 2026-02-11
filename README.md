# Battleship Server

A secure WebSocket server for 2-player battleship built with Bun.

## Features

- **Secure WebSocket (WSS)** with TLS/SSL support
- **User authentication** with username/password (Argon2id hashing)
- **Session management** with automatic kick on duplicate login
- **12x12 game board** with standard battleship rules
- **Turn-based gameplay** with server-side validation
- **Matchmaking lobby** with invite system
- **Rate limiting** per-user to prevent abuse
- **Disconnection handling** with 60-second timeout for reconnection

## Requirements

- [Bun](https://bun.sh/) v1.0 or higher

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Generate TLS certificates (for development)

```bash
# Using the npm script
bun run gen-certs

# Or manually
openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"
```

### 3. Start the server

```bash
# With TLS (default)
bun run start

# Without TLS (development)
USE_TLS=false bun run start

# With hot reload
bun run dev
```

The server will start on `wss://0.0.0.0:3000` (or `ws://` if TLS is disabled).

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOSTNAME` | `0.0.0.0` | Server hostname |
| `USE_TLS` | `true` | Enable TLS (set to `false` to disable) |
| `TLS_KEY_PATH` | `./certs/key.pem` | Path to TLS private key |
| `TLS_CERT_PATH` | `./certs/cert.pem` | Path to TLS certificate |

## Game Rules

### Board
- 12x12 grid
- Columns: A-L (letters)
- Rows: 1-12 (numbers)
- Coordinate format: `"A5"`, `"L12"`, etc.

### Ships
Each player has 5 ships:

| Ship | Length |
|------|--------|
| Carrier | 5 tiles |
| Battleship | 4 tiles |
| Cruiser | 3 tiles |
| Submarine | 3 tiles |
| Destroyer | 2 tiles |

- Ships can be placed horizontally or vertically
- Ships cannot overlap
- Ships must be fully within the board

### Gameplay
1. Both players place their ships
2. Random player goes first
3. Players take turns shooting at coordinates
4. First to sink all enemy ships wins

## WebSocket API

All messages are JSON objects with a `type` field.

### Authentication

#### Register
```json
// Client -> Server
{ "type": "register", "username": "player1", "password": "secret123" }

// Server -> Client (success)
{
  "type": "auth_success",
  "sessionToken": "uuid-token",
  "user": {
    "username": "player1",
    "stats": { "gamesPlayed": 0, "wins": 0, "losses": 0 }
  }
}

// Server -> Client (error)
{ "type": "auth_error", "message": "Username already taken" }
```

#### Login
```json
// Client -> Server
{ "type": "login", "username": "player1", "password": "secret123" }

// Server -> Client (success)
{ "type": "auth_success", "sessionToken": "...", "user": { ... } }

// Server -> Client (kicked from another session)
{ "type": "kicked", "reason": "logged_in_elsewhere" }
```

#### Logout
```json
// Client -> Server
{ "type": "logout" }

// Server -> Client
{ "type": "logout_success" }
```

### Lobby

#### List Available Players
```json
// Client -> Server
{ "type": "list_players" }

// Server -> Client
{
  "type": "player_list",
  "players": [
    {
      "username": "player2",
      "stats": { "gamesPlayed": 5, "wins": 3, "losses": 2 }
    }
  ]
}
```

#### Send Invite
```json
// Client -> Server
{ "type": "send_invite", "targetUsername": "player2" }

// Server -> Client (sender)
{ "type": "invite_sent", "inviteId": "uuid", "to": "player2" }

// Server -> Client (receiver)
{ "type": "invite_received", "inviteId": "uuid", "from": "player1" }

// Server -> Client (error)
{ "type": "invite_error", "message": "Player is already in a game" }
```

#### Accept Invite
```json
// Client -> Server
{ "type": "accept_invite", "inviteId": "uuid" }

// Server -> Client (both players)
{ "type": "invite_accepted", "inviteId": "uuid", "gameId": "game-uuid" }
```

#### Decline Invite
```json
// Client -> Server
{ "type": "decline_invite", "inviteId": "uuid" }

// Server -> Client (both players)
{ "type": "invite_declined", "inviteId": "uuid" }
```

### Game Setup

#### Place Ships
```json
// Client -> Server
{
  "type": "place_ships",
  "ships": [
    { "type": "carrier", "start": "A1", "orientation": "horizontal" },
    { "type": "battleship", "start": "C3", "orientation": "vertical" },
    { "type": "cruiser", "start": "E5", "orientation": "horizontal" },
    { "type": "submarine", "start": "G7", "orientation": "vertical" },
    { "type": "destroyer", "start": "I9", "orientation": "horizontal" }
  ]
}

// Server -> Client (success)
{ "type": "ships_accepted" }

// Server -> Client (waiting)
{ "type": "waiting_for_opponent" }

// Server -> Client (error)
{ "type": "ships_rejected", "errors": ["Ship extends off the board"] }
```

#### Game Start
```json
// Server -> Client (both players, when both ready)
{ "type": "game_start", "yourTurn": true, "opponent": "player2" }
```

### Gameplay

#### Shoot
```json
// Client -> Server
{ "type": "shoot", "coordinate": "A5" }

// Server -> Client (shooter)
{ "type": "shot_result", "coordinate": "A5", "hit": true, "sunk": null }
// or with sunk ship
{ "type": "shot_result", "coordinate": "A5", "hit": true, "sunk": "destroyer" }

// Server -> Client (opponent)
{ "type": "shot_fired", "coordinate": "A5", "by": "player1" }

// Server -> Client (both, if ship sunk)
{ "type": "ship_sunk", "shipType": "destroyer", "player": "player2" }

// Server -> Client (both, after each shot)
{ "type": "turn_change", "currentTurn": "player2" }
```

#### Game Over
```json
// Server -> Client (both players)
{ "type": "game_over", "winner": "player1", "reason": "victory" }
// reason can be: "victory", "forfeit", "timeout"
```

#### Forfeit
```json
// Client -> Server
{ "type": "forfeit" }

// Server -> Client (both players)
{ "type": "game_over", "winner": "player2", "reason": "forfeit" }
```

### Disconnection Handling

```json
// Server -> Client (remaining player when opponent disconnects)
{ "type": "opponent_disconnected", "timeout": 60000 }

// Server -> Client (when opponent reconnects)
{ "type": "opponent_reconnected" }

// Server -> Client (after timeout expires)
{ "type": "game_over", "winner": "player1", "reason": "timeout" }
```

### Errors

```json
// General error
{ "type": "error", "code": "INVALID_MESSAGE", "message": "Invalid message format" }

// Game-specific error
{ "type": "game_error", "message": "It's not your turn" }

// Rate limited
{ "type": "rate_limited", "retryAfter": 1000 }
```

## Rate Limits

| Action | Limit |
|--------|-------|
| Authentication (login/register) | 5 per minute |
| Invites | 10 per minute |
| Game actions (shoot, forfeit, place_ships) | 2 per second |
| General messages | 30 per second |

## Testing

Use `wscat` or any WebSocket client:

```bash
# Install wscat
npm install -g wscat

# Connect (without TLS verification for self-signed certs)
wscat -c wss://localhost:3000 --no-check

# Or without TLS
wscat -c ws://localhost:3000
```

Example session:
```json
> {"type":"register","username":"test","password":"password123"}
< {"type":"auth_success","sessionToken":"...","user":{...}}

> {"type":"list_players"}
< {"type":"player_list","players":[]}
```

## Project Structure

```
src/
├── index.ts           # Entry point
├── server.ts          # WebSocket server setup
├── types.ts           # TypeScript interfaces
├── auth/
│   ├── auth.ts        # Authentication logic
│   ├── password.ts    # Password hashing
│   └── session.ts     # Session management
├── game/
│   ├── board.ts       # Board and coordinates
│   ├── game.ts        # Game state management
│   ├── ship.ts        # Ship validation
│   └── shooting.ts    # Shot processing
├── lobby/
│   ├── invite.ts      # Invite system
│   └── lobby.ts       # Lobby management
├── middleware/
│   └── rateLimit.ts   # Rate limiting
└── protocol/
    ├── handler.ts     # Message routing
    └── messages.ts    # Message parsing/validation
```

## Docker (multi-platform: amd64 + arm64 / Mac)

The image supports **linux/amd64** and **linux/arm64** so it can be pulled on x86 servers and on Mac (Apple Silicon). If you see:

```text
no matching manifest for linux/arm64/v8 in the manifest list entries
```

the image was built for a single platform. Build and push a multi-platform image:

**One-time: enable buildx and create a builder (if not already):**

```bash
docker buildx create --name multiarch --use
```

**Build and push for both platforms:**

```bash
# Replace with your registry and tag, e.g. ghcr.io/yourorg/battleship-server:latest
docker buildx build --platform linux/amd64,linux/arm64 -t YOUR_IMAGE:TAG --push .
```

Or use the script (Mac/Linux):

```bash
chmod +x scripts/build-multiarch.sh
./scripts/build-multiarch.sh YOUR_IMAGE:TAG
```

On Windows (PowerShell), run the same `docker buildx build ...` command. After pushing, `docker pull YOUR_IMAGE:TAG` will work on both x86 and Mac (arm64).

**Local run (no registry):**

```bash
docker compose build
docker compose up -d
```

Compose will build for your current platform only. Use the multi-platform build above when pushing to a registry so others (e.g. on Mac) can pull the image.

## Security Features

- **TLS/SSL encryption** for all WebSocket traffic
- **Argon2id password hashing** (Bun's built-in)
- **Input validation** on all messages
- **Rate limiting** per authenticated user
- **Turn validation** to prevent cheating
- **Server-side game state** - clients never see opponent ships
