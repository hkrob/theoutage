import { api } from "./api.js";

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function severityBadge(severity) {
  return `<span class="badge badge-severity-${escapeHtml(severity)}">${escapeHtml(severity)}</span>`;
}

export function statusBadge(status) {
  const label = status === "pending_review" ? "pending review" : status;
  return `<span class="badge badge-status-${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

export function categoryBadge(category) {
  return `<span class="badge badge-category">${escapeHtml(category)}</span>`;
}

/** Renders one feed card. `outage` is a row from GET /api/outages. */
export function outageCardHtml(outage) {
  const thumb = outage.primary_artifact_id
    ? `<img class="outage-card-thumb" src="${api.artifactFileUrl(outage.primary_artifact_id)}" alt="" loading="lazy" />`
    : `<div class="outage-card-thumb">no image</div>`;

  const location = [outage.city, outage.country].filter(Boolean).join(", ");

  return `
    <a class="outage-card" href="/outage.html?id=${outage.id}">
      ${thumb}
      <div class="outage-card-body">
        <div class="outage-card-top">
          ${severityBadge(outage.severity)}
          ${categoryBadge(outage.category)}
          ${outage.status !== "published" ? statusBadge(outage.status) : ""}
        </div>
        <h3 class="outage-card-title">${escapeHtml(outage.title)}</h3>
        <div class="outage-card-meta">
          <span>${escapeHtml(location)}</span>
          <span class="mono">${formatDateTime(outage.start_time)}</span>
        </div>
        <p class="outage-card-desc">${escapeHtml(outage.description)}</p>
      </div>
    </a>
  `;
}

export function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

export function alertHtml(kind, message) {
  return `<div class="alert alert-${kind}">${escapeHtml(message)}</div>`;
}
