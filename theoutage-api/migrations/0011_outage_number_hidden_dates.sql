-- Migration: 0011_outage_number_hidden_dates.sql
-- TheOutage — reference numbers, admin hide function, date-only start/end.
-- Apply with: wrangler d1 execute theoutage-db --remote --file=migrations/0011_outage_number_hidden_dates.sql
-- (do NOT use `wrangler d1 migrations apply` — see CLAUDE.md gotcha #1)
--
-- outages has incoming FK children (artifacts.outage_id, comments.outage_id,
-- both ON DELETE CASCADE) — a full table rebuild here would hit the same
-- D1-ignores-PRAGMA-foreign_keys cascade-delete risk documented for
-- migrations 0003/0004. Plain ADD COLUMNs only; no rebuild of `outages`.

-- 1. hidden: admin "remove from public view without deleting" flag.
ALTER TABLE outages ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1));

-- 2. outage_number: human-readable reference, YYYYMMDD + 4-digit daily
-- sequence (e.g. 202607160001). Nullable at the schema level — SQLite
-- can't add a NOT NULL column without a shared default, which would
-- collide with UNIQUE across more than one existing row. The app always
-- sets it on every INSERT (see generateOutageNumber in routes/outages.ts),
-- so this is enforced in practice without needing the risky rebuild above.
ALTER TABLE outages ADD COLUMN outage_number TEXT;

-- Backfill existing rows: per-date sequence ordered by id, matching the
-- app's own generation logic.
UPDATE outages
SET outage_number = strftime('%Y%m%d', created_at) || printf('%04d',
  (SELECT COUNT(*) FROM outages o2 WHERE date(o2.created_at) = date(outages.created_at) AND o2.id <= outages.id)
);

CREATE UNIQUE INDEX idx_outages_outage_number ON outages(outage_number);

-- 3. start_time/end_time: normalize existing full-datetime values down to
-- date-only (YYYY-MM-DD), matching the new date-only submission format.
UPDATE outages SET start_time = date(start_time) WHERE start_time IS NOT NULL;
UPDATE outages SET end_time = date(end_time) WHERE end_time IS NOT NULL;

-- 4. moderation_log: widen action CHECK for the new outage-moderation
-- actions (hide/unhide/delete). Safe rebuild — no incoming FKs (see
-- migration 0005's comment for the full explanation; unlike `outages`
-- above, nothing references moderation_log.id).
CREATE TABLE moderation_log_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  moderator_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action         TEXT NOT NULL CHECK (action IN (
                    'approve_outage', 'reject_outage', 'remove_comment',
                    'change_role', 'freeze_user', 'unfreeze_user', 'reset_user_access',
                    'create_user', 'verify_email', 'delete_user',
                    'hide_outage', 'unhide_outage', 'delete_outage'
                  )),
  target_type    TEXT NOT NULL CHECK (target_type IN ('outage', 'comment', 'user')),
  target_id      INTEGER NOT NULL,
  reason         TEXT,
  internal_note  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO moderation_log_new SELECT * FROM moderation_log;

DROP TABLE moderation_log;

ALTER TABLE moderation_log_new RENAME TO moderation_log;

CREATE INDEX idx_moderation_log_moderator_id ON moderation_log(moderator_id);
CREATE INDEX idx_moderation_log_target ON moderation_log(target_type, target_id);
