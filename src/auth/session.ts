import type { ServerWebSocket } from "bun";
import type { Session, WebSocketData, KickedMessage } from "../types";
import { error as logError } from "../logger";

// Session token -> Session
const sessions = new Map<string, Session>();

// Username -> Session token (for finding existing sessions)
const userSessions = new Map<string, string>();

// Session expiration configuration
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Run cleanup every hour

/**
 * Check if a session has expired based on its createdAt timestamp.
 */
function isSessionExpired(session: Session): boolean {
  return Date.now() - session.createdAt.getTime() > SESSION_TTL_MS;
}

/**
 * Clean up expired sessions.
 */
function cleanupExpiredSessions(): void {
  const expiredTokens: string[] = [];

  for (const [token, session] of sessions) {
    if (isSessionExpired(session)) {
      expiredTokens.push(token);
    }
  }

  for (const token of expiredTokens) {
    const session = sessions.get(token);
    if (session) {
      if (session.ws) {
        try {
          session.ws.close(1000, "Session expired");
        } catch (err) {
          logError("Session", `Error closing expired session (username: ${session.username})`, err);
        }
      }
      userSessions.delete(session.username);
      sessions.delete(token);
    }
  }
}

// Start the cleanup interval
const cleanupInterval = setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL_MS);

// Allow cleanup to be stopped (useful for graceful shutdown)
export function stopSessionCleanup(): void {
  clearInterval(cleanupInterval);
}

export function createSession(
  username: string,
  ws: ServerWebSocket<WebSocketData>
): Session {
  // Check if user already has an active session
  const existingToken = userSessions.get(username);
  if (existingToken) {
    const existingSession = sessions.get(existingToken);
    if (existingSession?.ws) {
      try {
        const kickMessage: KickedMessage = {
          type: "kicked",
          reason: "logged_in_elsewhere",
        };
        existingSession.ws.send(JSON.stringify(kickMessage));
        existingSession.ws.close(1000, "Logged in from another location");
      } catch (err) {
        logError("Session", `Failed to kick existing session (username: ${username})`, err);
        existingSession.ws.close(1000, "Logged in from another location");
      }
    }
    // Remove old session
    sessions.delete(existingToken);
  }

  // Create new session
  const token = crypto.randomUUID();
  const session: Session = {
    token,
    username,
    createdAt: new Date(),
    ws,
  };

  sessions.set(token, session);
  userSessions.set(username, token);

  // Update WebSocket data
  ws.data.sessionToken = token;
  ws.data.username = username;

  return session;
}

export function getSession(token: string): Session | undefined {
  const session = sessions.get(token);
  if (!session) return undefined;

  // Check if session has expired
  if (isSessionExpired(session)) {
    // Clean up expired session
    userSessions.delete(session.username);
    sessions.delete(token);
    return undefined;
  }

  return session;
}

export function getSessionByUsername(
  username: string
): Session | undefined {
  const token = userSessions.get(username);
  if (!token) return undefined;

  const session = sessions.get(token);
  if (!session) return undefined;

  // Check if session has expired
  if (isSessionExpired(session)) {
    userSessions.delete(username);
    sessions.delete(token);
    return undefined;
  }

  return session;
}

export function invalidateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;

  userSessions.delete(session.username);
  sessions.delete(token);
  return true;
}

export function clearSessionWebSocket(token: string): void {
  const session = sessions.get(token);
  if (session) {
    session.ws = null;
  }
}

export function getOnlineUsers(): string[] {
  const online: string[] = [];
  for (const [username, token] of userSessions) {
    const session = sessions.get(token);
    if (session?.ws) {
      online.push(username);
    }
  }
  return online;
}

export function sendToUser(
  username: string,
  message: object
): boolean {
  const session = getSessionByUsername(username);
  if (!session?.ws) return false;

  try {
    session.ws.send(JSON.stringify(message));
    return true;
  } catch (err) {
    logError("Session", `Failed to send to user (username: ${username}, messageType: ${(message as { type?: string }).type ?? "unknown"})`, err);
    return false;
  }
}
