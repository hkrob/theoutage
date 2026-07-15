-- Migration: 0005_admin_users.sql
-- TheOutage — admin user management: account freeze flag + wider
-- moderation_log action/target_type so admin actions are auditable too.
-- Apply with: wrangler d1 execute theoutage-db --remote --file=migrations/0005_admin_users.sql
-- (do NOT use `wrangler d1 migrations apply` — see CLAUDE.md gotcha #1)

-- users.frozen: plain ADD COLUMN, no rebuild needed (default satisfies the
-- CHECK for existing rows).
ALTER TABLE users ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0 CHECK (frozen IN (0, 1));

-- moderation_log: widen the action/target_type CHECK constraints. SQLite
-- can't ALTER a CHECK constraint in place, so this rebuilds the table —
-- safe here because nothing has a foreign key pointing AT moderation_log
-- (target_id is polymorphic, enforced at the app layer; moderation_log's
-- own moderator_id FK points outward at users, so dropping this table
-- doesn't cascade into anything).
CREATE TABLE moderation_log_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  moderator_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action         TEXT NOT NULL CHECK (action IN (
                    'approve_outage', 'reject_outage', 'remove_comment',
                    'change_role', 'freeze_user', 'unfreeze_user', 'reset_user_access'
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

-- Grant the initial admin.
UPDATE users SET role = 'admin' WHERE email = 'robertlempriere@gmail.com';
