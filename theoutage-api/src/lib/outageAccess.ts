import type { Outage, OutageStatus, User } from "../types";

const MODERATOR_ROLES = new Set(["moderator", "admin"]);

export function isModerator(user: User | null): boolean {
  return !!user && MODERATOR_ROLES.has(user.role);
}

/**
 * Visibility rules (spec §7 implications):
 * - published: visible to everyone
 * - draft: author only
 * - pending_review: author + moderators/admins
 * - rejected: author + moderators/admins (so mods can see what they rejected)
 */
export function canViewOutage(user: User | null, outage: Pick<Outage, "status" | "author_id">): boolean {
  if (outage.status === "published") return true;
  if (!user) return false;
  if (user.id === outage.author_id) return true;
  return isModerator(user);
}

export function canEditOutage(user: User | null, outage: Pick<Outage, "author_id">): boolean {
  return !!user && user.id === outage.author_id;
}

interface StatusTransitionResult {
  status: OutageStatus;
  clearRejectionReason: boolean;
}

/**
 * Spec §7/§9 decisions:
 * - editing a published outage ALWAYS resets it to pending_review, regardless
 *   of whether the author asked to "submit" — any change means re-moderation.
 * - draft/rejected outages only move to pending_review when the author
 *   explicitly submits (action = "submit"); a plain field edit leaves them
 *   in place so autosave-style drafts don't accidentally jump the queue.
 * - resubmitting (draft or rejected -> pending_review) clears rejection_reason.
 * - pending_review stays pending_review on edit (already in the queue).
 */
export function computeStatusOnEdit(
  currentStatus: OutageStatus,
  action: "save" | "submit"
): StatusTransitionResult {
  if (currentStatus === "published") {
    return { status: "pending_review", clearRejectionReason: false };
  }

  if (currentStatus === "pending_review") {
    return { status: "pending_review", clearRejectionReason: false };
  }

  // draft or rejected
  if (action === "submit") {
    return { status: "pending_review", clearRejectionReason: true };
  }

  return { status: currentStatus, clearRejectionReason: false };
}
