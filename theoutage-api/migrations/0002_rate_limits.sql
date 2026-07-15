-- Migration: 0002_rate_limits.sql
-- Backing store for auth rate limiting (fixed hourly window per key),
-- e.g. "magic_link:someone@example.com" capped at 3/hour per spec §5.
-- Judgment call: spec left rate limiting as "D1 table OR Cloudflare's
-- built-in rate limiting rules" — went with a D1 table since it's portable,
-- testable locally, and doesn't depend on dashboard-level config.

CREATE TABLE rate_limits (
  key           TEXT NOT NULL,
  window_start  TEXT NOT NULL,   -- ISO8601 start of the hour bucket
  count         INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX idx_rate_limits_window_start ON rate_limits(window_start);
