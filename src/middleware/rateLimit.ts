import type { RateLimitConfig, RateLimitEntry } from "../types";

// Rate limit configurations for different action types
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  auth: {
    maxRequests: 5,
    windowMs: 60000, // 5 auth attempts per minute
  },
  invite: {
    maxRequests: 10,
    windowMs: 60000, // 10 invites per minute
  },
  game_action: {
    maxRequests: 2,
    windowMs: 1000, // 2 game actions per second
  },
  general: {
    maxRequests: 30,
    windowMs: 1000, // 30 messages per second
  },
};

// Per-user rate limit tracking: username -> action -> timestamps
const userRateLimits = new Map<string, Map<string, RateLimitEntry>>();

/**
 * Clean up old timestamps from the rate limit entry.
 */
function cleanupTimestamps(entry: RateLimitEntry, windowMs: number): void {
  const now = Date.now();
  const cutoff = now - windowMs;
  entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
}

/**
 * Check if a user is rate limited for a specific action.
 * Returns the number of milliseconds until they can retry, or 0 if not limited.
 */
function checkRateLimit(
  username: string,
  actionType: string
): { limited: boolean; retryAfter: number } {
  const config = RATE_LIMITS[actionType];
  if (!config) {
    // Unknown action type, apply general limit
    return checkRateLimit(username, "general");
  }

  let userLimits = userRateLimits.get(username);
  if (!userLimits) {
    userLimits = new Map();
    userRateLimits.set(username, userLimits);
  }

  let entry = userLimits.get(actionType);
  if (!entry) {
    entry = { timestamps: [] };
    userLimits.set(actionType, entry);
  }

  // Clean up old timestamps
  cleanupTimestamps(entry, config.windowMs);

  // Check if over limit
  if (entry.timestamps.length >= config.maxRequests) {
    // Calculate when the oldest timestamp will expire
    const oldestTimestamp = entry.timestamps[0];
    const retryAfter = oldestTimestamp + config.windowMs - Date.now();
    return {
      limited: true,
      retryAfter: Math.max(0, Math.ceil(retryAfter)),
    };
  }

  return { limited: false, retryAfter: 0 };
}

/**
 * Record an action for rate limiting.
 * Should be called after checkRateLimit returns limited: false.
 */
function recordAction(username: string, actionType: string): void {
  let userLimits = userRateLimits.get(username);
  if (!userLimits) {
    userLimits = new Map();
    userRateLimits.set(username, userLimits);
  }

  let entry = userLimits.get(actionType);
  if (!entry) {
    entry = { timestamps: [] };
    userLimits.set(actionType, entry);
  }

  entry.timestamps.push(Date.now());
}

/**
 * Combined check and record for rate limiting.
 * Returns the rate limit result. If not limited, the action is recorded.
 */
export function tryAction(
  username: string,
  actionType: string
): { limited: boolean; retryAfter: number } {
  const result = checkRateLimit(username, actionType);
  if (!result.limited) {
    recordAction(username, actionType);
  }
  return result;
}

/**
 * Clear all rate limits for a user (e.g., when they disconnect).
 */
export function clearUserRateLimits(username: string): void {
  userRateLimits.delete(username);
}

/**
 * Get the action type for a message type.
 */
export function getActionType(messageType: string): string {
  switch (messageType) {
    case "register":
    case "login":
      return "auth";

    case "send_invite":
    case "accept_invite":
    case "decline_invite":
      return "invite";

    case "shoot":
    case "forfeit":
    case "place_ships":
      return "game_action";

    default:
      return "general";
  }
}

/**
 * Periodic cleanup of old rate limit data (call periodically).
 */
export function cleanupRateLimits(): void {
  const now = Date.now();

  for (const [username, userLimits] of userRateLimits) {
    for (const [actionType, entry] of userLimits) {
      const config = RATE_LIMITS[actionType] || RATE_LIMITS.general;
      cleanupTimestamps(entry, config.windowMs);

      // Remove empty entries
      if (entry.timestamps.length === 0) {
        userLimits.delete(actionType);
      }
    }

    // Remove users with no entries
    if (userLimits.size === 0) {
      userRateLimits.delete(username);
    }
  }
}
