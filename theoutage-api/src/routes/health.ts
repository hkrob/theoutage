import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth, requireRole } from "../middleware/auth";

const health = new Hono<AppEnv>();

// Admin only — this is an operational diagnostic surface, not something
// regular users need, and it makes live calls to every third-party
// dependency on each load (see below).
health.use("*", requireAuth, requireRole("admin"));

type CheckStatus = "ok" | "degraded" | "down" | "not_configured";

interface CheckResult {
  name: string;
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
}

async function timed(name: string, fn: () => Promise<Omit<CheckResult, "name" | "latencyMs">>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return { name, latencyMs: Date.now() - start, ...result };
  } catch (err) {
    return { name, status: "down", latencyMs: Date.now() - start, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ------------------------------------------------------------------
// GET /api/admin/health — live checks, no caching. This exists specifically
// to answer "is something broken right now" during an incident, so a stale
// cached "ok" would defeat the point. Each dependency is isolated (one
// failing/timing out doesn't block the others) and this is a genuinely
// admin-only, low-traffic page, so hitting every provider's quota on each
// load is an acceptable tradeoff for live-truth here.
// ------------------------------------------------------------------
health.get("/", async (c) => {
  const checks = await Promise.all([
    timed("D1 database", async () => {
      await c.env.DB.prepare("SELECT 1").first();
      return { status: "ok" as const };
    }),

    timed("R2 artifacts", async () => {
      await c.env.ARTIFACTS.list({ limit: 1 });
      return { status: "ok" as const };
    }),

    timed("Finnhub", async () => {
      if (!c.env.FINNHUB_API_KEY) return { status: "not_configured" as const };
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${c.env.FINNHUB_API_KEY}`);
      if (res.ok) return { status: "ok" as const };
      return { status: "degraded" as const, detail: `HTTP ${res.status}` };
    }),

    timed("Twelve Data", async () => {
      if (!c.env.TWELVEDATA_API_KEY) return { status: "not_configured" as const };
      const res = await fetch(`https://api.twelvedata.com/quote?symbol=AAPL&apikey=${c.env.TWELVEDATA_API_KEY}`);
      if (res.ok) return { status: "ok" as const };
      return { status: "degraded" as const, detail: `HTTP ${res.status}` };
    }),

    timed("Resend (email)", async () => {
      if (!c.env.RESEND_API_KEY) return { status: "not_configured" as const };
      // Read-only — lists domains, doesn't send anything.
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` },
      });
      if (res.ok) return { status: "ok" as const };
      return { status: "degraded" as const, detail: `HTTP ${res.status}` };
    }),
  ]);

  const overall: CheckStatus = checks.some((ch) => ch.status === "down")
    ? "down"
    : checks.some((ch) => ch.status === "degraded")
      ? "degraded"
      : "ok";

  return c.json({ overall, checks, checkedAt: new Date().toISOString() });
});

export default health;
