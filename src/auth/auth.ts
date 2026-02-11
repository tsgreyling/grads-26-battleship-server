import type { ServerWebSocket } from "bun";
import type { WebSocketData, AuthSuccessMessage, AuthErrorMessage } from "../types";
import { verifyPassword } from "./password";
import { createSession, invalidateSession, getSession } from "./session";
import { createUser, getUser } from "../user/user";
import { error as logError } from "../logger";

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 20;
const PASSWORD_MIN_LENGTH = 6;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

function validateUsername(username: string): string | null {
  if (!username || typeof username !== "string") {
    return "Username is required";
  }
  if (username.length < USERNAME_MIN_LENGTH) {
    return `Username must be at least ${USERNAME_MIN_LENGTH} characters`;
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return `Username must be at most ${USERNAME_MAX_LENGTH} characters`;
  }
  if (!USERNAME_REGEX.test(username)) {
    return "Username can only contain letters, numbers, and underscores";
  }
  return null;
}

function validatePassword(password: string): string | null {
  if (!password || typeof password !== "string") {
    return "Password is required";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  return null;
}

export async function register(
  username: string,
  password: string,
  ws: ServerWebSocket<WebSocketData>
): Promise<AuthSuccessMessage | AuthErrorMessage> {
  // Validate input
  const usernameError = validateUsername(username);
  if (usernameError) {
    return { type: "auth_error", message: usernameError };
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return { type: "auth_error", message: passwordError };
  }

  // Check if user exists
  if (getUser(username)) {
    return { type: "auth_error", message: "Username already taken" };
  }

  try {
    // Create user
    const user = await createUser(username, password);

    // Create session
    const session = createSession(username, ws);

    return {
      type: "auth_success",
      sessionToken: session.token,
      user: {
        username: user.username,
        stats: user.stats,
      },
    };
  } catch (err) {
    logError("Auth", `Registration failed (username: ${username})`, err);
    return {
      type: "auth_error",
      message: err instanceof Error ? err.message : "Registration failed",
    };
  }
}

export async function login(
  username: string,
  password: string,
  ws: ServerWebSocket<WebSocketData>
): Promise<AuthSuccessMessage | AuthErrorMessage> {
  // Validate input
  if (!username || !password) {
    return { type: "auth_error", message: "Username and password are required" };
  }

  // Get user
  const user = getUser(username);
  if (!user) {
    return { type: "auth_error", message: "Invalid username or password" };
  }

  // Verify password
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { type: "auth_error", message: "Invalid username or password" };
  }

  // Create session (this will kick any existing session)
  const session = createSession(username, ws);

  return {
    type: "auth_success",
    sessionToken: session.token,
    user: {
      username: user.username,
      stats: user.stats,
    },
  };
}

export function logout(token: string): boolean {
  return invalidateSession(token);
}

export function isAuthenticated(ws: ServerWebSocket<WebSocketData>): boolean {
  if (!ws.data.sessionToken) return false;
  const session = getSession(ws.data.sessionToken);
  return session !== undefined && session.ws === ws;
}

export function getAuthenticatedUsername(
  ws: ServerWebSocket<WebSocketData>
): string | null {
  if (!ws.data.sessionToken) return null;
  const session = getSession(ws.data.sessionToken);
  if (!session || session.ws !== ws) return null;
  return session.username;
}
