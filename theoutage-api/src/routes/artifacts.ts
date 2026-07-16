import { Hono } from "hono";
import type { Context, Handler } from "hono";
import type { AppEnv, Artifact, Outage } from "../types";
import { randomToken } from "../lib/crypto";
import { canEditOutage, canViewOutage } from "../lib/outageAccess";
import { MAX_ARTIFACT_BYTES, MAX_OUTAGE_ARTIFACT_TOTAL_BYTES } from "../lib/constants";

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  return cleaned || "file";
}

// GET /api/outages/:id/artifacts — primary thumbnail first, then insertion order
export const listArtifacts: Handler<AppEnv> = async (c) => {
  const outageId = parseInt(c.req.param("id") ?? "", 10);
  if (!outageId) return c.json({ error: "Invalid outage id" }, 400);

  const outage = await c.env.DB.prepare(`SELECT id, author_id, status, hidden FROM outages WHERE id = ?`)
    .bind(outageId)
    .first<Pick<Outage, "id" | "author_id" | "status" | "hidden">>();

  if (!outage || !canViewOutage(c.get("user"), outage)) {
    return c.json({ error: "Not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, outage_id, r2_key, type, size_bytes, is_primary, caption
     FROM artifacts WHERE outage_id = ?
     ORDER BY is_primary DESC, id ASC`
  )
    .bind(outageId)
    .all<Artifact>();

  return c.json({ results });
};

// POST /api/outages/:id/artifacts — multipart/form-data, field "file" (+ optional "caption")
// Requires requireAuth + requireVerifiedEmail upstream.
export const uploadArtifact: Handler<AppEnv> = async (c) => {
  const outageId = parseInt(c.req.param("id") ?? "", 10);
  if (!outageId) return c.json({ error: "Invalid outage id" }, 400);

  const outage = await c.env.DB.prepare(`SELECT id, author_id, status FROM outages WHERE id = ?`)
    .bind(outageId)
    .first<Pick<Outage, "id" | "author_id" | "status">>();

  if (!outage) return c.json({ error: "Not found" }, 404);
  const user = c.get("user")!;
  if (!canEditOutage(user, outage)) return c.json({ error: "Forbidden" }, 403);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Expected multipart/form-data" }, 400);
  }

  // @cloudflare/workers-types types FormData.get() as string | null only,
  // but the Workers runtime actually returns a File for file fields — cast
  // to the real union and narrow at runtime instead of trusting the (too
  // narrow) declared type.
  const fileEntry = form.get("file") as unknown as File | string | null;
  if (!fileEntry || typeof fileEntry === "string") {
    return c.json({ error: "Missing file field" }, 400);
  }
  const file = fileEntry;
  const caption = form.get("caption");

  if (file.size <= 0) return c.json({ error: "Empty file" }, 400);
  if (file.size > MAX_ARTIFACT_BYTES) {
    return c.json({ error: `File exceeds the ${MAX_ARTIFACT_BYTES / 1024 / 1024}MB per-file cap` }, 400);
  }

  const totalRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(size_bytes), 0) AS total FROM artifacts WHERE outage_id = ?`
  )
    .bind(outageId)
    .first<{ total: number }>();
  const currentTotal = totalRow?.total ?? 0;

  if (currentTotal + file.size > MAX_OUTAGE_ARTIFACT_TOTAL_BYTES) {
    return c.json(
      { error: `This would exceed the ${MAX_OUTAGE_ARTIFACT_TOTAL_BYTES / 1024 / 1024}MB per-outage cap` },
      400
    );
  }

  const existingCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM artifacts WHERE outage_id = ?`
  )
    .bind(outageId)
    .first<{ n: number }>();
  const isPrimary = (existingCount?.n ?? 0) === 0;

  const r2Key = `outages/${outageId}/${randomToken(16)}-${sanitizeFilename(file.name)}`;
  const contentType = file.type || "application/octet-stream";

  await c.env.ARTIFACTS.put(r2Key, await file.arrayBuffer(), {
    httpMetadata: { contentType },
  });

  let artifact: Artifact | null;
  try {
    artifact = await c.env.DB.prepare(
      `INSERT INTO artifacts (outage_id, r2_key, type, size_bytes, is_primary, caption)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
    )
      .bind(outageId, r2Key, contentType, file.size, isPrimary ? 1 : 0, typeof caption === "string" ? caption : null)
      .first<Artifact>();
  } catch (err) {
    // Compensate: don't leave an orphaned R2 object if the D1 write failed
    // (e.g. the 10MB CHECK constraint tripped on a race).
    await c.env.ARTIFACTS.delete(r2Key).catch(() => {});
    throw err;
  }

  // Judgment call: adding an artifact to an already-published outage counts
  // as an edit and re-triggers moderation, same as editing outage fields.
  if (outage.status === "published") {
    await c.env.DB.prepare(`UPDATE outages SET status = 'pending_review' WHERE id = ?`)
      .bind(outageId)
      .run();
  }

  return c.json({ artifact }, 201);
};

// Standalone router — operates on an artifact by its own id, mounted at /api/artifacts
export const artifactById = new Hono<AppEnv>();

async function loadArtifactWithOutage(c: Context<AppEnv>, artifactId: number) {
  return c.env.DB.prepare(
    `SELECT a.*, o.author_id AS outage_author_id, o.status AS outage_status, o.hidden AS outage_hidden
     FROM artifacts a
     JOIN outages o ON o.id = a.outage_id
     WHERE a.id = ?`
  )
    .bind(artifactId)
    .first<
      Artifact & { outage_author_id: number; outage_status: Outage["status"]; outage_hidden: number }
    >();
}

// GET /api/artifacts/:artifactId/file — streams the R2 object. Enforces the
// same visibility rule as the parent outage (canViewOutage), so a draft's
// attachments aren't fetchable just because someone has the artifact id.
artifactById.get("/:artifactId/file", async (c) => {
  const artifactId = parseInt(c.req.param("artifactId") ?? "", 10);
  if (!artifactId) return c.json({ error: "Invalid artifact id" }, 400);

  const row = await loadArtifactWithOutage(c, artifactId);
  if (!row) return c.json({ error: "Not found" }, 404);

  const user = c.get("user");
  if (
    !canViewOutage(user, { status: row.outage_status, author_id: row.outage_author_id, hidden: row.outage_hidden })
  ) {
    return c.json({ error: "Not found" }, 404);
  }

  const object = await c.env.ARTIFACTS.get(row.r2_key);
  if (!object) return c.json({ error: "File missing from storage" }, 404);

  const headers = new Headers();
  headers.set("Content-Type", row.type || "application/octet-stream");
  // Not marked public/immutable: visibility depends on auth (drafts/pending
  // outages are private), so avoid shared-cache exposure of anything gated.
  headers.set("Cache-Control", "private, max-age=3600");

  return new Response(object.body, { headers });
});

artifactById.delete("/:artifactId", async (c) => {
  const artifactId = parseInt(c.req.param("artifactId") ?? "", 10);
  if (!artifactId) return c.json({ error: "Invalid artifact id" }, 400);

  const row = await loadArtifactWithOutage(c, artifactId);
  if (!row) return c.json({ error: "Not found" }, 404);

  const user = c.get("user");
  if (!canEditOutage(user, { author_id: row.outage_author_id })) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await c.env.ARTIFACTS.delete(row.r2_key).catch(() => {});
  await c.env.DB.prepare(`DELETE FROM artifacts WHERE id = ?`).bind(artifactId).run();

  // Promote the next artifact to primary if we just deleted the thumbnail.
  if (row.is_primary) {
    const next = await c.env.DB.prepare(
      `SELECT id FROM artifacts WHERE outage_id = ? ORDER BY id ASC LIMIT 1`
    )
      .bind(row.outage_id)
      .first<{ id: number }>();
    if (next) {
      await c.env.DB.prepare(`UPDATE artifacts SET is_primary = 1 WHERE id = ?`).bind(next.id).run();
    }
  }

  if (row.outage_status === "published") {
    await c.env.DB.prepare(`UPDATE outages SET status = 'pending_review' WHERE id = ?`)
      .bind(row.outage_id)
      .run();
  }

  return c.body(null, 204);
});

artifactById.patch("/:artifactId", async (c) => {
  const artifactId = parseInt(c.req.param("artifactId") ?? "", 10);
  if (!artifactId) return c.json({ error: "Invalid artifact id" }, 400);

  const row = await loadArtifactWithOutage(c, artifactId);
  if (!row) return c.json({ error: "Not found" }, 404);

  const user = c.get("user");
  if (!canEditOutage(user, { author_id: row.outage_author_id })) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const setPrimary = body.is_primary === true;
  const caption = typeof body.caption === "string" ? body.caption : undefined;

  if (setPrimary) {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE artifacts SET is_primary = 0 WHERE outage_id = ?`).bind(row.outage_id),
      c.env.DB.prepare(`UPDATE artifacts SET is_primary = 1 WHERE id = ?`).bind(artifactId),
    ]);
  }

  if (caption !== undefined) {
    await c.env.DB.prepare(`UPDATE artifacts SET caption = ? WHERE id = ?`).bind(caption, artifactId).run();
  }

  const updated = await c.env.DB.prepare(`SELECT * FROM artifacts WHERE id = ?`)
    .bind(artifactId)
    .first<Artifact>();

  return c.json({ artifact: updated });
});
