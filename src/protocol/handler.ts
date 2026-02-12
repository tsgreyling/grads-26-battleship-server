import type { ServerWebSocket } from "bun";
import type {
  WebSocketData,
  ClientMessage,
  ServerMessage,
  ErrorMessage,
  RateLimitedMessage,
  ShipPlacement,
  GameStatus,
} from "../types";
import { parseMessage, requiresAuth, isAllowedInSetup, isAllowedInGameplay, isAllowedInLobby, sanitizeUsername, sanitizeCoordinate } from "./messages";
import { register, login, logout, resumeSession, isAuthenticated, getAuthenticatedUsername } from "../auth/auth";
import { clearSessionWebSocket, sendToUser, getSessionByUsername } from "../auth/session";
import { info as logInfo } from "../logger";
import { serializeBoardForReconnect, getShotHistoryWithResults } from "../game/reconnect";
import { getAvailablePlayers, setUserStatus, removeUserStatus } from "../lobby/lobby";
import {
  createInvite,
  acceptInvite,
  declineInvite,
  cancelAllUserInvites,
  getInvite,
} from "../lobby/invite";
import {
  createGame,
  getGameByUsername,
  placeShips,
  getPlayerIndex,
  getOpponentUsername,
  isPlayerTurn,
  getCurrentTurnUsername,
  endGame,
  removeGame,
  setDisconnectTimer,
  clearDisconnectTimer,
} from "../game/game";
import { processShot } from "../game/shooting";
import { updateUserStats } from "../user/user";
import { tryAction, getActionType, clearUserRateLimits } from "../middleware/rateLimit";

// Timeout constants
const DISCONNECT_TIMEOUT_MS = 60000; // 60 seconds - time before disconnected player forfeits
const GAME_CLEANUP_DELAY_MS = 5000; // 5 seconds - delay before removing finished game from memory

function send(ws: ServerWebSocket<WebSocketData>, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function sendError(
  ws: ServerWebSocket<WebSocketData>,
  code: string,
  message: string
): void {
  const error: ErrorMessage = { type: "error", code, message };
  send(ws, error);
}

/**
 * Handle incoming WebSocket message.
 */
export async function handleMessage(
  ws: ServerWebSocket<WebSocketData>,
  rawMessage: string
): Promise<void> {
  // Parse message
  const message = parseMessage(rawMessage);
  if (!message) {
    logInfo("Protocol", "Invalid message format (parse failed)");
    sendError(ws, "INVALID_MESSAGE", "Invalid message format");
    return;
  }

  const clientId = ws.data.username ?? "anonymous";
  logInfo("Protocol", `Message: ${message.type} (${clientId})`);

  // Check rate limiting for authenticated users
  const username = getAuthenticatedUsername(ws);
  if (username) {
    const actionType = getActionType(message.type);
    const rateLimitResult = tryAction(username, actionType);
    if (rateLimitResult.limited) {
      const rateLimited: RateLimitedMessage = {
        type: "rate_limited",
        retryAfter: rateLimitResult.retryAfter,
      };
      send(ws, rateLimited);
      return;
    }
  }

  // Check authentication for protected messages
  if (requiresAuth(message.type) && !isAuthenticated(ws)) {
    sendError(ws, "UNAUTHORIZED", "You must be logged in to perform this action");
    return;
  }

  // Check state-based message validation
  if (username) {
    const game = getGameByUsername(username);
    if (game) {
      // User is in a game
      if (game.status === "setup" && !isAllowedInSetup(message.type)) {
        sendError(ws, "INVALID_STATE", "This action is not allowed during game setup");
        return;
      }
      if (game.status === "playing" && !isAllowedInGameplay(message.type)) {
        sendError(ws, "INVALID_STATE", "This action is not allowed during gameplay");
        return;
      }
    } else {
      // User is in lobby
      if (!isAllowedInLobby(message.type) && message.type !== "forfeit") {
        sendError(ws, "INVALID_STATE", "This action is not allowed in lobby");
        return;
      }
    }
  }

  // Route message to handler
  switch (message.type) {
    case "register":
      await handleRegister(ws, message.username, message.password);
      break;

    case "login":
      await handleLogin(ws, message.username, message.password);
      break;

    case "resume":
      await handleResume(ws, message.sessionToken);
      break;

    case "logout":
      handleLogout(ws);
      break;

    case "list_players":
      handleListPlayers(ws);
      break;

    case "send_invite":
      handleSendInvite(ws, message.targetUsername);
      break;

    case "accept_invite":
      handleAcceptInvite(ws, message.inviteId);
      break;

    case "decline_invite":
      handleDeclineInvite(ws, message.inviteId);
      break;

    case "place_ships":
      handlePlaceShips(ws, message.ships);
      break;

    case "shoot":
      handleShoot(ws, message.coordinate);
      break;

    case "forfeit":
      handleForfeit(ws);
      break;

    case "ping":
      // Respond with pong to keep connection alive
      ws.send(JSON.stringify({ type: "pong" }));
      break;
  }
}

async function handleRegister(
  ws: ServerWebSocket<WebSocketData>,
  username: string,
  password: string
): Promise<void> {
  // Sanitize username to prevent XSS
  const sanitized = sanitizeUsername(username);
  if (sanitized !== username || sanitized.length === 0) {
    sendError(ws, "INVALID_USERNAME", "Username contains invalid characters or is too long");
    return;
  }

  const result = await register(sanitized, password, ws);
  send(ws, result);

  if (result.type === "auth_success") {
    setUserStatus(sanitized, "lobby");
  }
}

async function handleLogin(
  ws: ServerWebSocket<WebSocketData>,
  username: string,
  password: string
): Promise<void> {
  // Sanitize username to prevent XSS
  const sanitized = sanitizeUsername(username);
  if (sanitized !== username || sanitized.length === 0) {
    sendError(ws, "INVALID_USERNAME", "Username contains invalid characters or is too long");
    return;
  }

  const result = await login(sanitized, password, ws);
  send(ws, result);

  if (result.type === "auth_success") {
    logInfo("Protocol", `User ${sanitized} logged in`);
    applyReconnectionState(ws, sanitized);
  }
}

async function handleResume(
  ws: ServerWebSocket<WebSocketData>,
  sessionToken: string
): Promise<void> {
  const result = resumeSession(sessionToken, ws);
  send(ws, result);

  if (result.type === "auth_success") {
    logInfo("Protocol", `User ${result.user.username} resumed session`);
    applyReconnectionState(ws, result.user.username);
  }
}

/**
 * After successful login or resume: restore user status, clear disconnect timer if needed,
 * send game state (and reconnect_game_state with ships/shots) so the client can continue where they left off.
 *
 * CRITICAL: Uses atomic snapshot to prevent race conditions where game state changes
 * between reading and using it. This ensures the client receives a coherent view of
 * the game state at a single point in time.
 */
export function applyReconnectionState(
  ws: ServerWebSocket<WebSocketData>,
  username: string
): void {
  const game = getGameByUsername(username);
  if (!game || game.status === "finished") {
    logInfo("Reconnect", `${username}: no active game or finished (game=${game ? game.status : "none"})`);
    setUserStatus(username, "lobby");
    return;
  }

  const playerIndex = getPlayerIndex(game, username);
  if (playerIndex < 0) {
    logInfo("Reconnect", `${username}: player not in game (playerIndex=${playerIndex})`);
    setUserStatus(username, "lobby");
    return;
  }
  const idx = playerIndex as 0 | 1;
  const player = game.players[idx];

  // CRITICAL FIX: Create an atomic snapshot of game state at this moment.
  // This prevents race conditions where opponent's actions (shots, game end, etc.)
  // could change game state between when we read it and when we use it.
  // See RACE_CONDITIONS_ANALYSIS.md for detailed explanation.
  const stateSnapshot = {
    gameId: game.id,
    status: game.status,
    currentTurn: game.currentTurn,
    yourTurn: game.currentTurn === idx,
    opponentUsername: getOpponentUsername(game, username),
    playerReady: player.ready,
    playerBoard: player.board,
    shipCount: player.board ? player.board.ships.length : 0,
  };

  const hasBoard = stateSnapshot.playerBoard != null;
  logInfo(
    "Reconnect",
    `${username}: gameId=${stateSnapshot.gameId} status=${stateSnapshot.status} playerIndex=${idx} hasBoard=${hasBoard} shipCount=${stateSnapshot.shipCount}`
  );

  setUserStatus(username, "in_game");

  // Handle disconnect timer and opponent notification (uses game reference for mutable operations)
  if (game.disconnectedPlayer === username) {
    clearDisconnectTimer(game);
    if (stateSnapshot.opponentUsername) {
      sendToUser(stateSnapshot.opponentUsername, { type: "opponent_reconnected" });
    }
  }

  // All subsequent operations use the snapshot (immutable values from one point in time)
  if (stateSnapshot.status === "playing") {
    send(ws, {
      type: "game_start",
      yourTurn: stateSnapshot.yourTurn,
      opponent: stateSnapshot.opponentUsername || "Unknown",
      gameId: stateSnapshot.gameId,
    });
    const playingShots = getShotHistoryWithResults(game, idx);
    const ships = stateSnapshot.playerBoard ? serializeBoardForReconnect(stateSnapshot.playerBoard) : [];
    send(ws, {
      type: "reconnect_game_state",
      gameId: stateSnapshot.gameId,
      ships,
      shots: playingShots,
    });
    logInfo(
      "Reconnect",
      `${username}: sending reconnect_game_state gameId=${stateSnapshot.gameId} ships=${ships.length} shots=${playingShots.length}`
    );
  } else if (stateSnapshot.status === "setup") {
    if (stateSnapshot.playerReady) {
      send(ws, { type: "waiting_for_opponent" });
    }
    const ships = stateSnapshot.playerBoard ? serializeBoardForReconnect(stateSnapshot.playerBoard) : [];
    logInfo("Reconnect", `${username}: sending reconnect_game_state (setup) gameId=${stateSnapshot.gameId} ships=${ships.length}`);
    send(ws, {
      type: "reconnect_game_state",
      gameId: stateSnapshot.gameId,
      ships,
      shots: [],
    });
  } else {
    setUserStatus(username, "lobby");
  }
}

function handleLogout(ws: ServerWebSocket<WebSocketData>): void {
  const username = getAuthenticatedUsername(ws);
  if (!username) {
    sendError(ws, "UNAUTHORIZED", "You are not logged in");
    return;
  }

  // Handle any active game
  const game = getGameByUsername(username);
  if (game && game.status !== "finished") {
    handleForfeit(ws);
  }

  // Cancel any pending invites
  cancelAllUserInvites(username);

  // Clear rate limits
  clearUserRateLimits(username);

  // Remove user status
  removeUserStatus(username);

  // Logout
  if (ws.data.sessionToken) {
    logout(ws.data.sessionToken);
  }

  send(ws, { type: "logout_success" });
}

function handleListPlayers(ws: ServerWebSocket<WebSocketData>): void {
  const username = getAuthenticatedUsername(ws);
  if (!username) {
    sendError(ws, "UNAUTHORIZED", "You are not logged in");
    return;
  }

  const players = getAvailablePlayers(username);
  send(ws, { type: "player_list", players });
}

function handleSendInvite(
  ws: ServerWebSocket<WebSocketData>,
  targetUsername: string
): void {
  const username = getAuthenticatedUsername(ws);
  if (!username) {
    sendError(ws, "UNAUTHORIZED", "You are not logged in");
    return;
  }

  // Check sender is in lobby
  const game = getGameByUsername(username);
  if (game) {
    send(ws, { type: "invite_error", message: "You are already in a game" });
    return;
  }

  // Check target exists and is online
  const targetSession = getSessionByUsername(targetUsername);
  if (!targetSession || !targetSession.ws) {
    send(ws, { type: "invite_error", message: "Player is not online" });
    return;
  }

  // Create invite
  const result = createInvite(username, targetUsername);
  if (!result.success || !result.invite) {
    send(ws, { type: "invite_error", message: result.error || "Failed to create invite" });
    return;
  }

  // Notify sender
  send(ws, {
    type: "invite_sent",
    inviteId: result.invite.id,
    to: targetUsername,
  });

  // Notify target
  sendToUser(targetUsername, {
    type: "invite_received",
    inviteId: result.invite.id,
    from: username,
  });
}

function handleAcceptInvite(
  ws: ServerWebSocket<WebSocketData>,
  inviteId: string
): void {
  const username = getAuthenticatedUsername(ws);
  if (!username) {
    sendError(ws, "UNAUTHORIZED", "You are not logged in");
    return;
  }

  const result = acceptInvite(inviteId, username);
  if (!result.success || !result.invite) {
    send(ws, { type: "invite_error", message: result.error || "Failed to accept invite" });
    return;
  }

  // Create the game
  const game = createGame(result.invite.from, result.invite.to);

  // Update user statuses
  setUserStatus(result.invite.from, "in_game");
  setUserStatus(result.invite.to, "in_game");

  // Notify both players
  send(ws, {
    type: "invite_accepted",
    inviteId,
    gameId: game.id,
  });

  sendToUser(result.invite.from, {
    type: "invite_accepted",
    inviteId,
    gameId: game.id,
  });
}

function handleDeclineInvite(
  ws: ServerWebSocket<WebSocketData>,
  inviteId: string
): void {
  const username = getAuthenticatedUsername(ws);
  if (!username) {
    sendError(ws, "UNAUTHORIZED", "You are not logged in");
    return;
  }

  const result = declineInvite(inviteId, username);
  if (!result.success || !result.invite) {
    send(ws, { type: "invite_error", message: result.error || "Failed to decline invite" });
    return;
  }

  // Notify sender
  sendToUser(result.invite.from, {
    type: "invite_declined",
    inviteId,
  });

  // Confirm to decliner
  send(ws, {
    type: "invite_declined",
    inviteId,
  });
}

function handlePlaceShips(
  ws: ServerWebSocket<WebSocketData>,
  ships: ShipPlacement[]
): void {
  const username = getAuthenticatedUsername(ws);
  if (!username) {
    sendError(ws, "UNAUTHORIZED", "You are not logged in");
    return;
  }

  const game = getGameByUsername(username);
  if (!game) {
    send(ws, { type: "ships_rejected", errors: ["You are not in a game"] });
    return;
  }

  if (game.status !== "setup") {
    send(ws, { type: "ships_rejected", errors: ["Game is not in setup phase"] });
    return;
  }

  const result = placeShips(game, username, ships);
  if (!result.success) {
    send(ws, { type: "ships_rejected", errors: result.errors || ["Failed to place ships"] });
    return;
  }

  send(ws, { type: "ships_accepted" });

  // Check if both players are ready (placeShips may have set status to "playing")
  const statusAfterPlace = game.status as GameStatus;
  if (statusAfterPlace === "playing") {
    // Game has started, notify both players
    const player0Turn = game.currentTurn === 0;

    sendToUser(game.players[0].username, {
      type: "game_start",
      yourTurn: player0Turn,
      opponent: game.players[1].username,
      gameId: game.id,
    });

    sendToUser(game.players[1].username, {
      type: "game_start",
      yourTurn: !player0Turn,
      opponent: game.players[0].username,
      gameId: game.id,
    });
  } else {
    // Waiting for opponent
    send(ws, { type: "waiting_for_opponent" });
  }
}

function handleShoot(
  ws: ServerWebSocket<WebSocketData>,
  coordinate: string
): void {
  const username = getAuthenticatedUsername(ws);
  if (!username) {
    sendError(ws, "UNAUTHORIZED", "You are not logged in");
    return;
  }

  const game = getGameByUsername(username);
  if (!game) {
    send(ws, { type: "game_error", message: "You are not in a game" });
    return;
  }

  // Sanitize coordinate input
  const sanitized = sanitizeCoordinate(coordinate);
  if (sanitized !== coordinate || sanitized.length === 0) {
    send(ws, { type: "game_error", message: "Invalid coordinate format" });
    return;
  }

  const result = processShot(game, username, sanitized);
  if (!result.success) {
    send(ws, { type: "game_error", message: result.error || "Shot failed" });
    return;
  }

  // processShot sets coordinate and hit on success; guard for type safety
  if (result.coordinate === undefined || result.hit === undefined) {
    send(ws, { type: "game_error", message: "Shot failed" });
    return;
  }

  const opponentUsername = getOpponentUsername(game, username);
  if (!opponentUsername) {
    send(ws, { type: "game_error", message: "Could not find opponent" });
    return;
  }

  // Send shot result to shooter
  send(ws, {
    type: "shot_result",
    coordinate: result.coordinate,
    hit: result.hit,
    sunk: result.sunkShip || null,
  });

  // Notify opponent that a shot was fired
  sendToUser(opponentUsername, {
    type: "shot_fired",
    coordinate: result.coordinate,
    by: username,
  });

  // If ship was sunk, notify both players
  if (result.sunkShip) {
    const sunkMessage = {
      type: "ship_sunk" as const,
      shipType: result.sunkShip,
      player: opponentUsername,
    };
    send(ws, sunkMessage);
    sendToUser(opponentUsername, sunkMessage);
  }

  // Check for game over
  if (result.gameOver && result.winner) {
    endGame(game, result.winner, "victory");

    // Update stats
    updateUserStats(result.winner, true);
    updateUserStats(opponentUsername, false);

    // Notify both players
    const gameOverMessage = {
      type: "game_over" as const,
      winner: result.winner,
      reason: "victory" as const,
    };
    send(ws, gameOverMessage);
    sendToUser(opponentUsername, gameOverMessage);

    // Update user statuses
    setUserStatus(username, "lobby");
    setUserStatus(opponentUsername, "lobby");

    // Clean up game after a delay
    setTimeout(() => removeGame(game.id), GAME_CLEANUP_DELAY_MS);
  } else {
    // Notify turn change
    const currentTurn = getCurrentTurnUsername(game);
    const turnMessage = {
      type: "turn_change" as const,
      currentTurn,
    };
    send(ws, turnMessage);
    sendToUser(opponentUsername, turnMessage);
  }
}

function handleForfeit(ws: ServerWebSocket<WebSocketData>): void {
  const username = getAuthenticatedUsername(ws);
  if (!username) {
    sendError(ws, "UNAUTHORIZED", "You are not logged in");
    return;
  }

  const game = getGameByUsername(username);
  if (!game || game.status === "finished") {
    send(ws, { type: "game_error", message: "You are not in an active game" });
    return;
  }

  const opponentUsername = getOpponentUsername(game, username);
  if (!opponentUsername) {
    send(ws, { type: "game_error", message: "Could not find opponent" });
    return;
  }

  // End game with forfeit
  endGame(game, opponentUsername, "forfeit");

  // Update stats
  updateUserStats(opponentUsername, true);
  updateUserStats(username, false);

  // Notify both players
  const gameOverMessage = {
    type: "game_over" as const,
    winner: opponentUsername,
    reason: "forfeit" as const,
  };
  send(ws, gameOverMessage);
  sendToUser(opponentUsername, gameOverMessage);

  // Update user statuses
  setUserStatus(username, "lobby");
  setUserStatus(opponentUsername, "lobby");

  // Clean up game after a delay
  setTimeout(() => removeGame(game.id), GAME_CLEANUP_DELAY_MS);
}

/**
 * Handle WebSocket disconnection.
 */
export function handleDisconnect(ws: ServerWebSocket<WebSocketData>): void {
  const username = ws.data.username;
  if (!username) return;

  // Clear the WebSocket reference from session
  if (ws.data.sessionToken) {
    clearSessionWebSocket(ws.data.sessionToken);
  }

  // Handle game disconnection
  const game = getGameByUsername(username);
  if (game && game.status !== "finished") {
    const opponentUsername = getOpponentUsername(game, username);
    if (opponentUsername) {
      // Notify opponent
      sendToUser(opponentUsername, {
        type: "opponent_disconnected",
        timeout: DISCONNECT_TIMEOUT_MS,
      });

      // Set timeout for forfeit
      setDisconnectTimer(game, username, () => {
        // Auto-forfeit on timeout
        endGame(game, opponentUsername, "timeout");

        // Update stats
        updateUserStats(opponentUsername, true);
        updateUserStats(username, false);

        // Notify winner
        sendToUser(opponentUsername, {
          type: "game_over",
          winner: opponentUsername,
          reason: "timeout",
        });

        // Update statuses
        setUserStatus(opponentUsername, "lobby");
        removeUserStatus(username);

        // Clean up
        setTimeout(() => removeGame(game.id), 5000);
      }, DISCONNECT_TIMEOUT_MS);
    }
  }

  // Cancel any pending invites
  const cancelledInvites = cancelAllUserInvites(username);
  for (const invite of cancelledInvites) {
    const otherUser = invite.from === username ? invite.to : invite.from;
    sendToUser(otherUser, {
      type: "invite_cancelled",
      inviteId: invite.id,
      reason: "User disconnected",
    });
  }
}
