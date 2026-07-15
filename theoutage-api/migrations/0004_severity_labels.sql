-- Migration: 0004_severity_labels.sql
-- TheOutage — expand severity values from P3/P2/P1 to P3 Low/P2 Medium/P1 High
-- SQLite can't ALTER a CHECK constraint in place, so this rebuilds the
-- outages table (12-step "ALTER TABLE" procedure) and remaps existing data.
-- Apply with: wrangler d1 execute theoutage-db --remote --file=migrations/0004_severity_labels.sql
-- (do NOT use `wrangler d1 migrations apply` — see CLAUDE.md gotcha #1)
--
-- IMPORTANT: PRAGMA foreign_keys=OFF must be in the SAME statement batch/
-- connection as the DROP TABLE below, or SQLite's implicit cascading DELETE
-- (fired by DROP TABLE on a table with ON DELETE CASCADE children when FK
-- enforcement is on) will wipe rows in `artifacts` and `comments`. This bit
-- us during the 0003 migration — see CLAUDE.md gotcha #7.

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE outages_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN (
                       'power', 'internet', 'cloud', 'transport', 'water',
                       'telecom', 'financial', 'healthcare', 'government', 'other'
                     )),
  tags              TEXT,
  country           TEXT NOT NULL CHECK (length(country) = 2),
  city              TEXT,
  start_time        TEXT NOT NULL,
  end_time          TEXT,
  severity          TEXT NOT NULL CHECK (severity IN ('P3 Low', 'P2 Medium', 'P1 High')),
  source_url        TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                       'draft', 'pending_review', 'published', 'rejected'
                     )),
  rejection_reason  TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO outages_new
SELECT
  id, author_id, title, description, category, tags, country, city,
  start_time, end_time,
  CASE severity
    WHEN 'P3' THEN 'P3 Low'
    WHEN 'P2' THEN 'P2 Medium'
    WHEN 'P1' THEN 'P1 High'
    ELSE severity
  END,
  source_url, status, rejection_reason, created_at
FROM outages;

DROP TABLE outages;

ALTER TABLE outages_new RENAME TO outages;

CREATE INDEX idx_outages_author_id ON outages(author_id);
CREATE INDEX idx_outages_status ON outages(status);
CREATE INDEX idx_outages_category ON outages(category);
CREATE INDEX idx_outages_country ON outages(country);
CREATE INDEX idx_outages_severity ON outages(severity);
CREATE INDEX idx_outages_start_time ON outages(start_time);

-- DROP TABLE outages also drops its triggers; recreate the FTS5 sync triggers.
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

COMMIT;

PRAGMA foreign_keys = ON;
