import { api, ApiError } from "./api.js";
import { requireUser } from "./nav.js";
import { escapeHtml, formatDateTime, severityBadge, statusBadge, categoryBadge, currentStatusBadge, emptyState, alertHtml } from "./render.js";

const area = document.getElementById("dashboard-area");
const titleEl = document.getElementById("dashboard-title");
const subtitleEl = document.getElementById("dashboard-subtitle");
const newSubmissionBtn = document.getElementById("new-submission-btn");

const params = new URLSearchParams(window.location.search);
const viewAuthorId = params.get("author_id");
const viewAuthorName = params.get("name");

function rowHtml(outage) {
  return `
    <div class="outage-card" style="cursor: default;">
      <div class="outage-card-body">
        <div class="outage-card-top">
          ${statusBadge(outage.status)}
          ${severityBadge(outage.severity)}
          ${categoryBadge(outage.category)}
          ${currentStatusBadge(outage.current_status)}
        </div>
        <h3 class="outage-card-title"><a href="/outage.html?id=${outage.id}">${escapeHtml(outage.title)}</a></h3>
        <div class="outage-card-meta">
          <span class="text-secondary">${escapeHtml(outage.entity)}</span>
          <span class="mono">${formatDateTime(outage.start_time)}</span>
          ${outage.status === "rejected" && outage.rejection_reason ? `<span class="text-secondary">Rejected: ${escapeHtml(outage.rejection_reason)}</span>` : ""}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap: var(--space-2); justify-content:center;">
        ${viewAuthorId ? "" : `<a class="btn btn-sm" href="/submit.html?id=${outage.id}">Edit</a>`}
      </div>
    </div>
  `;
}

async function load() {
  try {
    const query = viewAuthorId ? { author_id: viewAuthorId, pageSize: 100 } : { mine: "1", pageSize: 100 };
    const { results } = await api.listOutages(query);
    if (results.length === 0) {
      area.innerHTML = emptyState(viewAuthorId ? "This user has no submissions." : "No submissions yet.");
      return;
    }
    area.innerHTML = `<div class="card-list">${results.map(rowHtml).join("")}</div>`;
  } catch (err) {
    area.innerHTML = alertHtml(
      "error",
      err instanceof ApiError ? err.message : "Couldn't load submissions."
    );
  }
}

async function init() {
  const user = await requireUser();
  if (!user) return;

  if (viewAuthorId) {
    const name = viewAuthorName || `user #${viewAuthorId}`;
    titleEl.textContent = `${name}'s submissions`;
    subtitleEl.textContent = "Drafts, pending review, published, and rejected — all in one place.";
    newSubmissionBtn.style.display = "none";
  }

  load();
}

init();
