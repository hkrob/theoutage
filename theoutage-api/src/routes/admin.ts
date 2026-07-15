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
// ------------------------------------------------------------------
admin.get("/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query("pageSize") ?? "50", 10) || 50));
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: string[] = [];
  if (q) {
    where.push("(email LIKE ? OR display_name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { results } = await c.env.DB.prepare(
    `SELECT ${SAFE_USER_COLUMNS} FROM users ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all();

  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users ${whereSql}`)
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

export default admin;
