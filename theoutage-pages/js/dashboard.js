import { api, ApiError } from "./api.js";
import { requireUser } from "./nav.js";
import {
  escapeHtml,
  formatDate,
  severityBadge,
  statusBadge,
  categoryBadge,
  currentStatusBadge,
  emptyState,
  alertHtml,
} from "./render.js";

const area = document.getElementById("dashboard-area");
const alertArea = document.getElementById("dashboard-alert-area");
const titleEl = document.getElementById("dashboard-title");
const subtitleEl = document.getElementById("dashboard-subtitle");
const newSubmissionBtn = document.getElementById("new-submission-btn");

const params = new URLSearchParams(window.location.search);
const viewAuthorId = params.get("author_id");
const viewAuthorName = params.get("name");

function showAlert(kind, message) {
  alertArea.innerHTML = alertHtml(kind, message);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function adminActionsHtml(outage) {
  return `
    <div style="display:flex; flex-direction:column; gap: var(--space-2);">
      ${
        outage.hidden
          ? `<button class="btn btn-sm unhide-outage-btn" data-id="${outage.id}" type="button">Unhide</button>`
          : `<button class="btn btn-sm hide-outage-btn" data-id="${outage.id}" type="button">Hide</button>`
      }
      <button class="btn btn-sm btn-danger delete-outage-btn" data-id="${outage.id}" type="button">Delete</button>
    </div>
  `;
}

function rowHtml(outage) {
  return `
    <div class="outage-card" style="cursor: default;">
      <div class="outage-card-body">
        <div class="outage-card-top">
          ${statusBadge(outage.status)}
          ${severityBadge(outage.severity)}
          ${categoryBadge(outage.category)}
          ${currentStatusBadge(outage.current_status)}
          ${outage.hidden ? `<span class="badge badge-frozen">hidden</span>` : ""}
        </div>
        <h3 class="outage-card-title"><a href="/outage.html?id=${outage.id}">${escapeHtml(outage.title)}</a></h3>
        <div class="outage-card-meta">
          <span class="text-secondary">${escapeHtml(outage.entity)}</span>
          <span class="mono">${formatDate(outage.start_time)}</span>
          <span class="mono text-muted">#${escapeHtml(outage.outage_number)}</span>
          ${outage.status === "rejected" && outage.rejection_reason ? `<span class="text-secondary">Rejected: ${escapeHtml(outage.rejection_reason)}</span>` : ""}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap: var(--space-2); justify-content:center;">
        ${viewAuthorId ? adminActionsHtml(outage) : `<a class="btn btn-sm" href="/submit.html?id=${outage.id}">Edit</a>`}
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
    if (viewAuthorId) wireAdminActions();
  } catch (err) {
    area.innerHTML = alertHtml(
      "error",
      err instanceof ApiError ? err.message : "Couldn't load submissions."
    );
  }
}

function wireAdminActions() {
  document.querySelectorAll(".hide-outage-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Hide this outage from the public feed? The record stays intact — you can unhide it any time.")) return;
      btn.disabled = true;
      try {
        await api.hideOutage(btn.dataset.id);
        showAlert("success", "Outage hidden.");
        await load();
      } catch (err) {
        showAlert("error", err instanceof ApiError ? err.message : "Couldn't hide this outage.");
        btn.disabled = false;
      }
    })
  );

  document.querySelectorAll(".unhide-outage-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api.unhideOutage(btn.dataset.id);
        showAlert("success", "Outage unhidden.");
        await load();
      } catch (err) {
        showAlert("error", err instanceof ApiError ? err.message : "Couldn't unhide this outage.");
        btn.disabled = false;
      }
    })
  );

  document.querySelectorAll(".delete-outage-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Permanently delete this outage? This removes the record, comments, and attachments. This can't be undone.")) return;
      btn.disabled = true;
      try {
        await api.deleteOutage(btn.dataset.id);
        showAlert("success", "Outage deleted.");
        await load();
      } catch (err) {
        showAlert("error", err instanceof ApiError ? err.message : "Couldn't delete this outage.");
        btn.disabled = false;
      }
    })
  );
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
