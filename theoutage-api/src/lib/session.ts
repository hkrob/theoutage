import type { Env, User } from "../types";
import { randomToken, hmacSign, hmacVerify } from "./crypto";

// SameSite=Lax assumes the API is mounted on the same site as the Pages
// frontend (see wrangler.toml note). Switch to SameSite=None; Secure if the
// API ever moves to a separate subdomain.
const COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Lax; Path=/";

export async function createSession(env: Env, userId: number): Promise<string> {
  const sessionId = randomToken(32);
  const ttlDays = parseInt(env.SESSION_TTL_DAYS, 10) || 30;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(sessionId, userId, expiresAt)
    .run();

  return sessionId;
}

export async function destroySession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
}

export async function getUserForSession(env: Env, sessionId: string): Promise<User | null> {
  // Frozen users fall out of this query (not deleted) so a session created
  // before a freeze stops authenticating immediately, and unfreezing later
  // restores it automatically without recreating anything.
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AND u.frozen = 0`
  )
    .bind(sessionId)
    .first<User>();

  return row ?? null;
}

export async function buildSessionCookie(env: Env, sessionId: string): Promise<string> {
  const sig = await hmacSign(sessionId, env.SESSION_HMAC_SECRET);
  const value = `${sessionId}.${sig}`;
  const ttlDays = parseInt(env.SESSION_TTL_DAYS, 10) || 30;
  return `${env.SESSION_COOKIE_NAME}=${value}; Max-Age=${ttlDays * 86400}; ${COOKIE_ATTRS}`;
}

export function buildClearCookie(env: Env): string {
  return `${env.SESSION_COOKIE_NAME}=; Max-Age=0; ${COOKIE_ATTRS}`;
}

export async function readSessionIdFromCookie(
  env: Env,
  cookieHeader: string | null
): Promise<string | null> {
  if (!cookieHeader) return null;

  const prefix = `${env.SESSION_COOKIE_NAME}=`;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(prefix));
  if (!match) return null;

  const raw = match.slice(prefix.length);
  const dot = raw.lastIndexOf(".");
  if (dot === -1) return null;

  const sessionId = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const valid = await hmacVerify(sessionId, sig, env.SESSION_HMAC_SECRET);
  return valid ? sessionId : null;
}
