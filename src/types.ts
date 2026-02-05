import type { ServerWebSocket } from "bun";

// ============ User & Authentication Types ============

export interface UserStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
}

export interface User {
  username: string;
  passwordHash: string;
  stats: UserStats;
  createdAt: Date;
}

export interface Session {
  token: string;
  username: string;
  createdAt: Date;
  ws: ServerWebSocket<WebSocketData> | null;
}

export interface WebSocketData {
  sessionToken: string | null;
  username: string | null;
}

// ============ Game Board Types ============

export interface Coordinate {
  x: number; // 0-11 (A-L)
  y: number; // 0-11 (1-12)
}

export type ShipType = "carrier" | "battleship" | "cruiser" | "submarine" | "destroyer";

export const SHIP_LENGTHS: Record<ShipType, number> = {
  carrier: 5,
  battleship: 4,
  cruiser: 3,
  submarine: 3,
  destroyer: 2,
};

export const REQUIRED_SHIPS: ShipType[] = [
  "carrier",
  "battleship",
  "cruiser",
  "submarine",
  "destroyer",
];

export type Orientation = "horizontal" | "vertical";

export interface ShipPlacement {
  type: ShipType;
  start: string; // e.g., "A1"
  orientation: Orientation;
}

export interface PlacedShip {
  type: ShipType;
  tiles: string[]; // All occupied coordinates as strings, e.g., ["A1", "A2", "A3"]
  hits: Set<string>; // Tiles that have been hit
}

export interface Board {
  ships: PlacedShip[];
  allShipTiles: Set<string>; // Quick lookup for hit detection
  shipsByCoordinate: Map<string, PlacedShip>; // O(1) lookup: coordinate -> ship
}

export type ShotResult = "hit" | "miss";

// ============ Game Types ============

export type GameStatus = "setup" | "playing" | "finished";

export interface GamePlayer {
  username: string;
  board: Board | null; // null until ships are placed
  ready: boolean;
  shots: Set<string>; // Shots this player has fired at opponent
}

export interface Game {
  id: string;
  players: [GamePlayer, GamePlayer];
  currentTurn: 0 | 1;
  status: GameStatus;
  winner: string | null;
  createdAt: Date;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  disconnectedPlayer: string | null;
}

// ============ Lobby Types ============

export type UserStatus = "lobby" | "in_game" | "pending_invite";

export interface LobbyUser {
  username: string;
  status: UserStatus;
  gameId: string | null;
}

export interface Invite {
  id: string;
  from: string;
  to: string;
  createdAt: Date;
}

// ============ Rate Limiting Types ============

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitEntry {
  timestamps: number[];
}

// ============ Message Types ============

// Client -> Server Messages

export interface RegisterMessage {
  type: "register";
  username: string;
  password: string;
}

export interface LoginMessage {
  type: "login";
  username: string;
  password: string;
}

export interface LogoutMessage {
  type: "logout";
}

export interface ListPlayersMessage {
  type: "list_players";
}

export interface SendInviteMessage {
  type: "send_invite";
  targetUsername: string;
}

export interface AcceptInviteMessage {
  type: "accept_invite";
  inviteId: string;
}

export interface DeclineInviteMessage {
  type: "decline_invite";
  inviteId: string;
}

export interface PlaceShipsMessage {
  type: "place_ships";
  ships: ShipPlacement[];
}

export interface ShootMessage {
  type: "shoot";
  coordinate: string;
}

export interface ForfeitMessage {
  type: "forfeit";
}

export type ClientMessage =
  | RegisterMessage
  | LoginMessage
  | LogoutMessage
  | ListPlayersMessage
  | SendInviteMessage
  | AcceptInviteMessage
  | DeclineInviteMessage
  | PlaceShipsMessage
  | ShootMessage
  | ForfeitMessage;

// Server -> Client Messages

export interface AuthSuccessMessage {
  type: "auth_success";
  sessionToken: string;
  user: {
    username: string;
    stats: UserStats;
  };
}

export interface AuthErrorMessage {
  type: "auth_error";
  message: string;
}

export interface KickedMessage {
  type: "kicked";
  reason: "logged_in_elsewhere";
}

export interface PlayerListMessage {
  type: "player_list";
  players: Array<{
    username: string;
    stats: UserStats;
  }>;
}

export interface InviteReceivedMessage {
  type: "invite_received";
  inviteId: string;
  from: string;
}

export interface InviteSentMessage {
  type: "invite_sent";
  inviteId: string;
  to: string;
}

export interface InviteAcceptedMessage {
  type: "invite_accepted";
  inviteId: string;
  gameId: string;
}

export interface InviteDeclinedMessage {
  type: "invite_declined";
  inviteId: string;
}

export interface InviteErrorMessage {
  type: "invite_error";
  message: string;
}

export interface InviteCancelledMessage {
  type: "invite_cancelled";
  inviteId: string;
  reason: string;
}

export interface ShipsAcceptedMessage {
  type: "ships_accepted";
}

export interface ShipsRejectedMessage {
  type: "ships_rejected";
  errors: string[];
}

export interface GameStartMessage {
  type: "game_start";
  yourTurn: boolean;
  opponent: string;
}

export interface WaitingForOpponentMessage {
  type: "waiting_for_opponent";
}

export interface ShotResultMessage {
  type: "shot_result";
  coordinate: string;
  hit: boolean;
  sunk: ShipType | null;
}

export interface ShotFiredMessage {
  type: "shot_fired";
  coordinate: string;
  by: string;
}

export interface ShipSunkMessage {
  type: "ship_sunk";
  shipType: ShipType;
  player: string;
}

export interface TurnChangeMessage {
  type: "turn_change";
  currentTurn: string;
}

export interface GameOverMessage {
  type: "game_over";
  winner: string;
  reason: "victory" | "forfeit" | "timeout";
}

export interface GameErrorMessage {
  type: "game_error";
  message: string;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
}

export interface RateLimitedMessage {
  type: "rate_limited";
  retryAfter: number;
}

export interface LogoutSuccessMessage {
  type: "logout_success";
}

export interface OpponentDisconnectedMessage {
  type: "opponent_disconnected";
  timeout: number;
}

export interface OpponentReconnectedMessage {
  type: "opponent_reconnected";
}

export type ServerMessage =
  | AuthSuccessMessage
  | AuthErrorMessage
  | KickedMessage
  | PlayerListMessage
  | InviteReceivedMessage
  | InviteSentMessage
  | InviteAcceptedMessage
  | InviteDeclinedMessage
  | InviteErrorMessage
  | InviteCancelledMessage
  | ShipsAcceptedMessage
  | ShipsRejectedMessage
  | GameStartMessage
  | WaitingForOpponentMessage
  | ShotResultMessage
  | ShotFiredMessage
  | ShipSunkMessage
  | TurnChangeMessage
  | GameOverMessage
  | GameErrorMessage
  | ErrorMessage
  | RateLimitedMessage
  | LogoutSuccessMessage
  | OpponentDisconnectedMessage
  | OpponentReconnectedMessage;
