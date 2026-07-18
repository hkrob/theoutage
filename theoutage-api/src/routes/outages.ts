import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Artifact, Outage } from "../types";
import { CATEGORIES, SEVERITIES, CURRENT_STATUSES, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "../lib/constants";
import { buildFtsQuery } from "../lib/fts";
import { canEditOutage, canViewOutage, computeStatusOnEdit, isModerator } from "../lib/outageAccess";
import { requireAuth, requireRole, requireVerifiedEmail } from "../middleware/auth";
import { listArtifacts, uploadArtifact } from "./artifacts";
import { getComments, createComment } from "./comments";

const outages = new Hono<AppEnv>();

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(20000),
  category: z.enum(CATEGORIES),
  tags: z.string().trim().max(500).optional(),
  country: z
    .string()
    .trim()
    .length(2)
    .transform((s) => s.toUpperCase()),
  city: z.string().trim().max(200).optional(),
  // Date-only, no time-of-day — most reporters don't know the exact minute
  // an outage started, so the field only asks for what's reliably knowable.
  start_time: z.string().date(),
  end_time: z.union([z.string().date(), z.null()]).optional(),
  severity: z.enum(SEVERITIES),
  // http(s) only — Zod's .url() also accepts javascript:/data: schemes, which
  // would be a stored-XSS vector once rendered into the detail page's <a href>.
  source_url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), { message: "Source link must be an http(s) URL" })
    .optional(),
  entity: z.string().trim().min(1).max(200),
  stock_code: z.string().trim().max(20).optional(),
  current_status: z.enum(CURRENT_STATUSES).default("investigating"),
  action: z.enum(["draft", "submit"]).default("draft"),
});

// All fields optional for PATCH; `action` governs status transition.
const updateSchema = createSchema.partial().extend({
  action: z.enum(["save", "submit"]).default("save"),
});

// ------------------------------------------------------------------
// GET /api/outages — public feed + search/filters + moderator "pending" view
//   ?q=&category=&severity=&country=&date_from=&date_to=&status=&mine=1&author_id=&page=&pageSize=
// ------------------------------------------------------------------
outages.get("/", async (c) => {
  const user = c.get("user");
  const mine = c.req.query("mine") === "1";
  const authorIdParam = c.req.query("author_id");
  const statusParam = c.req.query("status");

  const where: string[] = [];
  const params: unknown[] = [];

  if (authorIdParam) {
    // Admin/moderator viewing a specific user's submissions (any status) —
    // e.g. from the admin page. Distinct from `mine`, which is scoped to
    // the caller's own id and doesn't require an elevated role.
    if (!isModerator(user)) return c.json({ error: "Forbidden" }, 403);
    const authorId = parseInt(authorIdParam, 10);
    if (!authorId) return c.json({ error: "Invalid author_id" }, 400);
    where.push("o.author_id = ?");
    params.push(authorId);
    if (statusParam) {
      where.push("o.status = ?");
      params.push(statusParam);
    }
  } else if (mine) {
    if (!user) return c.json({ error: "Authentication required" }, 401);
    where.push("o.author_id = ?");
    params.push(user.id);
    if (statusParam) {
      where.push("o.status = ?");
      params.push(statusParam);
    }
  } else {
    const status = statusParam ?? "published";
    if (status === "pending_review") {
      // Spec §9: pending filter is only visible/usable by moderators/admins.
      if (!isModerator(user)) return c.json({ error: "Forbidden" }, 403);
      where.push("o.status = 'pending_review'");
    } else if (status === "published") {
      where.push("o.status = 'published'");
      where.push("o.hidden = 0"); // admin-hidden outages stay off the public feed
    } else {
      return c.json({ error: "Invalid status filter" }, 400);
    }
  }

  const category = c.req.query("category");
  if (category) {
    if (!(CATEGORIES as readonly string[]).includes(category)) {
      return c.json({ error: "Invalid category" }, 400);
    }
    where.push("o.category = ?");
    params.push(category);
  }

  const severity = c.req.query("severity");
  if (severity) {
    if (!(SEVERITIES as readonly string[]).includes(severity)) {
      return c.json({ error: "Invalid severity" }, 400);
    }
    where.push("o.severity = ?");
    params.push(severity);
  }

  const country = c.req.query("country");
  if (country) {
    where.push("o.country = ?");
    params.push(country.toUpperCase());
  }

  const dateFrom = c.req.query("date_from");
  if (dateFrom) {
    where.push("o.start_time >= ?");
    params.push(dateFrom);
  }

  const dateTo = c.req.query("date_to");
  if (dateTo) {
    where.push("o.start_time <= ?");
    params.push(dateTo);
  }

  const q = c.req.query("q");
  const ftsMatch = q ? buildFtsQuery(q) : null;

  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(c.req.query("pageSize") ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT)
  );
  const offset = (page - 1) * pageSize;

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  // Sort newest-incident-first by start_time (judgment call — see project notes).
  // Note: outages_fts must NOT be aliased here — D1's SQLite build rejects
  // `MATCH` against an alias ("no such column") even though it's valid in
  // stock SQLite. Confirmed against the live database; use the bare table
  // name in both the join condition and the MATCH expression.
  const baseFrom = ftsMatch
    ? `FROM outages o JOIN outages_fts ON outages_fts.rowid = o.id AND outages_fts MATCH ?`
    : `FROM outages o`;
  const listParams = ftsMatch ? [ftsMatch, ...params] : params;

  // Spec §7: feed cards use the first/primary artifact as a thumbnail —
  // correlated subquery picks the primary artifact if one is flagged,
  // else falls back to the earliest-uploaded artifact for that outage.
  const { results } = await c.env.DB.prepare(
    `SELECT o.*,
       (SELECT a.id FROM artifacts a WHERE a.outage_id = o.id ORDER BY a.is_primary DESC, a.id ASC LIMIT 1)
         AS primary_artifact_id
     ${baseFrom} ${whereSql} ORDER BY o.start_time DESC LIMIT ? OFFSET ?`
  )
    .bind(...listParams, pageSize, offset)
    .all<Outage & { primary_artifact_id: number | null }>();

  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${baseFrom} ${whereSql}`)
    .bind(...listParams)
    .first<{ n: number }>();

  return c.json({ results, page, pageSize, total: totalRow?.n ?? 0 });
});

// ------------------------------------------------------------------
// GET /api/outages/:id
// ------------------------------------------------------------------
outages.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const outage = await c.env.DB.prepare(`SELECT * FROM outages WHERE id = ?`)
    .bind(id)
    .first<Outage>();

  if (!outage || !canViewOutage(c.get("user"), outage)) {
    return c.json({ error: "Not found" }, 404);
  }

  const { results: artifacts } = await c.env.DB.prepare(
    `SELECT * FROM artifacts WHERE outage_id = ? ORDER BY is_primary DESC, id ASC`
  )
    .bind(id)
    .all<Artifact>();

  return c.json({ outage, artifacts });
});

// Human-readable reference number: YYYYMMDD + a 4-digit sequence counting
// outages already numbered for that UTC date. Sequence is derived by
// counting existing rows rather than a dedicated counter table — simple,
// and this app's write volume makes the (very small) race window between
// the count and the insert a non-issue in practice.
async function generateOutageNumber(db: D1Database): Promise<string> {
  const now = new Date();
  const datePart = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
    now.getUTCDate()
  ).padStart(2, "0")}`;
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM outages WHERE outage_number LIKE ?`)
    .bind(`${datePart}%`)
    .first<{ n: number }>();
  const seq = String((countRow?.n ?? 0) + 1).padStart(4, "0");
  return `${datePart}${seq}`;
}

// ------------------------------------------------------------------
// POST /api/outages — create (draft or submit-for-review). A moderator/
// admin submitting goes straight to published — see computeStatusOnEdit
// in lib/outageAccess.ts for why the same rule applies on edit.
// ------------------------------------------------------------------
outages.post("/", requireAuth, requireVerifiedEmail, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid outage payload", details: parsed.error.flatten() }, 400);
  }

  const user = c.get("user")!;
  const d = parsed.data;
  const status = d.action === "submit" ? (isModerator(user) ? "published" : "pending_review") : "draft";
  const outageNumber = await generateOutageNumber(c.env.DB);

  const outage = await c.env.DB.prepare(
    `INSERT INTO outages
       (author_id, title, description, category, tags, country, city, start_time, end_time, severity, source_url, status, entity, stock_code, current_status, outage_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  )
    .bind(
      user.id,
      d.title,
      d.description,
      d.category,
      d.tags ?? null,
      d.country,
      d.city ?? null,
      d.start_time,
      d.end_time ?? null,
      d.severity,
      d.source_url ?? null,
      status,
      d.entity,
      d.stock_code ?? null,
      d.current_status,
      outageNumber
    )
    .first<Outage>();

  return c.json({ outage }, 201);
});

// ------------------------------------------------------------------
// PATCH /api/outages/:id — author-only edit; status transitions per
// computeStatusOnEdit (see lib/outageAccess.ts for the full rule set).
// ------------------------------------------------------------------
outages.patch("/:id", requireAuth, async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const existing = await c.env.DB.prepare(`SELECT * FROM outages WHERE id = ?`)
    .bind(id)
    .first<Outage>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const user = c.get("user");
  if (!canEditOutage(user, existing)) return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid outage payload", details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;

  const { status, clearRejectionReason } = computeStatusOnEdit(existing.status, d.action, isModerator(user));

  const updated = await c.env.DB.prepare(
    `UPDATE outages SET
       title = ?, description = ?, category = ?, tags = ?, country = ?, city = ?,
       start_time = ?, end_time = ?, severity = ?, source_url = ?,
       status = ?, rejection_reason = ?, entity = ?, stock_code = ?, current_status = ?
     WHERE id = ?
     RETURNING *`
  )
    .bind(
      d.title ?? existing.title,
      d.description ?? existing.description,
      d.category ?? existing.category,
      d.tags ?? existing.tags,
      d.country ?? existing.country,
      d.city ?? existing.city,
      d.start_time ?? existing.start_time,
      d.end_time !== undefined ? d.end_time : existing.end_time,
      d.severity ?? existing.severity,
      d.source_url ?? existing.source_url,
      status,
      clearRejectionReason ? null : existing.rejection_reason,
      d.entity ?? existing.entity,
      d.stock_code ?? existing.stock_code,
      d.current_status ?? existing.current_status,
      id
    )
    .first<Outage>();

  return c.json({ outage: updated });
});

// ------------------------------------------------------------------
// DELETE /api/outages/:id — author-only, draft-only (judgment call: once
// an outage has ever been submitted for review, it stays as a record —
// only unsubmitted drafts can be deleted outright). Admins bypass both
// restrictions: any outage, any status, any owner.
// ------------------------------------------------------------------
outages.delete("/:id", requireAuth, async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const existing = await c.env.DB.prepare(`SELECT * FROM outages WHERE id = ?`)
    .bind(id)
    .first<Outage>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const user = c.get("user")!;
  const isAdminUser = user.role === "admin";

  if (!isAdminUser) {
    if (!canEditOutage(user, existing)) return c.json({ error: "Forbidden" }, 403);
    if (existing.status !== "draft") {
      return c.json({ error: "Only draft outages can be deleted" }, 400);
    }
  }

  // Artifacts are removed from D1 via ON DELETE CASCADE, but their R2
  // objects need explicit cleanup first.
  const { results: toDelete } = await c.env.DB.prepare(
    `SELECT r2_key FROM artifacts WHERE outage_id = ?`
  )
    .bind(id)
    .all<{ r2_key: string }>();
  await Promise.all(toDelete.map((a) => c.env.ARTIFACTS.delete(a.r2_key).catch(() => {})));

  await c.env.DB.prepare(`DELETE FROM outages WHERE id = ?`).bind(id).run();

  if (isAdminUser) {
    await c.env.DB.prepare(
      `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
       VALUES (?, 'delete_outage', 'outage', ?, NULL)`
    )
      .bind(user.id, id)
      .run();
  }

  return c.body(null, 204);
});

// ------------------------------------------------------------------
// POST /api/outages/:id/hide — admin-only. Removes an outage from the
// public feed and single-outage view without deleting it — the record,
// comments, and attachments all stay intact for the author/moderators.
// ------------------------------------------------------------------
outages.post("/:id/hide", requireAuth, requireRole("admin"), async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const existing = await c.env.DB.prepare(`SELECT * FROM outages WHERE id = ?`).bind(id).first<Outage>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const actor = c.get("user")!;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE outages SET hidden = 1 WHERE id = ?`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
       VALUES (?, 'hide_outage', 'outage', ?, NULL)`
    ).bind(actor.id, id),
  ]);

  const updated = await c.env.DB.prepare(`SELECT * FROM outages WHERE id = ?`).bind(id).first<Outage>();
  return c.json({ outage: updated });
});

// ------------------------------------------------------------------
// POST /api/outages/:id/unhide — admin-only.
// ------------------------------------------------------------------
outages.post("/:id/unhide", requireAuth, requireRole("admin"), async (c) => {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const existing = await c.env.DB.prepare(`SELECT * FROM outages WHERE id = ?`).bind(id).first<Outage>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const actor = c.get("user")!;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE outages SET hidden = 0 WHERE id = ?`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
       VALUES (?, 'unhide_outage', 'outage', ?, NULL)`
    ).bind(actor.id, id),
  ]);

  const updated = await c.env.DB.prepare(`SELECT * FROM outages WHERE id = ?`).bind(id).first<Outage>();
  return c.json({ outage: updated });
});

// Nested sub-resources
outages.get("/:id/artifacts", listArtifacts);
outages.post("/:id/artifacts", requireAuth, requireVerifiedEmail, uploadArtifact);
outages.get("/:id/comments", getComments);
outages.post("/:id/comments", requireAuth, requireVerifiedEmail, createComment);

export default outages;
