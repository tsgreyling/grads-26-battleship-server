import type { Coordinate } from "../types";

// Board dimensions
export const BOARD_WIDTH = 12; // A-L
export const BOARD_HEIGHT = 12; // 1-12

// Valid column letters
const COLUMNS = "ABCDEFGHIJKL";

/**
 * Parse a coordinate string (e.g., "A5", "K12") to a Coordinate object.
 * Returns null if the coordinate is invalid.
 */
export function parseCoordinate(coord: string): Coordinate | null {
  if (!coord || typeof coord !== "string") return null;

  // Normalize to uppercase and trim
  const normalized = coord.toUpperCase().trim();

  // Must be 2-3 characters (e.g., "A1" to "L12")
  if (normalized.length < 2 || normalized.length > 3) return null;

  // First character is the column (A-L)
  const colChar = normalized[0];
  const colIndex = COLUMNS.indexOf(colChar);
  if (colIndex === -1) return null;

  // Rest is the row number (1-12)
  const rowStr = normalized.slice(1);
  const row = parseInt(rowStr, 10);
  if (isNaN(row) || row < 1 || row > BOARD_HEIGHT) return null;

  return {
    x: colIndex,
    y: row - 1, // Convert to 0-indexed
  };
}

/**
 * Convert a Coordinate object to a string (e.g., "A5").
 */
export function coordinateToString(coord: Coordinate): string {
  return `${COLUMNS[coord.x]}${coord.y + 1}`;
}

/**
 * Check if a coordinate is within board bounds.
 */
export function isValidCoordinate(coord: Coordinate): boolean {
  return (
    coord.x >= 0 &&
    coord.x < BOARD_WIDTH &&
    coord.y >= 0 &&
    coord.y < BOARD_HEIGHT
  );
}

/**
 * Check if a coordinate string is valid.
 */
export function isValidCoordinateString(coord: string): boolean {
  const parsed = parseCoordinate(coord);
  return parsed !== null;
}

/**
 * Normalize a coordinate string to uppercase format (e.g., "a5" -> "A5").
 */
export function normalizeCoordinate(coord: string): string | null {
  const parsed = parseCoordinate(coord);
  if (!parsed) return null;
  return coordinateToString(parsed);
}

