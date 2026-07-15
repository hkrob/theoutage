import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Comment, Outage } from "../types";
import { requireAuth, requireRole } from "../middleware/auth";
import { sendOutageApprovedEmail, sendOutageRejectedEmail, sendCommentRemovedEmail } from "../lib/email";

const moderation = new Hono<AppEnv>();

// Every route in this file is moderator/admin only.
moderation.use("*", requireAuth, requireRole("moderator", "admin"));

const rejectSchema = z.object({ reason: z.string().trim().min(1).max(2000) });
const removeCommentSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  internal_note: z.string().trim().max(2000).optional(),
});

/**
 * Notification sends never roll back or fail the moderation action — the
 * status change + audit log write already committed by the time we send,
 * and a Resend hiccup shouldn't leave an outage stuck in a weird state or
 * make the moderator think their action didn't take. Log and move on.
 */
async function notifyBestEffort(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[moderation] ${label} notification failed:`, err);
  }
}

// ------------------------------------------------------------------
// POST /api/moderation/outages/:id/approve
// ------------------------------------------------------------------
moderation.post("/outages/:id/approve", async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const outage = await c.env.DB.prepare(
    `SELECT o.*, u.email AS author_email
     FROM outages o JOIN users u ON u.id = o.author_id
     WHERE o.id = ?`
  )
    .bind(id)
    .first<Outage & { author_email: string }>();

  if (!outage) return c.json({ error: "Not found" }, 404);
  if (outage.status !== "pending_review") {
    return c.json({ error: "Only pending_review outages can be approved" }, 400);
  }

  const moderator = c.get("user")!;

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE outages SET status = 'published', rejection_reason = NULL WHERE id = ?`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
       VALUES (?, 'approve_outage', 'outage', ?, NULL)`
    ).bind(moderator.id, id),
  ]);

  const outageUrl = `${c.env.APP_ORIGIN}/outages/${id}`;
  await notifyBestEffort("approve_outage", () =>
    sendOutageApprovedEmail(c.env, outage.author_email, outage.title, outageUrl)
  );

  const updated = await c.env.DB.prepare(`SELECT * FROM outages WHERE id = ?`).bind(id).first<Outage>();
  return c.json({ outage: updated });
});

// ------------------------------------------------------------------
// POST /api/moderation/outages/:id/reject  { reason }
// ------------------------------------------------------------------
moderation.post("/outages/:id/reject", async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "A rejection reason is required" }, 400);

  const outage = await c.env.DB.prepare(
    `SELECT o.*, u.email AS author_email
     FROM outages o JOIN users u ON u.id = o.author_id
     WHERE o.id = ?`
  )
    .bind(id)
    .first<Outage & { author_email: string }>();

  if (!outage) return c.json({ error: "Not found" }, 404);
  if (outage.status !== "pending_review") {
    return c.json({ error: "Only pending_review outages can be rejected" }, 400);
  }

  const moderator = c.get("user")!;
  const reason = parsed.data.reason;

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE outages SET status = 'rejected', rejection_reason = ? WHERE id = ?`).bind(
      reason,
      id
    ),
    c.env.DB.prepare(
      `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
       VALUES (?, 'reject_outage', 'outage', ?, ?)`
    ).bind(moderator.id, id, reason),
  ]);

  await notifyBestEffort("reject_outage", () =>
    sendOutageRejectedEmail(c.env, outage.author_email, outage.title, reason)
  );

  const updated = await c.env.DB.prepare(`SELECT * FROM outages WHERE id = ?`).bind(id).first<Outage>();
  return c.json({ outage: updated });
});

// ------------------------------------------------------------------
// POST /api/moderation/comments/:id/remove  { reason, internal_note? }
// reason is shown to the commenter; internal_note is moderator-only.
// ------------------------------------------------------------------
moderation.post("/comments/:id/remove", async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = removeCommentSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "A removal reason is required" }, 400);

  const comment = await c.env.DB.prepare(
    `SELECT c.*, u.email AS author_email
     FROM comments c JOIN users u ON u.id = c.author_id
     WHERE c.id = ?`
  )
    .bind(id)
    .first<Comment & { author_email: string }>();

  if (!comment) return c.json({ error: "Not found" }, 404);
  if (comment.status !== "live") {
    return c.json({ error: "Comment is already removed" }, 400);
  }

  const moderator = c.get("user")!;
  const { reason, internal_note } = parsed.data;

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE comments SET status = 'removed' WHERE id = ?`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason, internal_note)
       VALUES (?, 'remove_comment', 'comment', ?, ?, ?)`
    ).bind(moderator.id, id, reason, internal_note ?? null),
  ]);

  await notifyBestEffort("remove_comment", () => sendCommentRemovedEmail(c.env, comment.author_email, reason));

  return c.body(null, 204);
});

// ------------------------------------------------------------------
// GET /api/moderation/log — audit trail. Not explicitly a spec endpoint,
// but §9/§10 require "a full moderation audit log is kept" — added a read
// path since a log nobody can view isn't much of an audit trail.
// ------------------------------------------------------------------
moderation.get("/log", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query("pageSize") ?? "50", 10) || 50));
  const offset = (page - 1) * pageSize;

  const { results } = await c.env.DB.prepare(
    `SELECT l.*, u.display_name AS moderator_display_name
     FROM moderation_log l
     JOIN users u ON u.id = l.moderator_id
     ORDER BY l.created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(pageSize, offset)
    .all();

  return c.json({ results, page, pageSize });
});

export default moderation;
