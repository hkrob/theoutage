import { api, ApiError } from "./api.js";
import { requireUser } from "./nav.js";
import { escapeHtml, formatDateTime, severityBadge, statusBadge, categoryBadge, emptyState, alertHtml } from "./render.js";

const area = document.getElementById("dashboard-area");

function rowHtml(outage) {
  return `
    <div class="outage-card" style="cursor: default;">
      <div class="outage-card-body">
        <div class="outage-card-top">
          ${statusBadge(outage.status)}
          ${severityBadge(outage.severity)}
          ${categoryBadge(outage.category)}
        </div>
        <h3 class="outage-card-title"><a href="/outage.html?id=${outage.id}">${escapeHtml(outage.title)}</a></h3>
        <div class="outage-card-meta">
          <span class="mono">${formatDateTime(outage.start_time)}</span>
          ${outage.status === "rejected" && outage.rejection_reason ? `<span class="text-secondary">Rejected: ${escapeHtml(outage.rejection_reason)}</span>` : ""}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap: var(--space-2); justify-content:center;">
        <a class="btn btn-sm" href="/submit.html?id=${outage.id}">Edit</a>
      </div>
    </div>
  `;
}

async function load() {
  try {
    const { results } = await api.listOutages({ mine: "1", pageSize: 100 });
    if (results.length === 0) {
      area.innerHTML = emptyState("No submissions yet.");
      return;
    }
    area.innerHTML = `<div class="card-list">${results.map(rowHtml).join("")}</div>`;
  } catch (err) {
    area.innerHTML = alertHtml("error", err instanceof ApiError ? err.message : "Couldn't load your submissions.");
  }
}

async function init() {
  const user = await requireUser();
  if (!user) return;
  load();
}

init();
