-- Migration: 0009_outage_fields.sql
-- TheOutage — add entity/stock_code/current_status to outages.
-- Apply with: wrangler d1 execute theoutage-db --remote --file=migrations/0009_outage_fields.sql
-- (do NOT use `wrangler d1 migrations apply` — see CLAUDE.md gotcha #1)
--
-- All three are plain ADD COLUMN — no table rebuild needed. `entity` is
-- NOT NULL with a placeholder default so existing rows stay valid; the Zod
-- schema requires a real value on every new create/update, so the default
-- is effectively never used going forward.

ALTER TABLE outages ADD COLUMN entity TEXT NOT NULL DEFAULT 'Unknown';
ALTER TABLE outages ADD COLUMN stock_code TEXT;
ALTER TABLE outages ADD COLUMN current_status TEXT NOT NULL DEFAULT 'investigating'
  CHECK (current_status IN ('investigating', 'identified', 'monitoring', 'resolved'));
