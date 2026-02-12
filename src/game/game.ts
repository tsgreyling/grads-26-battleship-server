import type {
  Game,
  GamePlayer,
  Board,
  ShipPlacement,
  GameStatus,
} from "../types";
import { createBoard, validateShipPlacements } from "./ship";
import { saveGamesToFile, loadGamesFromFile } from "./persistence";

// In-memory game storage
let games = new Map<string, Game>();

// Username -> Game ID lookup
let userGames = new Map<string, string>();

// Flag to track if we've loaded persisted data
let persistenceLoaded = false;

/**
 * Load persisted games from file.
 * Should be called once on server startup.
 */
export function loadPersistedGames(): void {
  if (persistenceLoaded) return;
  const loaded = loadGamesFromFile();
  games = loaded.games;
  userGames = loaded.userGames;
  persistenceLoaded = true;
}

/**
 * Save current games to file.
 */
export function persistGames(): void {
  saveGamesToFile(games);
}

export function createGame(player1: string, player2: string): Game {
  const gameId = crypto.randomUUID();

  const game: Game = {
    id: gameId,
    players: [
      {
        username: player1,
        board: null,
        ready: false,
        shots: new Set<string>(),
      },
      {
        username: player2,
        board: null,
        ready: false,
        shots: new Set<string>(),
      },
    ],
    currentTurn: Math.random() < 0.5 ? 0 : 1, // Random first turn
    status: "setup",
    winner: null,
    createdAt: new Date(),
    disconnectTimer: null,
    disconnectedPlayer: null,
  };

  games.set(gameId, game);
  userGames.set(player1, gameId);
  userGames.set(player2, gameId);

  persistGames();
  return game;
}

export function getGame(gameId: string): Game | undefined {
  return games.get(gameId);
}

export function getGameByUsername(username: string): Game | undefined {
  const gameId = userGames.get(username);
  return gameId ? games.get(gameId) : undefined;
}

export function getPlayerIndex(game: Game, username: string): 0 | 1 | -1 {
  if (game.players[0].username === username) return 0;
  if (game.players[1].username === username) return 1;
  return -1;
}

export function getOpponentIndex(game: Game, username: string): 0 | 1 | -1 {
  const playerIndex = getPlayerIndex(game, username);
  if (playerIndex === -1) return -1;
  return playerIndex === 0 ? 1 : 0;
}

export function getOpponentUsername(game: Game, username: string): string | null {
  const opponentIndex = getOpponentIndex(game, username);
  if (opponentIndex === -1) return null;
  return game.players[opponentIndex].username;
}

export function placeShips(
  game: Game,
  username: string,
  placements: ShipPlacement[]
): { success: boolean; errors?: string[] } {
  if (game.status !== "setup") {
    return { success: false, errors: ["Game is not in setup phase"] };
  }

  const playerIndex = getPlayerIndex(game, username);
  if (playerIndex === -1) {
    return { success: false, errors: ["You are not in this game"] };
  }

  const player = game.players[playerIndex];
  if (player.ready) {
    return { success: false, errors: ["You have already placed your ships"] };
  }

  // Validate placements
  const errors = validateShipPlacements(placements);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Create board
  const board = createBoard(placements);
  if (!board) {
    return { success: false, errors: ["Failed to create board"] };
  }

  // Update player state
  player.board = board;
  player.ready = true;

  // Check if both players are ready
  if (game.players[0].ready && game.players[1].ready) {
    game.status = "playing";
  }

  persistGames();
  return { success: true };
}

export function isPlayerTurn(game: Game, username: string): boolean {
  const playerIndex = getPlayerIndex(game, username);
  return playerIndex !== -1 && game.currentTurn === playerIndex;
}

export function switchTurn(game: Game): void {
  game.currentTurn = game.currentTurn === 0 ? 1 : 0;
}

export function getCurrentTurnUsername(game: Game): string {
  return game.players[game.currentTurn].username;
}

export function endGame(
  game: Game,
  winner: string,
  reason: "victory" | "forfeit" | "timeout"
): void {
  game.status = "finished";
  game.winner = winner;

  // Clear any disconnect timer
  if (game.disconnectTimer) {
    clearTimeout(game.disconnectTimer);
    game.disconnectTimer = null;
  }

  persistGames();
}

export function removeGame(gameId: string): void {
  const game = games.get(gameId);
  if (!game) return;

  // Clear timer if exists
  if (game.disconnectTimer) {
    clearTimeout(game.disconnectTimer);
  }

  // Remove user mappings
  userGames.delete(game.players[0].username);
  userGames.delete(game.players[1].username);

  // Remove game
  games.delete(gameId);

  persistGames();
}

export function isUserInGame(username: string): boolean {
  return userGames.has(username);
}

export function setDisconnectTimer(
  game: Game,
  username: string,
  callback: () => void,
  timeoutMs: number = 60000
): void {
  // Clear existing timer if any
  if (game.disconnectTimer) {
    clearTimeout(game.disconnectTimer);
  }

  game.disconnectedPlayer = username;
  game.disconnectTimer = setTimeout(callback, timeoutMs);
}

export function clearDisconnectTimer(game: Game): void {
  if (game.disconnectTimer) {
    clearTimeout(game.disconnectTimer);
    game.disconnectTimer = null;
  }
  game.disconnectedPlayer = null;
}
