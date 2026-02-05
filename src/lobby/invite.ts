import type { Invite, InviteCancelledMessage } from "../types";
import { isUserInGame } from "../game/game";
import { sendToUser } from "../auth/session";

// Invite storage
const invites = new Map<string, Invite>();

// Track pending invites by user (for collision detection)
// Maps username to invite ID they're involved in
const userPendingInvites = new Map<string, string>();

// Optimize lookups by indexing invites by recipient and sender
const invitesByRecipient = new Map<string, Set<string>>(); // to -> Set<inviteId>
const invitesBySender = new Map<string, Set<string>>(); // from -> Set<inviteId>

// Lock for users currently processing invites
const processingLocks = new Set<string>();

// Invite expiration configuration
const INVITE_TTL_MS = 60 * 1000; // 60 seconds
const INVITE_CLEANUP_INTERVAL_MS = 10 * 1000; // Check every 10 seconds

/**
 * Check if an invite has expired based on its createdAt timestamp.
 */
function isInviteExpired(invite: Invite): boolean {
  return Date.now() - invite.createdAt.getTime() > INVITE_TTL_MS;
}

/**
 * Clean up expired invites and notify involved users.
 */
function cleanupExpiredInvites(): void {
  const expiredInvites: Invite[] = [];

  for (const invite of invites.values()) {
    if (isInviteExpired(invite)) {
      expiredInvites.push(invite);
    }
  }

  for (const invite of expiredInvites) {
    // Remove invite from storage
    invites.delete(invite.id);
    userPendingInvites.delete(invite.from);
    userPendingInvites.delete(invite.to);

    // Remove from indices
    invitesByRecipient.get(invite.to)?.delete(invite.id);
    invitesBySender.get(invite.from)?.delete(invite.id);

    // Notify both users that the invite expired
    const cancelMessage: InviteCancelledMessage = {
      type: "invite_cancelled",
      inviteId: invite.id,
      reason: "expired",
    };

    sendToUser(invite.from, cancelMessage);
    sendToUser(invite.to, cancelMessage);
  }

  if (expiredInvites.length > 0) {
    console.log(`[Invite] Cleaned up ${expiredInvites.length} expired invites`);
  }
}

// Start the cleanup interval
const cleanupInterval = setInterval(cleanupExpiredInvites, INVITE_CLEANUP_INTERVAL_MS);

// Allow cleanup to be stopped (useful for graceful shutdown)
export function stopInviteCleanup(): void {
  clearInterval(cleanupInterval);
}

export function isUserInPendingInvite(username: string): boolean {
  return userPendingInvites.has(username);
}

export function acquireLock(username: string): boolean {
  if (processingLocks.has(username)) {
    return false;
  }
  processingLocks.add(username);
  return true;
}

export function releaseLock(username: string): void {
  processingLocks.delete(username);
}

export interface CreateInviteResult {
  success: boolean;
  invite?: Invite;
  error?: string;
}

/**
 * Create a new invite from one user to another.
 * Implements first-come-first-served collision handling with atomic lock management.
 */
export function createInvite(from: string, to: string): CreateInviteResult {
  // Can't invite yourself
  if (from === to) {
    return { success: false, error: "Cannot invite yourself" };
  }

  // Check if sender is in a game
  if (isUserInGame(from)) {
    return { success: false, error: "You are already in a game" };
  }

  // Check if target is in a game
  if (isUserInGame(to)) {
    return { success: false, error: "Player is already in a game" };
  }

  // Try to acquire locks for both users
  if (!acquireLock(from)) {
    return { success: false, error: "You are already processing an invite" };
  }

  // Use try/finally to ensure locks are always released, even on error
  let fromLockHeld = true;
  let toLockHeld = false;

  try {
    if (!acquireLock(to)) {
      return { success: false, error: "Player is already in a game setup" };
    }
    toLockHeld = true;

    // Check if either user already has a pending invite
    // This check MUST happen while locks are held to prevent race conditions
    if (userPendingInvites.has(from)) {
      return { success: false, error: "You already have a pending invite" };
    }

    if (userPendingInvites.has(to)) {
      return { success: false, error: "Player is already in a game setup" };
    }

    // Create the invite - this is the atomic critical section
    // Both locks are held, both users verified as available
    const inviteId = crypto.randomUUID();
    const invite: Invite = {
      id: inviteId,
      from,
      to,
      createdAt: new Date(),
    };

    // Store invite data atomically while locks are still held
    invites.set(inviteId, invite);
    userPendingInvites.set(from, inviteId);
    userPendingInvites.set(to, inviteId);

    // Update indices for O(1) lookups
    if (!invitesByRecipient.has(to)) {
      invitesByRecipient.set(to, new Set());
    }
    invitesByRecipient.get(to)!.add(inviteId);

    if (!invitesBySender.has(from)) {
      invitesBySender.set(from, new Set());
    }
    invitesBySender.get(from)!.add(inviteId);

    return { success: true, invite };
  } finally {
    // Always release locks in finally block to prevent lock leaks
    if (fromLockHeld) releaseLock(from);
    if (toLockHeld) releaseLock(to);
  }
}

export function getInvite(inviteId: string): Invite | undefined {
  return invites.get(inviteId);
}

/**
 * Cancel/remove an invite. Returns the invite if it existed.
 */
export function cancelInvite(inviteId: string): Invite | null {
  const invite = invites.get(inviteId);
  if (!invite) return null;

  invites.delete(inviteId);
  userPendingInvites.delete(invite.from);
  userPendingInvites.delete(invite.to);

  // Remove from indices
  invitesByRecipient.get(invite.to)?.delete(inviteId);
  invitesBySender.get(invite.from)?.delete(inviteId);

  return invite;
}

/**
 * Accept an invite. Returns the invite if accepted successfully.
 */
export function acceptInvite(
  inviteId: string,
  acceptingUser: string
): { success: boolean; invite?: Invite; error?: string } {
  const invite = invites.get(inviteId);

  if (!invite) {
    return { success: false, error: "Invite not found or expired" };
  }

  if (invite.to !== acceptingUser) {
    return { success: false, error: "This invite was not sent to you" };
  }

  // Remove the invite (game creation happens in the handler)
  invites.delete(inviteId);
  userPendingInvites.delete(invite.from);
  userPendingInvites.delete(invite.to);

  // Remove from indices
  invitesByRecipient.get(invite.to)?.delete(inviteId);
  invitesBySender.get(invite.from)?.delete(inviteId);

  return { success: true, invite };
}

/**
 * Decline an invite.
 */
export function declineInvite(
  inviteId: string,
  decliningUser: string
): { success: boolean; invite?: Invite; error?: string } {
  const invite = invites.get(inviteId);

  if (!invite) {
    return { success: false, error: "Invite not found or expired" };
  }

  if (invite.to !== decliningUser) {
    return { success: false, error: "This invite was not sent to you" };
  }

  // Remove the invite
  invites.delete(inviteId);
  userPendingInvites.delete(invite.from);
  userPendingInvites.delete(invite.to);

  // Remove from indices
  invitesByRecipient.get(invite.to)?.delete(inviteId);
  invitesBySender.get(invite.from)?.delete(inviteId);

  return { success: true, invite };
}

/**
 * Cancel all invites involving a user (used when user disconnects or enters game).
 */
export function cancelAllUserInvites(username: string): Invite[] {
  const cancelled: Invite[] = [];

  for (const [inviteId, invite] of invites) {
    if (invite.from === username || invite.to === username) {
      cancelled.push(invite);
      invites.delete(inviteId);
      userPendingInvites.delete(invite.from);
      userPendingInvites.delete(invite.to);

      // Remove from indices
      invitesByRecipient.get(invite.to)?.delete(inviteId);
      invitesBySender.get(invite.from)?.delete(inviteId);
    }
  }

  return cancelled;
}

/**
 * Get count of pending invites.
 */
export function getPendingInviteCount(): number {
  return invites.size;
}
