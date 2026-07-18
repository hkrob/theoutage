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

/**
 * Returns the URL only if it's a safe http(s) link, else "" — defense in
 * depth against a `javascript:`/`data:` href slipping through (the backend
 * also rejects these now). escapeHtml alone doesn't neutralize a bad scheme
 * since those payloads contain no HTML metacharacters.
 */
export function safeUrl(url) {
  if (!url) return "";
  return /^https?:\/\//i.test(String(url).trim()) ? url : "";
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

/** Whole-day duration between two date-only (YYYY-MM-DD) strings. */
export function formatDuration(startDate, endDate) {
  if (!endDate) return "Ongoing";
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.round((end - start) / 86400000);
  if (days <= 0) return "Same day";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function severityBadge(severity) {
  const slug = String(severity).split(" ")[0];
  return `<span class="badge badge-severity-${escapeHtml(slug)}">${escapeHtml(severity)}</span>`;
}

export function statusBadge(status) {
  const label = status === "pending_review" ? "pending review" : status;
  return `<span class="badge badge-status-${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

export function categoryBadge(category) {
  return `<span class="badge badge-category">${escapeHtml(category)}</span>`;
}

const CURRENT_STATUS_LABELS = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

export function currentStatusBadge(currentStatus) {
  const label = CURRENT_STATUS_LABELS[currentStatus] || currentStatus;
  return `<span class="badge badge-current-status-${escapeHtml(currentStatus)}">${escapeHtml(label)}</span>`;
}

/** True when the incident itself is still live (no end date, not resolved). */
export function isOngoing(outage) {
  return !outage.end_time && outage.current_status !== "resolved";
}

/** A small pulsing "live" tag for ongoing incidents. */
export function ongoingTag() {
  return `<span class="live-tag"><span class="live-dot"></span>Ongoing</span>`;
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
          ${currentStatusBadge(outage.current_status)}
          ${isOngoing(outage) ? ongoingTag() : ""}
          ${outage.status !== "published" ? statusBadge(outage.status) : ""}
        </div>
        <h3 class="outage-card-title">${escapeHtml(outage.title)}</h3>
        <div class="outage-card-meta">
          <span class="text-secondary">${escapeHtml(outage.entity)}</span>
          <span>${escapeHtml(location)}</span>
          <span class="mono">${formatDate(outage.start_time)}</span>
          <span class="mono text-muted">#${escapeHtml(outage.outage_number)}</span>
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
