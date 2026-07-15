import type { Env } from "../types";

/**
 * Fixed-window rate limiter backed by the `rate_limits` D1 table
 * (see migrations/0002_rate_limits.sql). Buckets by the hour, keyed by
 * an arbitrary string (e.g. "magic_link:someone@example.com").
 *
 * Returns true if this call is within the limit (and records it),
 * false if the limit was already reached for this window.
 */
export async function checkRateLimit(env: Env, key: string, limit: number): Promise<boolean> {
  const windowStart = new Date();
  windowStart.setUTCMinutes(0, 0, 0);
  const windowStartIso = windowStart.toISOString();

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`
  )
    .bind(key, windowStartIso)
    .first<{ count: number }>();

  return (row?.count ?? 0) <= limit;
}
