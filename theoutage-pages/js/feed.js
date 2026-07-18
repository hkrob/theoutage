import { api, ApiError } from "./api.js";
import { initNav, isModerator } from "./nav.js";
import { CATEGORIES, SEVERITIES, COUNTRIES } from "./constants.js";
import { outageCardHtml, emptyState, alertHtml, isOngoing } from "./render.js";

const PAGE_SIZE = 20;

const feedArea = document.getElementById("feed-area");
const pagination = document.getElementById("pagination");
const form = document.getElementById("filters-form");
const feedTitle = document.getElementById("feed-title");

let currentPage = 1;
let currentUser = null;

function populateSelect(id, options) {
  const el = document.getElementById(id);
  for (const opt of options) {
    const [value, label] = Array.isArray(opt) ? opt : [opt, opt];
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    el.appendChild(o);
  }
}

populateSelect("f-category", CATEGORIES);
populateSelect("f-severity", SEVERITIES);
populateSelect("f-country", COUNTRIES);

function readFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  document.getElementById("f-q").value = params.get("q") || "";
  document.getElementById("f-category").value = params.get("category") || "";
  document.getElementById("f-severity").value = params.get("severity") || "";
  document.getElementById("f-country").value = params.get("country") || "";
  document.getElementById("f-date-from").value = params.get("date_from_raw") || "";
  document.getElementById("f-date-to").value = params.get("date_to_raw") || "";
  document.getElementById("f-pending").checked = params.get("pending") === "1";
  currentPage = parseInt(params.get("page") || "1", 10) || 1;
}

function buildParams() {
  const dateFromRaw = document.getElementById("f-date-from").value;
  const dateToRaw = document.getElementById("f-date-to").value;
  const pending = document.getElementById("f-pending").checked;

  return {
    q: document.getElementById("f-q").value.trim(),
    category: document.getElementById("f-category").value,
    severity: document.getElementById("f-severity").value,
    country: document.getElementById("f-country").value,
    date_from: dateFromRaw ? `${dateFromRaw}T00:00:00.000Z` : "",
    date_to: dateToRaw ? `${dateToRaw}T23:59:59.999Z` : "",
    status: pending ? "pending_review" : "",
    page: currentPage,
    pageSize: PAGE_SIZE,
    // kept only to round-trip the raw <input type=date> values through the URL
    date_from_raw: dateFromRaw,
    date_to_raw: dateToRaw,
    pending: pending ? "1" : "",
  };
}

function syncUrl(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) usp.set(k, v);
  }
  const qs = usp.toString();
  history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

async function loadFeed() {
  feedArea.innerHTML = `<div class="spinner-text">Loading…</div>`;
  pagination.innerHTML = "";

  const params = buildParams();
  syncUrl(params);

  feedTitle.textContent = params.status === "pending_review" ? "Pending review" : "Recent outages";

  // Strip the URL-only round-trip fields before hitting the API.
  const { date_from_raw, date_to_raw, pending, ...apiParams } = params;

  try {
    const { results, total, pageSize } = await api.listOutages(apiParams);

    if (results.length === 0) {
      feedArea.innerHTML = emptyState(
        apiParams.status === "pending_review" ? "Nothing pending review." : "No outages match these filters."
      );
      return;
    }

    const ongoingCount = results.filter(isOngoing).length;
    const label = apiParams.status === "pending_review" ? "awaiting review" : "matching";
    const statsBar = `
      <div class="feed-stats">
        <strong>${total}</strong> outage${total === 1 ? "" : "s"} ${label}
        ${ongoingCount > 0 ? `<span class="dot-sep">·</span> <span class="text-danger">${ongoingCount} ongoing on this page</span>` : ""}
      </div>`;
    feedArea.innerHTML = statsBar + `<div class="card-list">${results.map(outageCardHtml).join("")}</div>`;

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (totalPages > 1) {
      pagination.innerHTML = `
        <button class="btn btn-sm" id="prev-page" ${currentPage <= 1 ? "disabled" : ""}>Prev</button>
        <span class="text-secondary" style="align-self:center; font-size: var(--text-sm);">
          Page ${currentPage} of ${totalPages}
        </span>
        <button class="btn btn-sm" id="next-page" ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
      `;
      document.getElementById("prev-page")?.addEventListener("click", () => {
        currentPage = Math.max(1, currentPage - 1);
        loadFeed();
      });
      document.getElementById("next-page")?.addEventListener("click", () => {
        currentPage = Math.min(totalPages, currentPage + 1);
        loadFeed();
      });
    }
  } catch (err) {
    feedArea.innerHTML = alertHtml(
      "error",
      err instanceof ApiError ? err.message : "Couldn't load the feed. Try refreshing."
    );
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  currentPage = 1;
  loadFeed();
});

async function init() {
  currentUser = await initNav();
  if (isModerator(currentUser)) {
    document.getElementById("pending-toggle-field").style.display = "";
  }
  readFiltersFromUrl();
  loadFeed();
}

init();
