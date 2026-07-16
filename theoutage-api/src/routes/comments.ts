import type { Handler } from "hono";
import { z } from "zod";
import type { AppEnv, Comment, Outage } from "../types";
import { canViewOutage } from "../lib/outageAccess";
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../lib/constants";

const bodySchema = z.object({ body: z.string().trim().min(1).max(5000) });

// GET /api/outages/:id/comments — live comments only, oldest first (thread order)
export const getComments: Handler<AppEnv> = async (c) => {
  const outageId = parseInt(c.req.param("id") ?? "", 10);
  if (!outageId) return c.json({ error: "Invalid outage id" }, 400);

  const outage = await c.env.DB.prepare(`SELECT id, author_id, status, hidden FROM outages WHERE id = ?`)
    .bind(outageId)
    .first<Pick<Outage, "id" | "author_id" | "status" | "hidden">>();

  if (!outage || !canViewOutage(c.get("user"), outage)) {
    return c.json({ error: "Not found" }, 404);
  }

  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(c.req.query("pageSize") ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT)
  );
  const offset = (page - 1) * pageSize;

  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, c.author_id, u.display_name AS author_display_name
     FROM comments c
     JOIN users u ON u.id = c.author_id
     WHERE c.outage_id = ? AND c.status = 'live'
     ORDER BY c.created_at ASC
     LIMIT ? OFFSET ?`
  )
    .bind(outageId, pageSize, offset)
    .all();

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM comments WHERE outage_id = ? AND status = 'live'`
  )
    .bind(outageId)
    .first<{ n: number }>();

  return c.json({ results, page, pageSize, total: total?.n ?? 0 });
};

// POST /api/outages/:id/comments  { body }
// Requires requireAuth + requireVerifiedEmail upstream (spec: login + verified
// email required to post). Comments only accepted on published outages —
// judgment call: no point commenting on a draft/pending/rejected record the
// public can't see yet.
export const createComment: Handler<AppEnv> = async (c) => {
  const outageId = parseInt(c.req.param("id") ?? "", 10);
  if (!outageId) return c.json({ error: "Invalid outage id" }, 400);

  const outage = await c.env.DB.prepare(`SELECT id, status, hidden FROM outages WHERE id = ?`)
    .bind(outageId)
    .first<Pick<Outage, "id" | "status" | "hidden">>();

  if (!outage) return c.json({ error: "Not found" }, 404);
  if (outage.status !== "published" || outage.hidden) {
    return c.json({ error: "Comments are only open on published outages" }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Comment body is required (max 5000 chars)" }, 400);

  const user = c.get("user")!;
  const comment = await c.env.DB.prepare(
    `INSERT INTO comments (outage_id, author_id, body, status) VALUES (?, ?, ?, 'live') RETURNING *`
  )
    .bind(outageId, user.id, parsed.data.body)
    .first<Comment>();

  return c.json({ comment }, 201);
};
