import type {
  ShipPlacement,
  PlacedShip,
  Board,
  ShipType,
  Coordinate,
} from "../types";
import { SHIP_LENGTHS, REQUIRED_SHIPS } from "../types";
import {
  parseCoordinate,
  coordinateToString,
  isValidCoordinate,
  BOARD_WIDTH,
  BOARD_HEIGHT,
} from "./board";

/**
 * Calculate all tiles occupied by a ship given its placement.
 * Returns null if the ship would be out of bounds.
 */
export function calculateShipTiles(
  placement: ShipPlacement
): string[] | null {
  const start = parseCoordinate(placement.start);
  if (!start) return null;

  const length = SHIP_LENGTHS[placement.type];
  if (!length) return null;

  const tiles: string[] = [];

  for (let i = 0; i < length; i++) {
    let coord: Coordinate;

    if (placement.orientation === "horizontal") {
      coord = { x: start.x + i, y: start.y };
    } else {
      coord = { x: start.x, y: start.y + i };
    }

    if (!isValidCoordinate(coord)) {
      return null; // Ship extends off the board
    }

    tiles.push(coordinateToString(coord));
  }

  return tiles;
}

/**
 * Validate ship placements and return validation errors.
 */
export function validateShipPlacements(
  placements: ShipPlacement[]
): string[] {
  const errors: string[] = [];

  // Check we have exactly 5 ships
  if (!Array.isArray(placements)) {
    return ["Ships must be an array"];
  }

  if (placements.length !== REQUIRED_SHIPS.length) {
    errors.push(
      `Must place exactly ${REQUIRED_SHIPS.length} ships, got ${placements.length}`
    );
    return errors;
  }

  // Track which ship types we've seen
  const seenTypes = new Set<ShipType>();

  // Track all occupied tiles for overlap detection
  const occupiedTiles = new Set<string>();

  for (let i = 0; i < placements.length; i++) {
    const placement = placements[i];

    // Validate placement structure
    if (!placement || typeof placement !== "object") {
      errors.push(`Ship ${i + 1}: Invalid placement object`);
      continue;
    }

    // Validate ship type
    if (!SHIP_LENGTHS[placement.type]) {
      errors.push(`Ship ${i + 1}: Invalid ship type "${placement.type}"`);
      continue;
    }

    // Check for duplicate ship types
    if (seenTypes.has(placement.type)) {
      errors.push(`Ship ${i + 1}: Duplicate ship type "${placement.type}"`);
      continue;
    }
    seenTypes.add(placement.type);

    // Validate orientation
    if (
      placement.orientation !== "horizontal" &&
      placement.orientation !== "vertical"
    ) {
      errors.push(
        `Ship ${i + 1} (${placement.type}): Invalid orientation "${placement.orientation}"`
      );
      continue;
    }

    // Validate start coordinate
    if (!placement.start || typeof placement.start !== "string") {
      errors.push(
        `Ship ${i + 1} (${placement.type}): Invalid start coordinate`
      );
      continue;
    }

    const startCoord = parseCoordinate(placement.start);
    if (!startCoord) {
      errors.push(
        `Ship ${i + 1} (${placement.type}): Invalid start coordinate "${placement.start}"`
      );
      continue;
    }

    // Calculate ship tiles
    const tiles = calculateShipTiles(placement);
    if (!tiles) {
      errors.push(
        `Ship ${i + 1} (${placement.type}): Ship extends off the board`
      );
      continue;
    }

    // Check for overlaps
    for (const tile of tiles) {
      if (occupiedTiles.has(tile)) {
        errors.push(
          `Ship ${i + 1} (${placement.type}): Overlaps with another ship at ${tile}`
        );
      }
      occupiedTiles.add(tile);
    }
  }

  // Check all required ship types are present
  for (const requiredType of REQUIRED_SHIPS) {
    if (!seenTypes.has(requiredType)) {
      errors.push(`Missing required ship: ${requiredType}`);
    }
  }

  return errors;
}

/**
 * Create a Board from validated ship placements.
 * Returns null if placements are invalid (defensive check).
 */
export function createBoard(placements: ShipPlacement[]): Board | null {
  if (validateShipPlacements(placements).length > 0) return null;

  const ships: PlacedShip[] = [];
  const allShipTiles = new Set<string>();
  const shipsByCoordinate = new Map<string, PlacedShip>();

  for (const placement of placements) {
    const tiles = calculateShipTiles(placement);
    if (!tiles) return null;

    const ship: PlacedShip = {
      type: placement.type,
      tiles,
      hits: new Set<string>(),
    };

    ships.push(ship);

    for (const tile of tiles) {
      allShipTiles.add(tile);
      shipsByCoordinate.set(tile, ship);
    }
  }

  return { ships, allShipTiles, shipsByCoordinate };
}

/**
 * Check if a ship is sunk (all tiles hit).
 */
export function isShipSunk(ship: PlacedShip): boolean {
  return ship.hits.size === ship.tiles.length;
}

/**
 * Get the ship at a given coordinate, if any.
 * Optimized to O(1) using coordinate map.
 */
export function getShipAtCoordinate(
  board: Board,
  coordinate: string
): PlacedShip | null {
  return board.shipsByCoordinate.get(coordinate) || null;
}

/**
 * Check if all ships on a board are sunk.
 */
export function areAllShipsSunk(board: Board): boolean {
  return board.ships.every(isShipSunk);
}
