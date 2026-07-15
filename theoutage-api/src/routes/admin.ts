import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, User } from "../types";
import { requireAuth, requireRole } from "../middleware/auth";

const admin = new Hono<AppEnv>();

// Every route in this file is admin only.
admin.use("*", requireAuth, requireRole("admin"));

const SAFE_USER_COLUMNS = "id, email, email_verified, display_name, created_at, role, frozen";

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
