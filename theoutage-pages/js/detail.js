import { api, ApiError } from "./api.js";
import { initNav, isModerator } from "./nav.js";
import {
  escapeHtml,
  formatDateTime,
  severityBadge,
  statusBadge,
  categoryBadge,
  currentStatusBadge,
  alertHtml,
} from "./render.js";

const outageId = new URLSearchParams(window.location.search).get("id");
const root = document.getElementById("detail-root");
const alertArea = document.getElementById("detail-alert-area");

let currentUser = null;

function showAlert(kind, message) {
  alertArea.innerHTML = alertHtml(kind, message);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function isImage(mimeType) {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}

function galleryHtml(artifacts, isOwner) {
  if (artifacts.length === 0) {
    return `<p class="text-muted">No attachments.</p>`;
  }

  return `
    <div class="gallery">
      ${artifacts
        .map((a) => {
          const fileUrl = api.artifactFileUrl(a.id);
          const media = isImage(a.type)
            ? `<img src="${fileUrl}" alt="${escapeHtml(a.caption || "")}" loading="lazy" />`
            : `<a class="file-placeholder" href="${fileUrl}" target="_blank" rel="noopener">${escapeHtml(
                a.type || "file"
              )}<br />(open)</a>`;
          return `
            <div class="gallery-item" data-artifact-id="${a.id}">
              ${a.is_primary ? '<span class="primary-tag">thumbnail</span>' : ""}
              ${isImage(a.type) ? `<a href="${fileUrl}" target="_blank" rel="noopener">${media}</a>` : media}
              ${
                isOwner
                  ? `<div style="position:absolute; bottom:4px; right:4px; display:flex; gap:4px;">
                      ${!a.is_primary ? `<button class="btn btn-sm set-primary-btn" data-id="${a.id}" type="button">★</button>` : ""}
                      <button class="btn btn-sm btn-danger delete-artifact-btn" data-id="${a.id}" type="button">✕</button>
                    </div>`
                  : ""
              }
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

async function loadStockPrice(code) {
  const el = document.getElementById("stock-price");
  if (!el) return;
  try {
    const { quote, stale } = await api.getStockQuote(code);
    const sign = quote.change > 0 ? "+" : "";
    const colorClass = quote.change > 0 ? "text-success" : quote.change < 0 ? "text-danger" : "text-muted";
    el.innerHTML = `<span class="${colorClass}">$${quote.price.toFixed(2)} (${sign}${quote.percent_change.toFixed(2)}%)</span>${
      stale ? ` <span class="text-muted">(cached)</span>` : ""
    }`;
  } catch {
    el.innerHTML = `<span class="text-muted">price unavailable (US-listed tickers only for now)</span>`;
  }
}

function commentHtml(c, canModerate) {
  return `
    <div class="comment" data-comment-id="${c.id}">
      <div class="comment-meta">
        <strong>${escapeHtml(c.author_display_name)}</strong>
        <span>${formatDateTime(c.created_at)}</span>
        ${canModerate ? `<button class="btn btn-sm btn-danger remove-comment-btn" data-id="${c.id}" type="button">Remove</button>` : ""}
      </div>
      <div class="comment-body">${escapeHtml(c.body)}</div>
    </div>
  `;
}

async function load() {
  let payload;
  try {
    payload = await api.getOutage(outageId);
  } catch (err) {
    root.innerHTML = alertHtml(
      "error",
      err instanceof ApiError && err.status === 404
        ? "This outage doesn't exist, or you don't have permission to view it."
        : "Couldn't load this outage."
    );
    return;
  }

  const { outage, artifacts } = payload;
  const isOwner = !!currentUser && currentUser.id === outage.author_id;
  const canModerate = isModerator(currentUser);

  let commentsHtml = `<div class="spinner-text">Loading comments…</div>`;

  root.innerHTML = `
    <div class="detail-panel">
      <div class="detail-badges">
        ${severityBadge(outage.severity)}
        ${categoryBadge(outage.category)}
        ${currentStatusBadge(outage.current_status)}
        ${statusBadge(outage.status)}
      </div>
      <h1 class="detail-title">${escapeHtml(outage.title)}</h1>
      <p class="text-secondary" style="margin-top: calc(var(--space-1) * -1); margin-bottom: var(--space-4);">${escapeHtml(outage.entity)}</p>

      ${
        outage.status === "rejected" && outage.rejection_reason
          ? alertHtml("warning", `Rejected: ${outage.rejection_reason}`)
          : ""
      }

      <div class="detail-meta-grid">
        <div>
          <div class="detail-meta-label">Location</div>
          <div class="detail-meta-value">${escapeHtml([outage.city, outage.country].filter(Boolean).join(", ") || "—")}</div>
        </div>
        <div>
          <div class="detail-meta-label">Started</div>
          <div class="detail-meta-value mono">${formatDateTime(outage.start_time)}</div>
        </div>
        <div>
          <div class="detail-meta-label">Ended</div>
          <div class="detail-meta-value mono">${outage.end_time ? formatDateTime(outage.end_time) : "Ongoing"}</div>
        </div>
        <div>
          <div class="detail-meta-label">Stock code</div>
          <div class="detail-meta-value mono">${escapeHtml(outage.stock_code || "—")}${
            outage.stock_code ? ` <span id="stock-price"><span class="text-muted">loading…</span></span>` : ""
          }</div>
        </div>
        <div>
          <div class="detail-meta-label">Source</div>
          <div class="detail-meta-value">${
            outage.source_url
              ? `<a href="${escapeHtml(outage.source_url)}" target="_blank" rel="noopener">link</a>`
              : "—"
          }</div>
        </div>
      </div>

      <p class="detail-description">${escapeHtml(outage.description)}</p>

      ${outage.tags ? `<p class="text-muted" style="margin-top: var(--space-3);">Tags: ${escapeHtml(outage.tags)}</p>` : ""}

      <div id="owner-actions" style="margin-top: var(--space-4); display:flex; gap: var(--space-2);"></div>
      <div id="moderator-actions" style="margin-top: var(--space-4);"></div>
    </div>

    <div class="detail-panel">
      <h2 class="section-title">Attachments</h2>
      <div id="gallery-container">${galleryHtml(artifacts, isOwner)}</div>
      <div id="upload-container" style="margin-top: var(--space-4);"></div>
    </div>

    <div class="detail-panel">
      <h2 class="section-title">Comments</h2>
      <div id="comments-container">${commentsHtml}</div>
      <div id="comment-form-container" style="margin-top: var(--space-4);"></div>
    </div>
  `;

  renderOwnerActions(outage, isOwner);
  renderModeratorActions(outage, canModerate);
  renderUploadForm(outage, isOwner);
  loadComments(outage);
  if (outage.stock_code) loadStockPrice(outage.stock_code);

  document.querySelectorAll(".set-primary-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api.setPrimaryArtifact(btn.dataset.id);
        await load();
      } catch (err) {
        showAlert("error", err instanceof ApiError ? err.message : "Couldn't update thumbnail.");
      }
    })
  );

  document.querySelectorAll(".delete-artifact-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this attachment?")) return;
      btn.disabled = true;
      try {
        await api.deleteArtifact(btn.dataset.id);
        await load();
      } catch (err) {
        showAlert("error", err instanceof ApiError ? err.message : "Couldn't delete attachment.");
      }
    })
  );
}

function renderOwnerActions(outage, isOwner) {
  const el = document.getElementById("owner-actions");
  if (!isOwner) return;

  const buttons = [`<a class="btn btn-sm" href="/submit.html?id=${outage.id}">Edit</a>`];

  if (outage.status === "draft" || outage.status === "rejected") {
    buttons.push(`<button class="btn btn-sm btn-primary" id="submit-for-review-btn" type="button">Submit for review</button>`);
  }
  if (outage.status === "draft") {
    buttons.push(`<button class="btn btn-sm btn-danger" id="delete-outage-btn" type="button">Delete draft</button>`);
  }

  el.innerHTML = buttons.join("");

  document.getElementById("submit-for-review-btn")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await api.updateOutage(outage.id, { action: "submit" });
      showAlert("success", "Submitted for review.");
      await load();
    } catch (err) {
      showAlert("error", err instanceof ApiError ? err.message : "Couldn't submit for review.");
      e.target.disabled = false;
    }
  });

  document.getElementById("delete-outage-btn")?.addEventListener("click", async (e) => {
    if (!confirm("Delete this draft? This can't be undone.")) return;
    e.target.disabled = true;
    try {
      await api.deleteOutage(outage.id);
      window.location.href = "/dashboard.html";
    } catch (err) {
      showAlert("error", err instanceof ApiError ? err.message : "Couldn't delete this draft.");
      e.target.disabled = false;
    }
  });
}

function renderModeratorActions(outage, canModerate) {
  const el = document.getElementById("moderator-actions");
  if (!canModerate || outage.status !== "pending_review") return;

  el.innerHTML = `
    <div class="alert alert-warning">
      Awaiting moderation.
      <div style="margin-top: var(--space-3); display:flex; gap: var(--space-2); flex-wrap: wrap;">
        <button class="btn btn-sm btn-primary" id="approve-btn" type="button">Approve</button>
        <button class="btn btn-sm btn-danger" id="show-reject-form-btn" type="button">Reject…</button>
      </div>
      <form id="reject-form" style="display:none; margin-top: var(--space-3);">
        <textarea id="reject-reason" placeholder="Reason shown to the author (required)" required></textarea>
        <div style="margin-top: var(--space-2);">
          <button class="btn btn-sm btn-danger" type="submit">Confirm reject</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("approve-btn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await api.approveOutage(outage.id);
      showAlert("success", "Approved and published.");
      await load();
    } catch (err) {
      showAlert("error", err instanceof ApiError ? err.message : "Couldn't approve.");
      e.target.disabled = false;
    }
  });

  document.getElementById("show-reject-form-btn").addEventListener("click", (e) => {
    document.getElementById("reject-form").style.display = "block";
    e.target.style.display = "none";
  });

  document.getElementById("reject-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const reason = document.getElementById("reject-reason").value.trim();
    if (!reason) return;
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await api.rejectOutage(outage.id, reason);
      showAlert("success", "Rejected. The author has been notified.");
      await load();
    } catch (err) {
      showAlert("error", err instanceof ApiError ? err.message : "Couldn't reject.");
      btn.disabled = false;
    }
  });
}

function renderUploadForm(outage, isOwner) {
  const el = document.getElementById("upload-container");
  if (!isOwner) return;

  el.innerHTML = `
    <form id="upload-form" style="display:flex; gap: var(--space-2); align-items:flex-end; flex-wrap:wrap;">
      <div class="field" style="margin-bottom:0; flex:1; min-width:200px;">
        <label for="upload-file">Add attachment</label>
        <input type="file" id="upload-file" required />
      </div>
      <button class="btn btn-sm" type="submit">Upload</button>
    </form>
    <div class="field-hint">Any file type, 10MB max per file, 50MB total per outage.</div>
  `;

  document.getElementById("upload-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById("upload-file");
    const file = fileInput.files[0];
    if (!file) return;
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await api.uploadArtifact(outage.id, file);
      await load();
    } catch (err) {
      showAlert("error", err instanceof ApiError ? err.message : "Upload failed.");
      btn.disabled = false;
    }
  });
}

async function loadComments(outage) {
  const container = document.getElementById("comments-container");
  const canModerate = isModerator(currentUser);

  try {
    const { results } = await api.listComments(outage.id, { pageSize: 100 });
    container.innerHTML =
      results.length === 0
        ? `<p class="text-muted">No comments yet.</p>`
        : results.map((c) => commentHtml(c, canModerate)).join("");

    document.querySelectorAll(".remove-comment-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const reason = prompt("Reason shown to the commenter (required):");
        if (!reason) return;
        const internalNote = prompt("Internal note (optional, moderators only):") || undefined;
        btn.disabled = true;
        try {
          await api.removeComment(btn.dataset.id, reason, internalNote);
          await loadComments(outage);
        } catch (err) {
          showAlert("error", err instanceof ApiError ? err.message : "Couldn't remove comment.");
        }
      })
    );
  } catch {
    container.innerHTML = `<p class="text-muted">Couldn't load comments.</p>`;
  }

  renderCommentForm(outage);
}

function renderCommentForm(outage) {
  const el = document.getElementById("comment-form-container");

  if (outage.status !== "published") {
    el.innerHTML = `<p class="text-muted">Comments open once this outage is published.</p>`;
    return;
  }
  if (!currentUser) {
    el.innerHTML = `<p class="text-muted"><a href="/login.html">Log in</a> to leave a comment.</p>`;
    return;
  }
  if (!currentUser.email_verified) {
    el.innerHTML = `<p class="text-muted">Verify your email to comment — check your inbox for a magic link.</p>`;
    return;
  }

  el.innerHTML = `
    <form id="comment-form">
      <div class="field">
        <textarea id="comment-body" placeholder="Add a comment…" required maxlength="5000"></textarea>
      </div>
      <button class="btn btn-sm btn-primary" type="submit">Post comment</button>
    </form>
  `;

  document.getElementById("comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = document.getElementById("comment-body").value.trim();
    if (!body) return;
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await api.createComment(outage.id, body);
      await loadComments(outage);
    } catch (err) {
      showAlert("error", err instanceof ApiError ? err.message : "Couldn't post comment.");
    } finally {
      btn.disabled = false;
    }
  });
}

async function init() {
  if (!outageId) {
    root.innerHTML = alertHtml("error", "No outage specified.");
    return;
  }
  currentUser = await initNav();
  await load();
}

init();
