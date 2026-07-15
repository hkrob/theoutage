import type { Context, Next } from "hono";
import type { AppEnv, Role } from "../types";
import { readSessionIdFromCookie, getUserForSession } from "../lib/session";

/** Runs on every request: attaches the current user (or null) to context. */
export async function attachUser(c: Context<AppEnv>, next: Next) {
  const sessionId = await readSessionIdFromCookie(c.env, c.req.header("Cookie") ?? null);
  const user = sessionId ? await getUserForSession(c.env, sessionId) : null;
  c.set("user", user);
  await next();
}

/** Route guard: 401s if there's no authenticated user. */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);
  await next();
}

/**
 * Route guard: 403s unless the user's email is verified. Spec: "Email
 * verification: required before a user can post" — applies to outage
 * submissions and comments. Must run after requireAuth (or another check
 * that guarantees a user is set).
 */
export async function requireVerifiedEmail(c: Context<AppEnv>, next: Next) {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);
  if (!user.email_verified) {
    return c.json({ error: "Verify your email before posting. Check your inbox for a magic link." }, 403);
  }
  await next();
}

/** Route guard: 401/403s unless the user has one of the given roles. */
export function requireRole(...roles: Role[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);
    if (!roles.includes(user.role)) return c.json({ error: "Forbidden" }, 403);
    await next();
  };
}
