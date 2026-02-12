import type { ServerWebSocket } from "bun";
import type { Session, WebSocketData, KickedMessage } from "../types";
import { info as logInfo, error as logError } from "../logger";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";

const DATA_DIR = "./data";
const SESSIONS_FILE = `${DATA_DIR}/sessions.json`;

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
      } catch (err) {
        logError("Session", `Failed to kick existing session (username: ${username})`, err);
      }
      try {
        existingSession.ws.close(1000, "Logged in from another location");
      } catch (err) {
        logError("Session", `Error closing session (username: ${username})`, err);
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

  // Persist sessions after creation
  saveSessionsToFile();

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

  // Persist sessions after invalidation
  saveSessionsToFile();
  return true;
}

export function clearSessionWebSocket(token: string): void {
  const session = sessions.get(token);
  if (session) {
    session.ws = null;
  }
}

/**
 * Attach a WebSocket to an existing session (resume). If the session already has
 * a different WebSocket, that connection is kicked. Returns the session if valid.
 */
export function attachWebSocketToSession(
  token: string,
  ws: ServerWebSocket<WebSocketData>
): Session | undefined {
  const session = getSession(token);
  if (!session) return undefined;

  if (session.ws != null && session.ws !== ws) {
    try {
      const kickMessage: KickedMessage = {
        type: "kicked",
        reason: "logged_in_elsewhere",
      };
      session.ws.send(JSON.stringify(kickMessage));
    } catch (err) {
      logError("Session", `Failed to kick existing session (username: ${session.username})`, err);
    }
    try {
      session.ws.close(1000, "Logged in from another location");
    } catch (err) {
      logError("Session", `Error closing session (username: ${session.username})`, err);
    }
  }

  session.ws = ws;
  ws.data.sessionToken = token;
  ws.data.username = session.username;

  return session;
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

// ============ Session Persistence ============

interface SerializedSession {
  token: string;
  username: string;
  createdAt: string;
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Save all sessions to file.
 */
export function saveSessionsToFile(): void {
  ensureDataDir();

  const serialized: SerializedSession[] = [];
  for (const session of sessions.values()) {
    // Only save non-expired sessions
    if (!isSessionExpired(session)) {
      serialized.push({
        token: session.token,
        username: session.username,
        createdAt: session.createdAt.toISOString(),
      });
    }
  }

  try {
    writeFileSync(SESSIONS_FILE, JSON.stringify(serialized, null, 2));
  } catch (err) {
    logError("Session", "Failed to save sessions to file", err);
  }
}

/**
 * Load sessions from file.
 */
export function loadSessionsFromFile(): void {
  if (!existsSync(SESSIONS_FILE)) {
    return;
  }

  try {
    const data = readFileSync(SESSIONS_FILE, "utf-8");
    const serialized: SerializedSession[] = JSON.parse(data);

    for (const item of serialized) {
      const session: Session = {
        token: item.token,
        username: item.username,
        createdAt: new Date(item.createdAt),
        ws: null, // WebSocket will be re-attached on reconnect
      };

      // Only load non-expired sessions
      if (!isSessionExpired(session)) {
        sessions.set(session.token, session);
        userSessions.set(session.username, session.token);
      }
    }

    logInfo("Session", `Loaded ${sessions.size} session(s) from storage`);
  } catch (err) {
    logError("Session", "Failed to load sessions from file", err);
  }
}
