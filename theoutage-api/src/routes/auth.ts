import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, User } from "../types";
import { randomToken, hashPassword, verifyPassword } from "../lib/crypto";
import {
  createSession,
  destroySession,
  buildSessionCookie,
  buildClearCookie,
  readSessionIdFromCookie,
} from "../lib/session";
import { sendMagicLinkEmail, sendPasswordResetEmail } from "../lib/email";
import { checkRateLimit } from "../lib/rateLimit";
import { requireAuth } from "../middleware/auth";

const auth = new Hono<AppEnv>();

const emailSchema = z.string().trim().toLowerCase().email();
const passwordSchema = z.string().min(8).max(200);

function pbkdf2Iterations(env: AppEnv["Bindings"]): number {
  return parseInt(env.PBKDF2_ITERATIONS, 10) || 100000;
}

// ------------------------------------------------------------------
// POST /api/auth/magic-link  { email }
// Spec §5 sequence step 1-2: create/find user, issue token, send email.
// ------------------------------------------------------------------
auth.post("/magic-link", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ email: emailSchema }).safeParse(body);
  if (!parsed.success) return c.json({ error: "Valid email required" }, 400);

  const email = parsed.data.email;

  const limit = parseInt(c.env.RATE_LIMIT_MAGIC_LINK_PER_HOUR, 10) || 3;
  const allowed = await checkRateLimit(c.env, `magic_link:${email}`, limit);
  if (!allowed) return c.json({ error: "Too many requests. Try again later." }, 429);

  let user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email)
    .first<User>();

  if (!user) {
    const displayName = email.split("@")[0];
    user = await c.env.DB.prepare(
      `INSERT INTO users (email, display_name) VALUES (?, ?) RETURNING *`
    )
      .bind(email, displayName)
      .first<User>();
  }

  const tokenId = randomToken(32);
  const ttlMin = parseInt(c.env.MAGIC_LINK_TTL_MIN, 10) || 15;
  const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO auth_tokens (id, user_id, purpose, expires_at) VALUES (?, ?, 'magic_link', ?)`
  )
    .bind(tokenId, user!.id, expiresAt)
    .run();

  const link = `${c.env.APP_ORIGIN}/api/auth/verify?token=${tokenId}`;
  await sendMagicLinkEmail(c.env, email, link);

  // Always 200 — don't leak whether the address was already registered.
  return c.json({ ok: true });
});

// ------------------------------------------------------------------
// GET /api/auth/verify?token=...
// Spec §5 sequence step 3-4: validate token, mark used, verify email,
// create session, redirect to the Pages frontend.
// ------------------------------------------------------------------
auth.get("/verify", async (c) => {
  const token = c.req.query("token");
  const origin = c.env.APP_ORIGIN;

  if (!token) {
    return c.redirect(`${origin}/auth-callback.html?status=error&reason=missing_token`, 302);
  }

  const row = await c.env.DB.prepare(
    `SELECT * FROM auth_tokens WHERE id = ? AND purpose IN ('magic_link', 'email_verify')`
  )
    .bind(token)
    .first<{ id: string; user_id: number; expires_at: string; used: number }>();

  if (!row || row.used || new Date(row.expires_at).getTime() < Date.now()) {
    return c.redirect(`${origin}/auth-callback.html?status=error&reason=invalid_or_expired`, 302);
  }

  const tokenUser = await c.env.DB.prepare(`SELECT frozen FROM users WHERE id = ?`)
    .bind(row.user_id)
    .first<{ frozen: number }>();
  if (tokenUser?.frozen) {
    return c.redirect(`${origin}/auth-callback.html?status=error&reason=account_frozen`, 302);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE auth_tokens SET used = 1 WHERE id = ?`).bind(token),
    c.env.DB.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).bind(row.user_id),
  ]);

  const sessionId = await createSession(c.env, row.user_id);
  const cookie = await buildSessionCookie(c.env, sessionId);

  c.header("Set-Cookie", cookie);
  return c.redirect(`${origin}/auth-callback.html?status=ok`, 302);
});

// ------------------------------------------------------------------
// POST /api/auth/login  { email, password }
// Optional password path — only works once a user has set a password.
// ------------------------------------------------------------------
auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1) })
    .safeParse(body);
  if (!parsed.success) return c.json({ error: "Email and password required" }, 400);

  const { email, password } = parsed.data;
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email)
    .first<User>();

  // Same error for "no such user", "no password set", and "wrong password" —
  // avoids leaking which case applies.
  if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  if (user.frozen) {
    return c.json({ error: "This account has been frozen. Contact support." }, 403);
  }

  if (!user.email_verified) {
    return c.json(
      { error: "Email not verified yet. Check your inbox or request a new magic link." },
      403
    );
  }

  const sessionId = await createSession(c.env, user.id);
  const cookie = await buildSessionCookie(c.env, sessionId);
  c.header("Set-Cookie", cookie);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------
// POST /api/auth/password-reset/request  { email }
// Spec §5 sequence: same auth_tokens mechanism, purpose=password_reset.
// ------------------------------------------------------------------
auth.post("/password-reset/request", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ email: emailSchema }).safeParse(body);
  if (!parsed.success) return c.json({ error: "Valid email required" }, 400);

  const email = parsed.data.email;

  const limit = parseInt(c.env.RATE_LIMIT_MAGIC_LINK_PER_HOUR, 10) || 3;
  const allowed = await checkRateLimit(c.env, `password_reset:${email}`, limit);
  if (!allowed) return c.json({ error: "Too many requests. Try again later." }, 429);

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email)
    .first<User>();

  // Always 200 — don't reveal whether the email is registered.
  if (user) {
    const tokenId = randomToken(32);
    const ttlMin = parseInt(c.env.MAGIC_LINK_TTL_MIN, 10) || 15;
    const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000).toISOString();

    await c.env.DB.prepare(
      `INSERT INTO auth_tokens (id, user_id, purpose, expires_at) VALUES (?, ?, 'password_reset', ?)`
    )
      .bind(tokenId, user.id, expiresAt)
      .run();

    // Points at a frontend page (not this Worker) that collects the new
    // password and POSTs it to /password-reset/confirm — per spec §5.
    const link = `${c.env.APP_ORIGIN}/reset-password.html?token=${tokenId}`;
    await sendPasswordResetEmail(c.env, email, link);
  }

  return c.json({ ok: true });
});

// ------------------------------------------------------------------
// POST /api/auth/password-reset/confirm  { token, password }
// ------------------------------------------------------------------
auth.post("/password-reset/confirm", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({ token: z.string().min(1), password: passwordSchema })
    .safeParse(body);
  if (!parsed.success) return c.json({ error: "Token and a password (min 8 chars) required" }, 400);

  const { token, password } = parsed.data;
  const row = await c.env.DB.prepare(
    `SELECT * FROM auth_tokens WHERE id = ? AND purpose = 'password_reset'`
  )
    .bind(token)
    .first<{ id: string; user_id: number; expires_at: string; used: number }>();

  if (!row || row.used || new Date(row.expires_at).getTime() < Date.now()) {
    return c.json({ error: "Invalid or expired token" }, 400);
  }

  const passwordHash = await hashPassword(password, pbkdf2Iterations(c.env));

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(
      passwordHash,
      row.user_id
    ),
    c.env.DB.prepare(`UPDATE auth_tokens SET used = 1 WHERE id = ?`).bind(token),
    // Invalidate any other outstanding reset tokens for this user.
    c.env.DB.prepare(
      `UPDATE auth_tokens SET used = 1 WHERE user_id = ? AND purpose = 'password_reset' AND used = 0`
    ).bind(row.user_id),
    // Completing a reset proves control of the inbox — treat it as an
    // implicit email verification too.
    c.env.DB.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).bind(row.user_id),
  ]);

  return c.json({ ok: true });
});

// ------------------------------------------------------------------
// POST /api/auth/set-password  { currentPassword?, newPassword }
// Authenticated route for adding/changing a password without a token —
// spec: "user can set one, but never required".
// ------------------------------------------------------------------
auth.post("/set-password", requireAuth, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({ currentPassword: z.string().optional(), newPassword: passwordSchema })
    .safeParse(body);
  if (!parsed.success) return c.json({ error: "A new password (min 8 chars) is required" }, 400);

  const { currentPassword, newPassword } = parsed.data;

  if (user.password_hash) {
    if (!currentPassword || !(await verifyPassword(currentPassword, user.password_hash))) {
      return c.json({ error: "Current password is incorrect" }, 401);
    }
  }

  const passwordHash = await hashPassword(newPassword, pbkdf2Iterations(c.env));
  await c.env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
    .bind(passwordHash, user.id)
    .run();

  return c.json({ ok: true });
});

// ------------------------------------------------------------------
// POST /api/auth/logout
// ------------------------------------------------------------------
auth.post("/logout", async (c) => {
  const sessionId = await readSessionIdFromCookie(c.env, c.req.header("Cookie") ?? null);
  if (sessionId) await destroySession(c.env, sessionId);
  c.header("Set-Cookie", buildClearCookie(c.env));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------
// GET /api/auth/me
// ------------------------------------------------------------------
auth.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ user: null });
  const { password_hash, ...safe } = user;
  return c.json({ user: safe });
});

export default auth;
