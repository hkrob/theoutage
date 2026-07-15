-- Migration: 0001_init.sql
-- TheOutage — initial schema
-- Source: TheOutage-spec.md §2 (Data Model), §5 (Auth), §9 (Moderation), §12 (Search)
-- Target: Cloudflare D1 (SQLite)

PRAGMA foreign_keys = ON;

-- ============================================================
-- users
-- ============================================================
CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  password_hash   TEXT,                                    -- nullable: password is optional, magic link always available
  display_name    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin'))
);

CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- sessions
-- ============================================================
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,                            -- random token, app-generated; stored in signed cookie
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- ============================================================
-- auth_tokens (magic link / password reset / email verify — one-time use)
-- ============================================================
CREATE TABLE auth_tokens (
  id          TEXT PRIMARY KEY,                            -- random token, app-generated
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('magic_link', 'password_reset', 'email_verify')),
  expires_at  TEXT NOT NULL,                                -- short TTL, e.g. 15 min
  used        INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1))
);

CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX idx_auth_tokens_purpose ON auth_tokens(purpose);

-- ============================================================
-- outages
-- ============================================================
CREATE TABLE outages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN (
                       'power', 'internet', 'cloud', 'transport', 'water',
                       'telecom', 'financial', 'healthcare', 'government', 'other'
                     )),
  tags              TEXT,                                   -- nullable, comma-separated free text
  country           TEXT NOT NULL CHECK (length(country) = 2),  -- ISO 3166-1 alpha-2, validated against dropdown at app layer
  city              TEXT,
  start_time        TEXT NOT NULL,
  end_time          TEXT,                                   -- nullable: ongoing outages
  severity          TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  source_url        TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                       'draft', 'pending_review', 'published', 'rejected'
                     )),
  rejection_reason  TEXT,                                   -- nullable; set on reject, cleared on resubmit
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_outages_author_id ON outages(author_id);
CREATE INDEX idx_outages_status ON outages(status);
CREATE INDEX idx_outages_category ON outages(category);
CREATE INDEX idx_outages_country ON outages(country);
CREATE INDEX idx_outages_severity ON outages(severity);
CREATE INDEX idx_outages_start_time ON outages(start_time);

-- ============================================================
-- artifacts (metadata only; binary content lives in R2)
-- ============================================================
CREATE TABLE artifacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  outage_id    INTEGER NOT NULL REFERENCES outages(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL,
  type         TEXT NOT NULL,                               -- MIME type
  size_bytes   INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760), -- 10MB/file cap (per-outage 50MB cap enforced at app layer)
  is_primary   INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  caption      TEXT
);

CREATE INDEX idx_artifacts_outage_id ON artifacts(outage_id);
CREATE UNIQUE INDEX idx_artifacts_r2_key ON artifacts(r2_key);

-- ============================================================
-- comments
-- ============================================================
CREATE TABLE comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  outage_id   INTEGER NOT NULL REFERENCES outages(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status      TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'removed'))
);

CREATE INDEX idx_comments_outage_id ON comments(outage_id);
CREATE INDEX idx_comments_author_id ON comments(author_id);
CREATE INDEX idx_comments_status ON comments(status);

-- ============================================================
-- moderation_log
-- ============================================================
CREATE TABLE moderation_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  moderator_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action         TEXT NOT NULL CHECK (action IN ('approve_outage', 'reject_outage', 'remove_comment')),
  target_type    TEXT NOT NULL CHECK (target_type IN ('outage', 'comment')),
  target_id      INTEGER NOT NULL,                          -- polymorphic (outage.id or comment.id) — no FK, enforced at app layer
  reason         TEXT,                                       -- shown to author (outage reject) or commenter (comment removal)
  internal_note  TEXT,                                       -- nullable, moderator-only, used for comment removals
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_moderation_log_moderator_id ON moderation_log(moderator_id);
CREATE INDEX idx_moderation_log_target ON moderation_log(target_type, target_id);

-- ============================================================
-- outages_fts — FTS5 external-content table synced to outages(title, description)
-- ============================================================
CREATE VIRTUAL TABLE outages_fts USING fts5(
  title,
  description,
  content = 'outages',
  content_rowid = 'id'
);

-- Sync triggers (standard FTS5 external-content pattern)
CREATE TRIGGER outages_ai AFTER INSERT ON outages BEGIN
  INSERT INTO outages_fts(rowid, title, description)
  VALUES (new.id, new.title, new.description);
END;

CREATE TRIGGER outages_ad AFTER DELETE ON outages BEGIN
  INSERT INTO outages_fts(outages_fts, rowid, title, description)
  VALUES ('delete', old.id, old.title, old.description);
END;

CREATE TRIGGER outages_au AFTER UPDATE ON outages BEGIN
  INSERT INTO outages_fts(outages_fts, rowid, title, description)
  VALUES ('delete', old.id, old.title, old.description);
  INSERT INTO outages_fts(rowid, title, description)
  VALUES (new.id, new.title, new.description);
END;
