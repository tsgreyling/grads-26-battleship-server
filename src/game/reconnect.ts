import type { Game, Board, SerializedPlacedShip, SerializedShot, ShipType } from "../types";
import { getPlayerIndex, getOpponentIndex } from "./game";
import { getShipAtCoordinate, isShipSunk } from "./ship";

/**
 * Serialize a board for reconnection (ships with hits as arrays for JSON).
 */
export function serializeBoardForReconnect(board: Board): SerializedPlacedShip[] {
  return board.ships.map((ship) => ({
    type: ship.type,
    tiles: [...ship.tiles],
    hits: [...ship.hits],
  }));
}

/**
 * Build shot history with hit/sunk for a player (for reconnection in playing phase).
 * Derives results from the opponent's board.
 */
export function getShotHistoryWithResults(
  game: Game,
  playerIndex: number
): SerializedShot[] {
  if (playerIndex !== 0 && playerIndex !== 1) return [];
  const player = game.players[playerIndex];
  const opponentIndex = getOpponentIndex(game, player.username);
  if (opponentIndex === -1 || !player.shots.size) return [];

  const opponentBoard = game.players[opponentIndex].board;
  if (!opponentBoard) return [];

  const shots: SerializedShot[] = [];
  for (const coordinate of player.shots) {
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
