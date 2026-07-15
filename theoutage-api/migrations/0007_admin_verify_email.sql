-- Migration: 0007_admin_verify_email.sql
-- TheOutage — widen moderation_log.action to include 'verify_email', for
-- admins manually verifying an account's email from the admin page.
-- Apply with: wrangler d1 execute theoutage-db --remote --file=migrations/0007_admin_verify_email.sql
-- (do NOT use `wrangler d1 migrations apply` — see CLAUDE.md gotcha #1)
--
-- Safe rebuild: nothing has a foreign key pointing AT moderation_log (see
-- migration 0005's comment for the full explanation).

CREATE TABLE moderation_log_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  moderator_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action         TEXT NOT NULL CHECK (action IN (
                    'approve_outage', 'reject_outage', 'remove_comment',
                    'change_role', 'freeze_user', 'unfreeze_user', 'reset_user_access',
                    'create_user', 'verify_email'
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
