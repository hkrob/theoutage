// Keep these in sync with the CHECK constraints in migrations/0001_init.sql.
// (No single source of truth across SQL + TS in D1/Workers — if you add a
// category or severity, update both places.)

export const CATEGORIES = [
  "power",
  "internet",
  "cloud",
  "transport",
  "water",
  "telecom",
  "financial",
  "healthcare",
  "government",
  "other",
] as const;

export const SEVERITIES = ["P3", "P2", "P1"] as const;

export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024; // 10MB/file
export const MAX_OUTAGE_ARTIFACT_TOTAL_BYTES = 50 * 1024 * 1024; // 50MB/outage

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
