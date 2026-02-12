import type { ClientMessage, ShipPlacement } from "../types";
import { SHIP_LENGTHS } from "../types";

/**
 * Parse and validate a raw WebSocket message.
 * Returns the parsed message or null if invalid.
 */
export function parseMessage(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw);

    if (!data || typeof data !== "object" || !data.type) {
      return null;
    }

    // Validate based on message type
    switch (data.type) {
      case "register":
      case "login":
        if (
          typeof data.username !== "string" ||
          typeof data.password !== "string"
        ) {
          return null;
        }
        return data as ClientMessage;

      case "resume":
        if (typeof data.sessionToken !== "string") {
          return null;
        }
        return data as ClientMessage;

      case "logout":
      case "list_players":
      case "forfeit":
      case "ping":
        return data as ClientMessage;

      case "send_invite":
        if (typeof data.targetUsername !== "string") {
          return null;
        }
        return data as ClientMessage;

      case "accept_invite":
      case "decline_invite":
        if (typeof data.inviteId !== "string") {
          return null;
        }
        return data as ClientMessage;

      case "place_ships":
        if (!validateShipPlacementsFormat(data.ships)) {
          return null;
        }
        return data as ClientMessage;

      case "shoot":
        if (typeof data.coordinate !== "string") {
          return null;
        }
        return data as ClientMessage;

      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Validate the format of ship placements (not the game rules).
 */
function validateShipPlacementsFormat(ships: unknown): ships is ShipPlacement[] {
  if (!Array.isArray(ships)) {
    return false;
  }

  for (const ship of ships) {
    if (!ship || typeof ship !== "object") {
      return false;
    }

    const s = ship as Record<string, unknown>;

    // Check type is a valid ship type
    if (typeof s.type !== "string" || !(s.type in SHIP_LENGTHS)) {
      return false;
    }

    // Check start is a string coordinate
    if (typeof s.start !== "string") {
      return false;
    }

    // Check orientation is valid
    if (s.orientation !== "horizontal" && s.orientation !== "vertical") {
      return false;
    }
  }

  return true;
}

/**
 * Sanitize a coordinate string (basic XSS prevention).
 */
export function sanitizeCoordinate(coord: string): string {
  // Only allow alphanumeric characters
  return coord.replace(/[^a-zA-Z0-9]/g, "").substring(0, 3);
}

/**
 * Sanitize a username (basic XSS prevention).
 */
export function sanitizeUsername(username: string): string {
  // Only allow alphanumeric and underscore
  return username.replace(/[^a-zA-Z0-9_]/g, "").substring(0, 20);
}

/**
 * Check if a message requires authentication.
 */
export function requiresAuth(messageType: string): boolean {
  return messageType !== "register" && messageType !== "login" && messageType !== "resume";
}

/**
 * Message types that are allowed during game setup phase.
 */
const SETUP_ALLOWED_MESSAGES = new Set([
  "place_ships",
  "forfeit",
  "logout",
]);

/**
 * Message types that are allowed during active gameplay.
 */
const GAMEPLAY_ALLOWED_MESSAGES = new Set([
  "shoot",
  "forfeit",
  "logout",
]);

/**
 * Message types that are allowed in lobby.
 */
const LOBBY_ALLOWED_MESSAGES = new Set([
  "list_players",
  "send_invite",
  "accept_invite",
  "decline_invite",
  "logout",
]);

export function isAllowedInSetup(messageType: string): boolean {
  return SETUP_ALLOWED_MESSAGES.has(messageType);
}

export function isAllowedInGameplay(messageType: string): boolean {
  return GAMEPLAY_ALLOWED_MESSAGES.has(messageType);
}

export function isAllowedInLobby(messageType: string): boolean {
  return LOBBY_ALLOWED_MESSAGES.has(messageType);
}
