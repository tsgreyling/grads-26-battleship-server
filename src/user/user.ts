import type { User, UserStats } from "../types";
import { hashPassword } from "../auth/password";

// In-memory user storage
const users = new Map<string, User>();

export function getUser(username: string): User | undefined {
  return users.get(username);
}

export async function createUser(
  username: string,
  password: string
): Promise<User> {
  if (users.has(username)) {
    throw new Error("Username already exists");
  }

  const passwordHash = await hashPassword(password);

  const user: User = {
    username,
    passwordHash,
    stats: {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
    },
    createdAt: new Date(),
  };

  users.set(username, user);
  return user;
}

export function updateUserStats(
  username: string,
  won: boolean
): UserStats | null {
  const user = users.get(username);
  if (!user) return null;

  user.stats.gamesPlayed++;
  if (won) {
    user.stats.wins++;
  } else {
    user.stats.losses++;
  }

  return user.stats;
}

export function getUserStats(username: string): UserStats | null {
  const user = users.get(username);
  return user ? user.stats : null;
}
