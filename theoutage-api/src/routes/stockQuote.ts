import { Hono } from "hono";
import type { AppEnv, StockQuote } from "../types";

const stockQuote = new Hono<AppEnv>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — plenty fresh for a public record page.

interface FinnhubQuote {
  c: number; // current price
  d: number; // change
  dp: number; // percent change
}

// ------------------------------------------------------------------
// GET /api/stock-quote/:code — public, cached per-ticker in D1 so a page
// full of viewers doesn't multiply into that many upstream Finnhub calls.
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

  if (!c.env.FINNHUB_API_KEY) {
    // Not configured yet — serve a stale cache if we have one rather than
    // nothing, otherwise there's genuinely no price to show.
    if (cached) return c.json({ quote: cached, stale: true });
    return c.json({ error: "Stock price lookups aren't configured yet." }, 503);
  }

  let data: FinnhubQuote;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(code)}&token=${c.env.FINNHUB_API_KEY}`
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Finnhub responded ${res.status}: ${body}`);
    }
    data = await res.json();
  } catch (err) {
    // 503, not 502 — Cloudflare's edge intercepts 502 responses from any
    // origin (including Workers) and replaces the body with its own
    // generic error page, which would silently swallow this JSON.
    console.error("[stock-quote] Finnhub fetch failed:", err);
    if (cached) return c.json({ quote: cached, stale: true });
    return c.json({ error: "Couldn't fetch a price right now." }, 503);
  }

  // Finnhub returns all-zero fields for an unknown/invalid symbol rather
  // than an error status, so that's the actual "not found" signal.
  if (data.c === 0 && data.d === 0 && data.dp === 0) {
    return c.json({ error: "Unknown ticker" }, 404);
  }

  const fetchedAt = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO stock_quote_cache (code, price, change, percent_change, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET price = ?, change = ?, percent_change = ?, fetched_at = ?`
  )
    .bind(code, data.c, data.d, data.dp, fetchedAt, data.c, data.d, data.dp, fetchedAt)
    .run();

  return c.json({
    quote: { code, price: data.c, change: data.d, percent_change: data.dp, fetched_at: fetchedAt },
  });
});

export default stockQuote;
