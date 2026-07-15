import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, User } from "../types";
import { requireAuth, requireRole } from "../middleware/auth";
import { randomToken } from "../lib/crypto";
import { sendAccountCreatedEmail } from "../lib/email";

const admin = new Hono<AppEnv>();

// Every route in this file is admin only.
admin.use("*", requireAuth, requireRole("admin"));

const SAFE_USER_COLUMNS = "id, email, email_verified, display_name, created_at, role, frozen";

// ------------------------------------------------------------------
// POST /api/admin/users  { email, display_name?, role? }
// Creates an account directly and emails the new user a sign-in link
// (same magic-link mechanism as self-serve signup) — no password is set
// or transmitted. email_verified stays 0 until they actually click it.
// ------------------------------------------------------------------
const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  display_name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["user", "moderator", "admin"]).optional(),
});

admin.post("/users", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "A valid email is required" }, 400);

  const { email, role = "user" } = parsed.data;
  const displayName = parsed.data.display_name || email.split("@")[0];

  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (existing) return c.json({ error: "An account with that email already exists" }, 409);

  const actor = c.get("user")!;

  const user = await c.env.DB.prepare(
    `INSERT INTO users (email, display_name, role) VALUES (?, ?, ?) RETURNING *`
  )
    .bind(email, displayName, role)
    .first<User>();

  await c.env.DB.prepare(
    `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
     VALUES (?, 'create_user', 'user', ?, ?)`
  )
    .bind(actor.id, user!.id, role)
    .run();

  const tokenId = randomToken(32);
  const ttlMin = parseInt(c.env.MAGIC_LINK_TTL_MIN, 10) || 15;
  const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO auth_tokens (id, user_id, purpose, expires_at) VALUES (?, ?, 'magic_link', ?)`
  )
    .bind(tokenId, user!.id, expiresAt)
    .run();

  const link = `${c.env.APP_ORIGIN}/api/auth/verify?token=${tokenId}`;
  try {
    await sendAccountCreatedEmail(c.env, email, link);
  } catch (err) {
    // Account is created either way — they just didn't get the email yet
    // and can request a fresh sign-in link from the login page.
    console.error("[admin] sendAccountCreatedEmail failed:", err);
  }

  const { password_hash, ...safe } = user!;
  return c.json({ user: safe }, 201);
});

// ------------------------------------------------------------------
// GET /api/admin/users?q=&page=&pageSize=
// outage_count / storage_bytes are computed per user (own outages and the
// artifacts attached to them) so the admin page can show usage at a glance.
// ------------------------------------------------------------------
admin.get("/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query("pageSize") ?? "50", 10) || 50));
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: string[] = [];
  if (q) {
    where.push("(u.email LIKE ? OR u.display_name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.email_verified, u.display_name, u.created_at, u.role, u.frozen,
            (SELECT COUNT(*) FROM outages o WHERE o.author_id = u.id) AS outage_count,
            (SELECT COALESCE(SUM(a.size_bytes), 0) FROM artifacts a
             JOIN outages o2 ON o2.id = a.outage_id WHERE o2.author_id = u.id) AS storage_bytes
     FROM users u ${whereSql} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all();

  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users u ${whereSql}`)
    .bind(...params)
    .first<{ n: number }>();

  return c.json({ results, total: totalRow?.n ?? 0, page, pageSize });
});

const roleSchema = z.object({ role: z.enum(["user", "moderator", "admin"]) });

// ------------------------------------------------------------------
// PATCH /api/admin/users/:id/role  { role }
// ------------------------------------------------------------------
admin.patch("/users/:id/role", async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const actor = c.get("user")!;
  if (id === actor.id) return c.json({ error: "You can't change your own access level" }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = roleSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "role must be user, moderator, or admin" }, 400);

  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
  if (!target) return c.json({ error: "Not found" }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(parsed.data.role, id),
    c.env.DB.prepare(
      `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
       VALUES (?, 'change_role', 'user', ?, ?)`
    ).bind(actor.id, id, `${target.role} -> ${parsed.data.role}`),
  ]);

  const updated = await c.env.DB.prepare(`SELECT ${SAFE_USER_COLUMNS} FROM users WHERE id = ?`)
    .bind(id)
    .first();
  return c.json({ user: updated });
});

// ------------------------------------------------------------------
// POST /api/admin/users/:id/freeze
// Existing sessions stop authenticating immediately (see getUserForSession);
// login and magic-link verification are also blocked while frozen.
// ------------------------------------------------------------------
admin.post("/users/:id/freeze", async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const actor = c.get("user")!;
  if (id === actor.id) return c.json({ error: "You can't freeze your own account" }, 400);

  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
  if (!target) return c.json({ error: "Not found" }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET frozen = 1 WHERE id = ?`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
       VALUES (?, 'freeze_user', 'user', ?, NULL)`
    ).bind(actor.id, id),
  ]);

  const updated = await c.env.DB.prepare(`SELECT ${SAFE_USER_COLUMNS} FROM users WHERE id = ?`)
    .bind(id)
    .first();
  return c.json({ user: updated });
});

// ------------------------------------------------------------------
// POST /api/admin/users/:id/unfreeze
// ------------------------------------------------------------------
admin.post("/users/:id/unfreeze", async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const actor = c.get("user")!;
  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
  if (!target) return c.json({ error: "Not found" }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET frozen = 0 WHERE id = ?`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
       VALUES (?, 'unfreeze_user', 'user', ?, NULL)`
    ).bind(actor.id, id),
  ]);

  const updated = await c.env.DB.prepare(`SELECT ${SAFE_USER_COLUMNS} FROM users WHERE id = ?`)
    .bind(id)
    .first();
  return c.json({ user: updated });
});

// ------------------------------------------------------------------
// POST /api/admin/users/:id/verify-email
// Manually marks an account verified without them clicking a magic link
// (e.g. an admin vouching for someone who's having email trouble).
// ------------------------------------------------------------------
admin.post("/users/:id/verify-email", async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
  if (!target) return c.json({ error: "Not found" }, 404);

  if (!target.email_verified) {
    const actor = c.get("user")!;
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).bind(id),
      c.env.DB.prepare(
        `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
         VALUES (?, 'verify_email', 'user', ?, NULL)`
      ).bind(actor.id, id),
    ]);
  }

  const updated = await c.env.DB.prepare(`SELECT ${SAFE_USER_COLUMNS} FROM users WHERE id = ?`)
    .bind(id)
    .first();
  return c.json({ user: updated });
});

// ------------------------------------------------------------------
// POST /api/admin/users/:id/reset-access
// Clears any password (falls back to magic-link-only), signs the user out
// everywhere, and invalidates any outstanding auth tokens. Doesn't touch
// their outages, comments, or profile.
// ------------------------------------------------------------------
admin.post("/users/:id/reset-access", async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const actor = c.get("user")!;
  if (id === actor.id) {
    return c.json({ error: "You can't reset your own access from here — use Set Password instead" }, 400);
  }

  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
  if (!target) return c.json({ error: "Not found" }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = NULL WHERE id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id),
    c.env.DB.prepare(`UPDATE auth_tokens SET used = 1 WHERE user_id = ? AND used = 0`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
       VALUES (?, 'reset_user_access', 'user', ?, NULL)`
    ).bind(actor.id, id),
  ]);

  return c.json({ ok: true });
});

// ------------------------------------------------------------------
// DELETE /api/admin/users/:id?deleteContent=true
// Schema note: outages.author_id and comments.author_id are ON DELETE
// RESTRICT, so a user can't be deleted while they have either — the caller
// must opt into deleteContent=true to purge their outages (which cascades
// to that outage's artifacts and comments — including comments OTHER users
// left on it) and their own comments (on any outage) first.
// moderation_log.moderator_id is also RESTRICT and deliberately has no
// purge option here — deleting someone with moderation history would erase
// audit trail, so that's always blocked; freeze the account instead.
// ------------------------------------------------------------------
admin.delete("/users/:id", async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const actor = c.get("user")!;
  if (id === actor.id) return c.json({ error: "You can't delete your own account" }, 400);

  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
  if (!target) return c.json({ error: "Not found" }, 404);

  const modLogRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM moderation_log WHERE moderator_id = ?`)
    .bind(id)
    .first<{ n: number }>();
  if ((modLogRow?.n ?? 0) > 0) {
    return c.json(
      { error: "This account has moderation actions on record and can't be deleted — the audit trail must be preserved. Freeze it instead." },
      409
    );
  }

  const deleteContent = c.req.query("deleteContent") === "true";

  const outageCountRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM outages WHERE author_id = ?`)
    .bind(id)
    .first<{ n: number }>();
  const commentCountRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM comments WHERE author_id = ?`)
    .bind(id)
    .first<{ n: number }>();
  const outageCount = outageCountRow?.n ?? 0;
  const commentCount = commentCountRow?.n ?? 0;

  if ((outageCount > 0 || commentCount > 0) && !deleteContent) {
    return c.json(
      {
        error: `This account has ${outageCount} submission(s) and ${commentCount} comment(s). Delete their content too, or freeze the account instead.`,
        outageCount,
        commentCount,
      },
      409
    );
  }

  // Collect R2 keys before the cascade deletes the artifacts rows — D1
  // deletion never touches R2 storage, so this is the only chance to know
  // what to clean up.
  let r2Keys: string[] = [];
  if (deleteContent && outageCount > 0) {
    const { results } = await c.env.DB.prepare(
      `SELECT a.r2_key FROM artifacts a JOIN outages o ON o.id = a.outage_id WHERE o.author_id = ?`
    )
      .bind(id)
      .all<{ r2_key: string }>();
    r2Keys = results.map((r) => r.r2_key);
  }

  const statements = [];
  if (deleteContent) {
    statements.push(c.env.DB.prepare(`DELETE FROM comments WHERE author_id = ?`).bind(id));
    statements.push(c.env.DB.prepare(`DELETE FROM outages WHERE author_id = ?`).bind(id));
  }
  statements.push(c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id));
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
       VALUES (?, 'delete_user', 'user', ?, ?)`
    ).bind(actor.id, id, deleteContent ? `deleted with ${outageCount} outage(s), ${commentCount} comment(s)` : "deleted, no content")
  );

  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    console.error("[admin] delete user failed:", err);
    return c.json({ error: "Couldn't delete this account — it may still have related records." }, 500);
  }

  // Best-effort — the DB deletion already succeeded and is the source of
  // truth; an orphaned R2 object is wasted storage, not a correctness bug.
  for (const key of r2Keys) {
    await c.env.ARTIFACTS.delete(key).catch((err) => console.error(`[admin] failed to delete R2 object ${key}:`, err));
  }

  return c.json({ ok: true, deletedOutages: outageCount, deletedComments: commentCount });
});

export default admin;
