export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;

  APP_ORIGIN: string;
  SESSION_COOKIE_NAME: string;
  SESSION_TTL_DAYS: string;
  MAGIC_LINK_TTL_MIN: string;
  RATE_LIMIT_MAGIC_LINK_PER_HOUR: string;
  PBKDF2_ITERATIONS: string;

  SESSION_HMAC_SECRET: string;
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL: string;
  FINNHUB_API_KEY: string;
  TWELVEDATA_API_KEY: string;
}

export type Role = "user" | "moderator" | "admin";

export interface User {
  id: number;
  email: string;
  email_verified: number;
  password_hash: string | null;
  display_name: string;
  created_at: string;
  role: Role;
  frozen: number;
}

export interface Variables {
  user: User | null;
}

export type AppEnv = { Bindings: Env; Variables: Variables };

export type OutageStatus = "draft" | "pending_review" | "published" | "rejected";
export type Severity = "P3 Low" | "P2 Medium" | "P1 High";
// Real-world incident status (independent of OutageStatus, which is the
// moderation workflow state) — standard status-page vocabulary.
export type CurrentStatus = "investigating" | "identified" | "monitoring" | "resolved";

export interface Outage {
  id: number;
  author_id: number;
  title: string;
  description: string;
  category: string;
  tags: string | null;
  country: string;
  city: string | null;
  start_time: string;
  end_time: string | null;
  severity: Severity;
  source_url: string | null;
  status: OutageStatus;
  rejection_reason: string | null;
  created_at: string;
  entity: string;
  stock_code: string | null;
  current_status: CurrentStatus;
}

export interface Artifact {
  id: number;
  outage_id: number;
  r2_key: string;
  type: string;
  size_bytes: number;
  is_primary: number;
  caption: string | null;
}

export interface StockQuote {
  code: string;
  price: number;
  change: number;
  percent_change: number;
  fetched_at: string;
}

export type CommentStatus = "live" | "removed";

export interface Comment {
  id: number;
  outage_id: number;
  author_id: number;
  body: string;
  created_at: string;
  status: CommentStatus;
}
