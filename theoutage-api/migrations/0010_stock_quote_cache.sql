-- Migration: 0010_stock_quote_cache.sql
-- TheOutage — cache table for GET /api/stock-quote/:code (Finnhub-backed).
-- Apply with: wrangler d1 execute theoutage-db --remote --file=migrations/0010_stock_quote_cache.sql
-- (do NOT use `wrangler d1 migrations apply` — see CLAUDE.md gotcha #1)

CREATE TABLE stock_quote_cache (
  code            TEXT PRIMARY KEY,           -- ticker, uppercased
  price           REAL NOT NULL,
  change          REAL NOT NULL,
  percent_change  REAL NOT NULL,
  fetched_at      TEXT NOT NULL
);
