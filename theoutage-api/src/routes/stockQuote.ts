import { Hono } from "hono";
import type { AppEnv, StockQuote } from "../types";

const stockQuote = new Hono<AppEnv>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — plenty fresh for a public record page.

interface QuoteResult {
  price: number;
  change: number;
  percentChange: number;
}

interface FinnhubQuote {
  c: number; // current price
  d: number | null; // change — null (not 0) for a symbol Finnhub has never heard of
  dp: number | null; // percent change — same null-vs-0 distinction as d
}

// Finnhub's free tier only covers US-listed exchanges — a 403 ("no access")
// or an unrecognized-symbol response both mean "try the next provider," not
// "something's broken," so this returns null rather than throwing for
// either case. A thrown error means a genuine transient problem (network,
// unexpected shape) worth logging.
//
// Finnhub's "no data" shape isn't consistent: a symbol it's genuinely never
// heard of returns c:0 with d/dp as `null`; other no-access cases can come
// back all-zero. Require real finite numbers for all three fields, not just
// a zero-check, or nulls silently reach the DB write below (whose columns
// are NOT NULL) and throw an uncaught exception past this function's catch.
async function fetchFromFinnhub(code: string, apiKey: string): Promise<QuoteResult | null> {
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(code)}&token=${apiKey}`);
  if (!res.ok) {
    console.error(`[stock-quote] Finnhub ${res.status} for ${code}: ${await res.text().catch(() => "")}`);
    return null;
  }
  const data = (await res.json()) as FinnhubQuote;
  if (!data.c || !Number.isFinite(data.d) || !Number.isFinite(data.dp)) return null;
  return { price: data.c, change: data.d as number, percentChange: data.dp as number };
}

interface TwelveDataQuote {
  status?: string; // "error" on failure
  close?: string;
  previous_close?: string;
  percent_change?: string;
}

// Twelve Data's free tier covers international exchanges Finnhub's doesn't
// (e.g. ASX) — the fallback for tickers Finnhub can't price. Numeric fields
// come back as strings; a missing/unparseable `close` means "try nothing
// else," same null-on-no-data contract as fetchFromFinnhub above.
async function fetchFromTwelveData(code: string, apiKey: string): Promise<QuoteResult | null> {
  const res = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(code)}&apikey=${apiKey}`);
  if (!res.ok) {
    console.error(`[stock-quote] Twelve Data ${res.status} for ${code}: ${await res.text().catch(() => "")}`);
    return null;
  }
  const data = (await res.json()) as TwelveDataQuote;
  if (data.status === "error") return null;

  const price = parseFloat(data.close ?? "");
  const previousClose = parseFloat(data.previous_close ?? "");
  const percentChange = parseFloat(data.percent_change ?? "");
  if (Number.isNaN(price) || Number.isNaN(percentChange)) return null;

  return { price, change: Number.isNaN(previousClose) ? 0 : price - previousClose, percentChange };
}

// ------------------------------------------------------------------
// GET /api/stock-quote/:code — public, cached per-ticker in D1 so a page
// full of viewers doesn't multiply into that many upstream provider calls.
// Tries Finnhub first, falls back to Twelve Data (mainly for non-US
// tickers Finnhub's free tier can't price).
// ------------------------------------------------------------------
stockQuote.get("/:code", async (c) => {
  const code = (c.req.param("code") ?? "").trim().toUpperCase();
  if (!code || code.length > 20) return c.json({ error: "Invalid ticker code" }, 400);

  const cached = await c.env.DB.prepare(`SELECT * FROM stock_quote_cache WHERE code = ?`)
    .bind(code)
    .first<StockQuote>();

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
    return c.json({ quote: cached });
  }

  if (!c.env.FINNHUB_API_KEY && !c.env.TWELVEDATA_API_KEY) {
    if (cached) return c.json({ quote: cached, stale: true });
    return c.json({ error: "Stock price lookups aren't configured yet." }, 503);
  }

  let result: QuoteResult | null = null;
  try {
    if (c.env.FINNHUB_API_KEY) {
      result = await fetchFromFinnhub(code, c.env.FINNHUB_API_KEY);
    }
    if (!result && c.env.TWELVEDATA_API_KEY) {
      result = await fetchFromTwelveData(code, c.env.TWELVEDATA_API_KEY);
    }
  } catch (err) {
    // 503, not 502 — Cloudflare's edge intercepts 502 responses from any
    // origin (including Workers) and replaces the body with its own
    // generic error page, which would silently swallow this JSON.
    console.error("[stock-quote] provider fetch failed:", err);
    if (cached) return c.json({ quote: cached, stale: true });
    return c.json({ error: "Couldn't fetch a price right now." }, 503);
  }

  // Belt-and-braces: whichever provider answered, refuse to cache/return
  // anything that isn't three real finite numbers — the cache columns are
  // NOT NULL, so a stray null/NaN here would otherwise throw uncaught.
  if (
    !result ||
    !Number.isFinite(result.price) ||
    !Number.isFinite(result.change) ||
    !Number.isFinite(result.percentChange)
  ) {
    if (cached) return c.json({ quote: cached, stale: true });
    return c.json({ error: "Unknown ticker" }, 404);
  }

  const fetchedAt = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO stock_quote_cache (code, price, change, percent_change, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET price = ?, change = ?, percent_change = ?, fetched_at = ?`
  )
    .bind(code, result.price, result.change, result.percentChange, fetchedAt, result.price, result.change, result.percentChange, fetchedAt)
    .run();

  return c.json({
    quote: { code, price: result.price, change: result.change, percent_change: result.percentChange, fetched_at: fetchedAt },
  });
});

export default stockQuote;
