import type { LobbyUser, UserStatus, UserStats } from "../types";
import { getOnlineUsers } from "../auth/session";
import { isUserInGame } from "../game/game";
import { getUserStats } from "../user/user";
import { isUserInPendingInvite } from "./invite";

// Track user status
const userStatus = new Map<string, UserStatus>();

export function setUserStatus(username: string, status: UserStatus): void {
  userStatus.set(username, status);
}

export function getUserStatus(username: string): UserStatus {
  // Check if user is in an active game
  if (isUserInGame(username)) {
    return "in_game";
  }

  // Check if user is in a pending invite
  if (isUserInPendingInvite(username)) {
    return "pending_invite";
  }

  // Default to lobby if online
  return userStatus.get(username) || "lobby";
}

export function removeUserStatus(username: string): void {
  userStatus.delete(username);
}

/**
 * Get list of users available in lobby (not in games or pending invites).
 */
export function getLobbyUsers(): LobbyUser[] {
  const onlineUsers = getOnlineUsers();
  const lobbyUsers: LobbyUser[] = [];

  for (const username of onlineUsers) {
    const status = getUserStatus(username);
    if (status === "lobby") {
      lobbyUsers.push({
        username,
        status,
        gameId: null,
      });
    }
  }

  return lobbyUsers;
}

/**
 * Get list of available players with their stats (for invite list).
 */
export function getAvailablePlayers(
  excludeUsername?: string
): Array<{ username: string; stats: UserStats }> {
  const lobbyUsers = getLobbyUsers();
  const players: Array<{ username: string; stats: UserStats }> = [];

  for (const user of lobbyUsers) {
    if (user.username === excludeUsername) continue;

    const stats = getUserStats(user.username);
    if (stats) {
      players.push({
        username: user.username,
        stats,
      });
    }
  }

  return players;
}

