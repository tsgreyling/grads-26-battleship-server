import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import type { Game, GamePlayer, Board, PlacedShip, GameStatus } from "../types";
import { info as logInfo } from "../logger";

const DATA_DIR = "./data";
const GAMES_FILE = `${DATA_DIR}/games.json`;

/**
 * Ensure the data directory exists.
 */
export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Serialized version of PlacedShip (Sets converted to arrays).
 */
interface SerializedPlacedShip {
  type: PlacedShip["type"];
  tiles: string[];
  hits: string[];
}

/**
 * Serialized version of Board (Sets/Maps converted to arrays).
 */
interface SerializedBoard {
  ships: SerializedPlacedShip[];
  allShipTiles: string[];
}

/**
 * Serialized version of GamePlayer (Sets converted to arrays).
 */
interface SerializedGamePlayer {
  username: string;
  board: SerializedBoard | null;
  ready: boolean;
  shots: string[];
}

/**
 * Serialized version of Game (for JSON storage).
 */
interface SerializedGame {
  id: string;
  players: [SerializedGamePlayer, SerializedGamePlayer];
  currentTurn: 0 | 1;
  status: GameStatus;
  winner: string | null;
  createdAt: string;
  // disconnectTimer and disconnectedPlayer are not persisted (runtime only)
}

/**
 * Serialize a PlacedShip for storage.
 */
function serializePlacedShip(ship: PlacedShip): SerializedPlacedShip {
  return {
    type: ship.type,
    tiles: ship.tiles,
    hits: Array.from(ship.hits),
  };
}

/**
 * Deserialize a PlacedShip from storage.
 */
function deserializePlacedShip(data: SerializedPlacedShip): PlacedShip {
  return {
    type: data.type,
    tiles: data.tiles,
    hits: new Set(data.hits),
  };
}

/**
 * Serialize a Board for storage.
 */
function serializeBoard(board: Board): SerializedBoard {
  return {
    ships: board.ships.map(serializePlacedShip),
    allShipTiles: Array.from(board.allShipTiles),
  };
}

/**
 * Deserialize a Board from storage.
 */
function deserializeBoard(data: SerializedBoard): Board {
  const ships = data.ships.map(deserializePlacedShip);
  const allShipTiles = new Set(data.allShipTiles);

  // Rebuild shipsByCoordinate map
  const shipsByCoordinate = new Map<string, PlacedShip>();
  for (const ship of ships) {
    for (const tile of ship.tiles) {
      shipsByCoordinate.set(tile, ship);
    }
  }

  return {
    ships,
    allShipTiles,
    shipsByCoordinate,
  };
}

/**
 * Serialize a GamePlayer for storage.
 */
function serializeGamePlayer(player: GamePlayer): SerializedGamePlayer {
  return {
    username: player.username,
    board: player.board ? serializeBoard(player.board) : null,
    ready: player.ready,
    shots: Array.from(player.shots),
  };
}

/**
 * Deserialize a GamePlayer from storage.
 */
function deserializeGamePlayer(data: SerializedGamePlayer): GamePlayer {
  return {
    username: data.username,
    board: data.board ? deserializeBoard(data.board) : null,
    ready: data.ready,
    shots: new Set(data.shots),
  };
}

/**
 * Serialize a Game for storage.
 */
function serializeGame(game: Game): SerializedGame {
  return {
    id: game.id,
    players: [
      serializeGamePlayer(game.players[0]),
      serializeGamePlayer(game.players[1]),
    ],
    currentTurn: game.currentTurn,
    status: game.status,
    winner: game.winner,
    createdAt: game.createdAt.toISOString(),
  };
}

/**
 * Deserialize a Game from storage.
 */
function deserializeGame(data: SerializedGame): Game {
  return {
    id: data.id,
    players: [
      deserializeGamePlayer(data.players[0]),
      deserializeGamePlayer(data.players[1]),
    ],
    currentTurn: data.currentTurn,
    status: data.status,
    winner: data.winner,
    createdAt: new Date(data.createdAt),
    disconnectTimer: null,
    disconnectedPlayer: null,
  };
}

/**
 * Save all games to file.
 */
export function saveGamesToFile(games: Map<string, Game>): void {
  ensureDataDir();

  // Only persist active games (setup or playing)
  const activeGames: SerializedGame[] = [];
  for (const game of games.values()) {
    if (game.status !== "finished") {
      activeGames.push(serializeGame(game));
    }
  }

  try {
    writeFileSync(GAMES_FILE, JSON.stringify(activeGames, null, 2));
  } catch (err) {
    console.error("[Persistence] Failed to save games:", err);
  }
}

/**
 * Load games from file.
 * Returns games map and userGames lookup map.
 */
export function loadGamesFromFile(): {
  games: Map<string, Game>;
  userGames: Map<string, string>;
} {
  const games = new Map<string, Game>();
  const userGames = new Map<string, string>();

  if (!existsSync(GAMES_FILE)) {
    return { games, userGames };
  }

  try {
    const data = readFileSync(GAMES_FILE, "utf-8");
    const serializedGames: SerializedGame[] = JSON.parse(data);

    for (const serialized of serializedGames) {
      const game = deserializeGame(serialized);
      games.set(game.id, game);

      // Rebuild user -> game mapping
      userGames.set(game.players[0].username, game.id);
      userGames.set(game.players[1].username, game.id);
    }

    logInfo("Persistence", `Loaded ${games.size} game(s) from storage`);
  } catch (err) {
    console.error("[Persistence] Failed to load games:", err);
  }

  return { games, userGames };
}
