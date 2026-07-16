import { api, ApiError } from "./api.js";
import { requireAdmin } from "./nav.js";
import { escapeHtml, formatDateTime, alertHtml } from "./render.js";

const alertArea = document.getElementById("health-alert-area");
const overallArea = document.getElementById("health-overall");
const checksArea = document.getElementById("health-checks");
const refreshBtn = document.getElementById("refresh-health-btn");

function showAlert(kind, message) {
  alertArea.innerHTML = alertHtml(kind, message);
}

// Reuses existing badge classes rather than adding new ones — the color
// semantics already line up (green/amber/red/muted).
const STATUS_BADGE_CLASS = {
  ok: "badge-current-status-resolved",
  degraded: "badge-current-status-identified",
  down: "badge-current-status-investigating",
  not_configured: "badge-unverified",
};

const STATUS_LABEL = {
  ok: "OK",
  degraded: "Degraded",
  down: "Down",
  not_configured: "Not configured",
};

function statusBadgeHtml(status) {
  const cls = STATUS_BADGE_CLASS[status] || "badge-unverified";
  const label = STATUS_LABEL[status] || status;
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function checkCardHtml(check) {
  return `
    <div class="outage-card" style="cursor: default;">
      <div class="outage-card-body">
        <div class="outage-card-top">
          ${statusBadgeHtml(check.status)}
        </div>
        <h3 class="outage-card-title">${escapeHtml(check.name)}</h3>
        <div class="outage-card-meta">
          ${typeof check.latencyMs === "number" ? `<span class="mono">${check.latencyMs}ms</span>` : ""}
          ${check.detail ? `<span class="text-secondary">${escapeHtml(check.detail)}</span>` : ""}
        </div>
      </div>
    </div>
  `;
}

async function load() {
  refreshBtn.disabled = true;
  checksArea.innerHTML = `<div class="spinner-text">Checking…</div>`;
  try {
    const { overall, checks, checkedAt } = await api.getHealth();
    overallArea.innerHTML = `
      <div class="alert alert-${overall === "ok" ? "success" : overall === "degraded" ? "warning" : "error"}" style="margin-bottom: var(--space-4);">
        Overall: <strong>${escapeHtml(STATUS_LABEL[overall] || overall)}</strong>
        <span class="text-muted"> — checked ${formatDateTime(checkedAt)}</span>
      </div>
    `;
    checksArea.innerHTML = `<div class="card-list">${checks.map(checkCardHtml).join("")}</div>`;
  } catch (err) {
    showAlert("error", err instanceof ApiError ? err.message : "Couldn't load service health.");
    checksArea.innerHTML = "";
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", load);

async function init() {
  const user = await requireAdmin();
  if (!user) return;
  load();
}

init();
