# Battleship Server Client Protocol Spec (Junior-Friendly)

This guide explains how to build a client that talks to this Battleship server.

If you are new to WebSockets or game protocols, start at **Quick Start** and copy the examples.

## Who This Is For

- Junior developers building a frontend, bot, or test client.
- Anyone integrating with this server for the first time.

## What This Server Is

- A real-time 2-player Battleship server.
- Communication is done with WebSocket JSON messages.
- Server keeps the source of truth for auth, invites, game state, and turns.

## Quick Start (Happy Path)

1. Open a WebSocket connection.
2. Send `register` (first time) or `login` (existing user).
3. Send `list_players` to see who can be invited.
4. Send `send_invite` to another player.
5. Wait for `invite_accepted`.
6. Send `place_ships`.
7. Wait for `game_start`.
8. When it is your turn, send `shoot`.
9. Keep handling server events until `game_over`.

## Connection Basics

- Protocol: `ws://` or `wss://` (TLS on/off depends on server config).
- Default address: `ws://localhost:3000` or `wss://localhost:3000`.
- Health endpoint (HTTP): `GET /health` returns `OK`.
- Server accepts JSON messages with a `type` field.

Example client message:

```json
{ "type": "list_players" }
```

## Very Important Concept: Server Events Are Async

The server can send messages at any time (for example `invite_received`, `opponent_disconnected`, `game_over`).

Do not code your client like strict request-response only.

Treat your client as an event-driven state machine.

## States You Should Track in Client

Use these states in your UI/client logic:

- `anonymous` (not logged in)
- `lobby` (can invite/list players)
- `setup` (placing ships)
- `playing` (taking turns)
- `finished` (after `game_over`, then back to `lobby`)

### Allowed Messages by State

`anonymous`:
- `register`
- `login`

`lobby`:
- `list_players`
- `send_invite`
- `accept_invite`
- `decline_invite`
- `logout`

`setup`:
- `place_ships`
- `forfeit`
- `logout`

`playing`:
- `shoot`
- `forfeit`
- `logout`

If you send a valid message in the wrong state, you get:

```json
{ "type": "error", "code": "INVALID_STATE", "message": "..." }
```

## Authentication

## Register

Client -> Server:

```json
{ "type": "register", "username": "player1", "password": "secret123" }
```

Success:

```json
{
  "type": "auth_success",
  "sessionToken": "<uuid>",
  "user": {
    "username": "player1",
    "stats": { "gamesPlayed": 0, "wins": 0, "losses": 0 }
  }
}
```

Failure:

```json
{ "type": "auth_error", "message": "Username already taken" }
```

## Login

Client -> Server:

```json
{ "type": "login", "username": "player1", "password": "secret123" }
```

Success/failure shapes are same as register.

If same user logs in on another connection, older connection receives:

```json
{ "type": "kicked", "reason": "logged_in_elsewhere" }
```

## Username and Password Rules

- Username length: 3 to 20 characters.
- Username allowed chars: letters, numbers, underscore.
- Password minimum length: 6.

## Session Notes (Important)

- Sessions expire after 24 hours.
- Current protocol is tied to the open WebSocket connection.
- There is no separate "resume by token" message right now.
- If socket drops, reconnect and login again.

## Lobby and Invite Flow

## List available players

Client -> Server:

```json
{ "type": "list_players" }
```

Server -> Client:

```json
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

## Send invite

Client -> Server:

```json
{ "type": "send_invite", "targetUsername": "player2" }
```

Sender receives:

```json
{ "type": "invite_sent", "inviteId": "<uuid>", "to": "player2" }
```

Target receives:

```json
{ "type": "invite_received", "inviteId": "<uuid>", "from": "player1" }
```

## Accept invite

Client -> Server:

```json
{ "type": "accept_invite", "inviteId": "<uuid>" }
```

Both players receive:

```json
{ "type": "invite_accepted", "inviteId": "<uuid>", "gameId": "<uuid>" }
```

## Decline invite

Client -> Server:

```json
{ "type": "decline_invite", "inviteId": "<uuid>" }
```

Both players receive:

```json
{ "type": "invite_declined", "inviteId": "<uuid>" }
```

## Invite cancellation/expiry

You may receive:

```json
{ "type": "invite_cancelled", "inviteId": "<uuid>", "reason": "expired" }
```

Reasons currently seen:
- `expired`
- `User disconnected`

## Game Setup (Ship Placement)

## Board rules

- Grid size: 12 by 12.
- Columns: `A` to `L`.
- Rows: `1` to `12`.
- Coordinate examples: `A1`, `L12`.

## Required ships

- `carrier` length 5
- `battleship` length 4
- `cruiser` length 3
- `submarine` length 3
- `destroyer` length 2

You must send exactly these 5 ships, once each.

## Place ships message

```json
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
```

Success response:

```json
{ "type": "ships_accepted" }
```

If opponent is not ready yet:

```json
{ "type": "waiting_for_opponent" }
```

Validation failure:

```json
{ "type": "ships_rejected", "errors": ["Ship extends off the board"] }
```

## Game start

When both players are ready:

```json
{ "type": "game_start", "yourTurn": true, "opponent": "player2" }
```

## Gameplay (Turns and Shooting)

## Shoot

Client -> Server:

```json
{ "type": "shoot", "coordinate": "A5" }
```

Shooter gets result:

```json
{ "type": "shot_result", "coordinate": "A5", "hit": true, "sunk": null }
```

`sunk` is ship type if sunk, otherwise `null`.

Opponent gets notification:

```json
{ "type": "shot_fired", "coordinate": "A5", "by": "player1" }
```

If a ship was sunk, both get:

```json
{ "type": "ship_sunk", "shipType": "destroyer", "player": "player2" }
```

After every valid shot, both get turn info:

```json
{ "type": "turn_change", "currentTurn": "player2" }
```

## Forfeit

Client -> Server:

```json
{ "type": "forfeit" }
```

Both players receive:

```json
{ "type": "game_over", "winner": "player2", "reason": "forfeit" }
```

## Game End

Game ends with:

```json
{ "type": "game_over", "winner": "player1", "reason": "victory" }
```

`reason` values:
- `victory`
- `forfeit`
- `timeout`

## Disconnect/Reconnect Behavior

If your opponent disconnects during a game:

```json
{ "type": "opponent_disconnected", "timeout": 60000 }
```

If they reconnect in time:

```json
{ "type": "opponent_reconnected" }
```

If they do not reconnect within 60 seconds, you win by timeout.

## Errors You Should Handle

## Generic protocol errors

```json
{ "type": "error", "code": "INVALID_MESSAGE", "message": "Invalid message format" }
```

Common codes:
- `INVALID_MESSAGE`
- `UNAUTHORIZED`
- `INVALID_STATE`
- `INTERNAL_ERROR`
- `INVALID_USERNAME`

## Game errors

```json
{ "type": "game_error", "message": "It's not your turn" }
```

## Invite errors

```json
{ "type": "invite_error", "message": "Player is not online" }
```

Other invite errors can include:
- `Cannot invite yourself`
- `Player is already in a game`
- `Invite not found or expired`
- `This invite was not sent to you`

## Rate Limiting

When over limit:

```json
{ "type": "rate_limited", "retryAfter": 750 }
```

`retryAfter` is milliseconds.

Configured limits:
- Auth actions: 5/minute
- Invite actions: 10/minute
- Game actions: 2/second
- General actions: 30/second

Implementation detail: rate limiting currently applies only for authenticated users.

## Message Reference (Client -> Server)

- `register { username, password }`
- `login { username, password }`
- `logout {}`
- `list_players {}`
- `send_invite { targetUsername }`
- `accept_invite { inviteId }`
- `decline_invite { inviteId }`
- `place_ships { ships[] }`
- `shoot { coordinate }`
- `forfeit {}`

## Message Reference (Server -> Client)

- Auth/session: `auth_success`, `auth_error`, `kicked`, `logout_success`
- Lobby/invite: `player_list`, `invite_sent`, `invite_received`, `invite_accepted`, `invite_declined`, `invite_cancelled`, `invite_error`
- Setup/gameplay: `ships_accepted`, `ships_rejected`, `waiting_for_opponent`, `game_start`, `shot_result`, `shot_fired`, `ship_sunk`, `turn_change`, `game_over`, `game_error`
- Connectivity/control: `opponent_disconnected`, `opponent_reconnected`, `error`, `rate_limited`

## Practical Tips for Junior Devs

- Always check `message.type` first in your message handler.
- Keep one reducer/state machine for connection + game state.
- Disable "Shoot" button when not your turn.
- Show invite timer or timeout hint in UI.
- Normalize coordinates to uppercase (`a5` -> `A5`) before sending.
- Log unknown server messages so you can debug protocol mismatches.

## Troubleshooting

"I send a message and get INVALID_MESSAGE"
- Check JSON syntax.
- Check required fields exist and are correct type.
- Check `type` spelling.

"I get UNAUTHORIZED"
- Login/register first on this WebSocket.
- If socket reconnected, login again.

"I get INVALID_STATE"
- You are sending a valid command in the wrong phase.
- Example: sending `shoot` before `game_start`.

"I keep getting game_error: It's not your turn"
- Wait for `turn_change` and verify `currentTurn` equals your username.

"Invites randomly disappear"
- Invites expire after 60 seconds.
- If either user disconnects, invite can be cancelled.

## Current Implementation Notes

- Server state is in-memory only. Restart clears users/games/invites.
- Extra JSON fields are ignored if required fields are valid.
- Logging out while in pending invite cancels invite server-side.

## Vanilla JS Examples

The examples below are intentionally plain JavaScript (no frameworks).

## 1. Basic Connection + Message Helpers

```js
// Use ws:// for local dev without TLS, wss:// when TLS is enabled.
const WS_URL = "ws://localhost:3000";

const socket = new WebSocket(WS_URL);

// Small helper to send JSON safely
function send(type, payload = {}) {
  const msg = { type, ...payload };
  socket.send(JSON.stringify(msg));
}

socket.addEventListener("open", () => {
  console.log("Connected to Battleship server");
});

socket.addEventListener("close", (event) => {
  console.log("Socket closed", event.code, event.reason);
});

socket.addEventListener("error", (err) => {
  console.error("WebSocket error", err);
});
```

## 2. Login Example

```js
const username = "player1";
const password = "secret123";

socket.addEventListener("open", () => {
  // Login existing user
  send("login", { username, password });

  // If this is a new account, use:
  // send("register", { username, password });
});

let myUsername = null;

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "auth_success") {
    myUsername = msg.user.username;
    console.log("Logged in as", myUsername);
    console.log("Stats", msg.user.stats);

    // Go to lobby flow
    send("list_players");
  }

  if (msg.type === "auth_error") {
    console.error("Login failed:", msg.message);
  }

  if (msg.type === "kicked") {
    console.warn("Logged out because account logged in elsewhere");
  }

  if (msg.type === "error") {
    console.error(`[${msg.code}] ${msg.message}`);
  }
});
```

## 3. Lobby Example (List + Invite)

```js
let currentInviteId = null;

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "player_list") {
    console.log("Available players:", msg.players.map((p) => p.username));

    // Example: invite first available player
    const target = msg.players[0];
    if (target) {
      send("send_invite", { targetUsername: target.username });
    }
  }

  if (msg.type === "invite_sent") {
    currentInviteId = msg.inviteId;
    console.log("Invite sent to", msg.to, "inviteId:", currentInviteId);
  }

  if (msg.type === "invite_received") {
    console.log("Invite received from", msg.from, "id:", msg.inviteId);

    // Auto-accept incoming invite (example behavior)
    send("accept_invite", { inviteId: msg.inviteId });
  }

  if (msg.type === "invite_accepted") {
    console.log("Match created. gameId:", msg.gameId);

    // Move to setup
    placeMyShips();
  }

  if (msg.type === "invite_declined") {
    console.log("Invite declined", msg.inviteId);
  }

  if (msg.type === "invite_cancelled") {
    console.log("Invite cancelled", msg.inviteId, "reason:", msg.reason);
  }

  if (msg.type === "invite_error") {
    console.error("Invite error:", msg.message);
  }
});
```

## 4. Play Against Another Player (Setup + Gameplay)

```js
function placeMyShips() {
  // Valid example placement of all 5 required ships
  send("place_ships", {
    ships: [
      { type: "carrier", start: "A1", orientation: "horizontal" },
      { type: "battleship", start: "A3", orientation: "horizontal" },
      { type: "cruiser", start: "A5", orientation: "horizontal" },
      { type: "submarine", start: "A7", orientation: "horizontal" },
      { type: "destroyer", start: "A9", orientation: "horizontal" }
    ]
  });
}

// Very simple shot queue for demo purposes
const shotQueue = ["B1", "B2", "B3", "B4", "B5", "C1", "C2"];

function shootNext() {
  const next = shotQueue.shift();
  if (!next) return;
  send("shoot", { coordinate: next });
}

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "ships_accepted") {
    console.log("Ships accepted");
  }

  if (msg.type === "waiting_for_opponent") {
    console.log("Waiting for opponent to place ships...");
  }

  if (msg.type === "ships_rejected") {
    console.error("Ship placement errors:", msg.errors);
  }

  if (msg.type === "game_start") {
    console.log(`Game started vs ${msg.opponent}. Your turn: ${msg.yourTurn}`);
    if (msg.yourTurn) shootNext();
  }

  if (msg.type === "shot_result") {
    console.log("Your shot:", msg.coordinate, "hit:", msg.hit, "sunk:", msg.sunk);
  }

  if (msg.type === "shot_fired") {
    console.log(`Opponent fired at ${msg.coordinate} (by ${msg.by})`);
  }

  if (msg.type === "ship_sunk") {
    console.log(`Ship sunk: ${msg.shipType} belonging to ${msg.player}`);
  }

  if (msg.type === "turn_change") {
    console.log("Current turn:", msg.currentTurn);
    if (msg.currentTurn === myUsername) {
      shootNext();
    }
  }

  if (msg.type === "opponent_disconnected") {
    console.warn(`Opponent disconnected. Timeout: ${msg.timeout}ms`);
  }

  if (msg.type === "opponent_reconnected") {
    console.log("Opponent reconnected");
  }

  if (msg.type === "game_over") {
    console.log(`Game over. Winner: ${msg.winner}. Reason: ${msg.reason}`);

    // Optional: go back to lobby list
    send("list_players");
  }

  if (msg.type === "game_error") {
    console.error("Game error:", msg.message);
  }

  if (msg.type === "rate_limited") {
    console.warn("Rate limited. Retry after", msg.retryAfter, "ms");
  }
});
```

## 5. Optional: Minimal State-Aware Message Router

```js
let state = "anonymous"; // anonymous | lobby | setup | playing

function transition(next) {
  console.log(`State: ${state} -> ${next}`);
  state = next;
}

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "auth_success") transition("lobby");
  if (msg.type === "invite_accepted") transition("setup");
  if (msg.type === "game_start") transition("playing");
  if (msg.type === "game_over") transition("lobby");
});
```

These snippets are intentionally simple so juniors can copy them first, then split them into modules (socket, state, lobby, game) later.

## 6. Bare-Bones Runnable JS Client (No HTML)

```js
// Run with Bun (recommended in this repo): bun run client.js
// Or modern Node that supports WebSocket globally.

const WS_URL = process.env.WS_URL || "ws://localhost:3000";
const USERNAME = process.env.USERNAME || `player_${Math.floor(Math.random() * 10000)}`;
const PASSWORD = process.env.PASSWORD || "secret123";
const MODE = process.env.MODE || "invite"; // "invite" or "accept"
const TARGET = process.env.TARGET || "";   // required when MODE=invite

const ws = new WebSocket(WS_URL);
let me = null;
let inGame = false;

const shots = ["B1", "B2", "B3", "B4", "B5", "C1", "C2", "C3"];

function send(type, payload = {}) {
  ws.send(JSON.stringify({ type, ...payload }));
}

function placeShips() {
  send("place_ships", {
    ships: [
      { type: "carrier", start: "A1", orientation: "horizontal" },
      { type: "battleship", start: "A3", orientation: "horizontal" },
      { type: "cruiser", start: "A5", orientation: "horizontal" },
      { type: "submarine", start: "A7", orientation: "horizontal" },
      { type: "destroyer", start: "A9", orientation: "horizontal" }
    ]
  });
}

function shootNext() {
  const coordinate = shots.shift();
  if (!coordinate) return;
  send("shoot", { coordinate });
}

ws.addEventListener("open", () => {
  console.log("Connected:", WS_URL);
  send("login", { username: USERNAME, password: PASSWORD });
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  console.log("<-", msg);

  if (msg.type === "auth_error") {
    // If login fails because user doesn't exist yet, try register once.
    if (msg.message === "Invalid username or password") {
      send("register", { username: USERNAME, password: PASSWORD });
    }
    return;
  }

  if (msg.type === "auth_success") {
    me = msg.user.username;
    console.log("Logged in as", me);
    send("list_players");
    return;
  }

  if (msg.type === "player_list" && MODE === "invite") {
    const target = TARGET || msg.players[0]?.username;
    if (!target) {
      console.log("No available players to invite.");
      return;
    }
    console.log("Inviting:", target);
    send("send_invite", { targetUsername: target });
    return;
  }

  if (msg.type === "invite_received" && MODE === "accept") {
    send("accept_invite", { inviteId: msg.inviteId });
    return;
  }

  if (msg.type === "invite_accepted") {
    inGame = true;
    placeShips();
    return;
  }

  if (msg.type === "ships_accepted") {
    console.log("Ships accepted");
    return;
  }

  if (msg.type === "game_start") {
    inGame = true;
    console.log("Game started vs", msg.opponent, "yourTurn:", msg.yourTurn);
    if (msg.yourTurn) shootNext();
    return;
  }

  if (msg.type === "turn_change" && msg.currentTurn === me && inGame) {
    shootNext();
    return;
  }

  if (msg.type === "game_over") {
    inGame = false;
    console.log("Game over. winner:", msg.winner, "reason:", msg.reason);
    // optional: ws.close();
    return;
  }

  if (msg.type === "rate_limited") {
    console.log("Rate limited. retryAfter:", msg.retryAfter, "ms");
  }

  if (msg.type === "error" || msg.type === "invite_error" || msg.type === "game_error") {
    console.log("Server error:", msg);
  }
});

ws.addEventListener("close", (e) => {
  console.log("Closed:", e.code, e.reason);
});

ws.addEventListener("error", (e) => {
  console.log("Socket error:", e);
});
```

Quick usage:

- Terminal 1 (auto-accept invites):
  - `MODE=accept USERNAME=player2 PASSWORD=secret123 bun run client.js`
- Terminal 2 (invite player2):
  - `MODE=invite USERNAME=player1 PASSWORD=secret123 TARGET=player2 bun run client.js`

