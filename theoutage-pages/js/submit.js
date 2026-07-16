import { api, ApiError } from "./api.js";
import { requireUser, isModerator } from "./nav.js";
import { CATEGORIES, SEVERITIES, COUNTRIES, CURRENT_STATUSES } from "./constants.js";
import { alertHtml } from "./render.js";

const outageId = new URLSearchParams(window.location.search).get("id");
const form = document.getElementById("outage-form");
const alertArea = document.getElementById("alert-area");
const formTitle = document.getElementById("form-title");
const formSubtitle = document.getElementById("form-subtitle");
const formButtons = document.getElementById("form-buttons");

function showAlert(kind, message) {
  alertArea.innerHTML = alertHtml(kind, message);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function populateSelect(id, options) {
  const el = document.getElementById(id);
  el.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select…";
  placeholder.disabled = true;
  placeholder.selected = true;
  el.appendChild(placeholder);
  for (const opt of options) {
    const [value, label] = Array.isArray(opt) ? opt : [opt, opt];
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    el.appendChild(o);
  }
}

populateSelect("category", CATEGORIES);
populateSelect("severity", SEVERITIES);
populateSelect("country", COUNTRIES);
populateSelect("current_status", CURRENT_STATUSES);
document.getElementById("current_status").value = "investigating";

function readForm() {
  const endOngoing = document.getElementById("ongoing").checked;
  return {
    title: document.getElementById("title").value.trim(),
    entity: document.getElementById("entity").value.trim(),
    stock_code: document.getElementById("stock_code").value.trim() || undefined,
    description: document.getElementById("description").value.trim(),
    category: document.getElementById("category").value,
    severity: document.getElementById("severity").value,
    current_status: document.getElementById("current_status").value,
    tags: document.getElementById("tags").value.trim() || undefined,
    country: document.getElementById("country").value,
    city: document.getElementById("city").value.trim() || undefined,
    start_time: document.getElementById("start_time").value || null,
    end_time: endOngoing ? null : document.getElementById("end_time").value || null,
    source_url: document.getElementById("source_url").value.trim() || undefined,
  };
}

function fillForm(outage) {
  document.getElementById("title").value = outage.title;
  document.getElementById("entity").value = outage.entity || "";
  document.getElementById("stock_code").value = outage.stock_code || "";
  document.getElementById("description").value = outage.description;
  document.getElementById("category").value = outage.category;
  document.getElementById("severity").value = outage.severity;
  document.getElementById("current_status").value = outage.current_status || "investigating";
  document.getElementById("tags").value = outage.tags || "";
  document.getElementById("country").value = outage.country;
  document.getElementById("city").value = outage.city || "";
  document.getElementById("start_time").value = outage.start_time || "";
  if (outage.end_time) {
    document.getElementById("end_time").value = outage.end_time;
  } else {
    document.getElementById("ongoing").checked = true;
    document.getElementById("end_time").disabled = true;
  }
  document.getElementById("source_url").value = outage.source_url || "";
}

document.getElementById("ongoing").addEventListener("change", (e) => {
  const endInput = document.getElementById("end_time");
  endInput.disabled = e.target.checked;
  if (e.target.checked) endInput.value = "";
});

async function submitAs(action) {
  const payload = { ...readForm(), action };
  if (!payload.start_time) {
    showAlert("error", "Start time is required.");
    return null;
  }

  if (outageId) {
    return api.updateOutage(outageId, payload);
  }
  return api.createOutage({ ...payload, action: action === "submit" ? "submit" : "draft" });
}

function renderButtons(mode, status, canSelfApprove) {
  formButtons.innerHTML = "";

  if (mode === "create" || status === "draft" || status === "rejected") {
    formButtons.innerHTML = `
      <button type="button" class="btn" id="save-draft-btn">Save as draft</button>
      <button type="button" class="btn btn-primary" id="submit-review-btn">Submit for review</button>
    `;
  } else {
    formButtons.innerHTML = `<button type="button" class="btn btn-primary" id="save-changes-btn">Save changes</button>`;
    if (status === "published" && !canSelfApprove) {
      formButtons.insertAdjacentHTML(
        "beforeend",
        `<span class="text-muted" style="align-self:center; font-size: var(--text-sm);">Saving sends this back for re-review.</span>`
      );
    }
  }

  document.getElementById("save-draft-btn")?.addEventListener("click", () => handleSubmit("draft"));
  document.getElementById("submit-review-btn")?.addEventListener("click", () => handleSubmit("submit"));
  document.getElementById("save-changes-btn")?.addEventListener("click", () => handleSubmit("save"));
}

async function handleSubmit(action) {
  if (!form.reportValidity()) return;

  const buttons = formButtons.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));

  try {
    const result = await submitAs(action);
    const id = outageId || result.outage.id;
    window.location.href = `/outage.html?id=${id}`;
  } catch (err) {
    showAlert("error", err instanceof ApiError ? err.message : "Couldn't save. Check the form and try again.");
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function init() {
  const user = await requireUser();
  if (!user) return;

  if (outageId) {
    formTitle.textContent = "Edit outage";
    try {
      const { outage } = await api.getOutage(outageId);
      if (outage.author_id !== user.id) {
        showAlert("error", "You can only edit your own submissions.");
        form.style.display = "none";
        return;
      }
      fillForm(outage);
      renderButtons("edit", outage.status, isModerator(user));
      if (outage.outage_number) {
        formSubtitle.textContent = `Reference #${outage.outage_number}`;
      }
    } catch (err) {
      showAlert("error", err instanceof ApiError ? err.message : "Couldn't load this outage.");
      form.style.display = "none";
    }
  } else {
    renderButtons("create", "draft");
  }
}

init();
