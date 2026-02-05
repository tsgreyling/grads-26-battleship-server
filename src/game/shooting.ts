import type { Game, ShipType } from "../types";
import { parseCoordinate, normalizeCoordinate } from "./board";
import { getShipAtCoordinate, isShipSunk, areAllShipsSunk } from "./ship";
import { getPlayerIndex, getOpponentIndex, switchTurn, isPlayerTurn } from "./game";

export interface ShotOutcome {
  success: boolean;
  error?: string;
  hit?: boolean;
  coordinate?: string;
  sunkShip?: ShipType;
  gameOver?: boolean;
  winner?: string;
}

/**
 * Process a shot from a player.
 * Returns the outcome including hit/miss, if a ship was sunk, and if the game is over.
 */
export function processShot(
  game: Game,
  shooter: string,
  coordinateInput: string
): ShotOutcome {
  // Validate game state
  if (game.status !== "playing") {
    return { success: false, error: "Game is not in progress" };
  }

  // Validate it's the shooter's turn
  if (!isPlayerTurn(game, shooter)) {
    return { success: false, error: "It's not your turn" };
  }

  // Validate and normalize coordinate
  const coordinate = normalizeCoordinate(coordinateInput);
  if (!coordinate) {
    return { success: false, error: `Invalid coordinate: ${coordinateInput}` };
  }

  // Get player and opponent indices
  const shooterIndex = getPlayerIndex(game, shooter);
  const opponentIndex = getOpponentIndex(game, shooter);

  if (shooterIndex === -1 || opponentIndex === -1) {
    return { success: false, error: "Player not found in game" };
  }

  const shooterPlayer = game.players[shooterIndex];
  const opponentPlayer = game.players[opponentIndex];

  // Check if coordinate has already been shot
  if (shooterPlayer.shots.has(coordinate)) {
    return {
      success: false,
      error: `You have already shot at ${coordinate}`,
    };
  }

  // Validate opponent has a board
  if (!opponentPlayer.board) {
    return { success: false, error: "Opponent has not placed ships" };
  }

  // Record the shot
  shooterPlayer.shots.add(coordinate);

  // Check for hit
  const hit = opponentPlayer.board.allShipTiles.has(coordinate);
  let sunkShip: ShipType | undefined;
  let gameOver = false;
  let winner: string | undefined;

  if (hit) {
    // Find the ship that was hit and record the hit
    const ship = getShipAtCoordinate(opponentPlayer.board, coordinate);
    if (ship) {
      ship.hits.add(coordinate);

      // Check if ship is sunk
      if (isShipSunk(ship)) {
        sunkShip = ship.type;

        // Check if all ships are sunk (game over)
        if (areAllShipsSunk(opponentPlayer.board)) {
          gameOver = true;
          winner = shooter;
        }
      }
    }
  }

  // Switch turn (even on miss)
  switchTurn(game);

  return {
    success: true,
    hit,
    coordinate,
    sunkShip,
    gameOver,
    winner,
  };
}
