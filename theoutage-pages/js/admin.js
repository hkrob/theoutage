import { api, ApiError } from "./api.js";
import { requireAdmin } from "./nav.js";
import { escapeHtml, formatDate, formatBytes, alertHtml, emptyState } from "./render.js";

const alertArea = document.getElementById("admin-alert-area");
const area = document.getElementById("admin-users-area");
const searchInput = document.getElementById("user-search");
const showCreateUserBtn = document.getElementById("show-create-user-btn");
const cancelCreateUserBtn = document.getElementById("cancel-create-user-btn");
const createUserForm = document.getElementById("create-user-form");

let currentUser = null;
let searchDebounce = null;

function showAlert(kind, message) {
  alertArea.innerHTML = alertHtml(kind, message);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const ROLES = ["user", "moderator", "admin"];

function roleBadge(role) {
  if (role === "admin") return `<span class="badge badge-role-admin">admin</span>`;
  if (role === "moderator") return `<span class="badge badge-role-moderator">moderator</span>`;
  return `<span class="badge badge-category">user</span>`;
}

function rowHtml(u) {
  const isSelf = currentUser && u.id === currentUser.id;

  return `
    <div class="outage-card" data-user-id="${u.id}">
      <div class="outage-card-body">
        <div class="outage-card-top">
          ${roleBadge(u.role)}
          ${u.frozen ? `<span class="badge badge-frozen">frozen</span>` : ""}
          ${!u.email_verified ? `<span class="badge badge-unverified">unverified</span>` : ""}
        </div>
        <h3 class="outage-card-title">${escapeHtml(u.display_name)}</h3>
        <div class="outage-card-meta">
          <span class="text-secondary">${escapeHtml(u.email)}</span>
          <span class="mono">joined ${formatDate(u.created_at)}</span>
        </div>
        <div class="outage-card-meta">
          <span class="text-muted">${u.outage_count} submission${u.outage_count === 1 ? "" : "s"}</span>
          <span class="text-muted">${formatBytes(u.storage_bytes)} uploaded</span>
        </div>
      </div>
      <div class="admin-user-actions">
        <select class="role-select" data-id="${u.id}" ${isSelf ? "disabled" : ""}>
          ${ROLES.map((r) => `<option value="${r}" ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}
        </select>
        ${!u.email_verified ? `<button class="btn btn-sm verify-email-btn" data-id="${u.id}" type="button">Verify email</button>` : ""}
        ${
          isSelf
            ? `<span class="text-muted" style="font-size: var(--text-xs); text-align:center;">(you)</span>`
            : `
              ${
                u.frozen
                  ? `<button class="btn btn-sm unfreeze-btn" data-id="${u.id}" type="button">Unfreeze</button>`
                  : `<button class="btn btn-sm btn-danger freeze-btn" data-id="${u.id}" type="button">Freeze</button>`
              }
              <button class="btn btn-sm reset-access-btn" data-id="${u.id}" type="button">Reset access</button>
            `
        }
      </div>
    </div>
  `;
}

async function load(q) {
  try {
    const { results } = await api.listUsers({ q, pageSize: 100 });
    if (results.length === 0) {
      area.innerHTML = emptyState(q ? "No users match that search." : "No users yet.");
      return;
    }
    area.innerHTML = results.map(rowHtml).join("");
    wireRowEvents();
  } catch (err) {
    area.innerHTML = alertHtml("error", err instanceof ApiError ? err.message : "Couldn't load users.");
  }
}

function wireRowEvents() {
  document.querySelectorAll(".role-select").forEach((select) => {
    const original = select.value;
    select.addEventListener("change", async () => {
      const id = select.dataset.id;
      const role = select.value;
      if (!confirm(`Change this user's access level to "${role}"?`)) {
        select.value = original;
        return;
      }
      select.disabled = true;
      try {
        await api.setUserRole(id, role);
        showAlert("success", "Access level updated.");
        await load(searchInput.value.trim());
      } catch (err) {
        showAlert("error", err instanceof ApiError ? err.message : "Couldn't update access level.");
        select.value = original;
        select.disabled = false;
      }
    });
  });

  document.querySelectorAll(".verify-email-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api.verifyUserEmail(btn.dataset.id);
        showAlert("success", "Email marked verified.");
        await load(searchInput.value.trim());
      } catch (err) {
        showAlert("error", err instanceof ApiError ? err.message : "Couldn't verify email.");
        btn.disabled = false;
      }
    })
  );

  document.querySelectorAll(".freeze-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Freeze this account? They'll be signed out and unable to log in until unfrozen.")) return;
      btn.disabled = true;
      try {
        await api.freezeUser(btn.dataset.id);
        showAlert("success", "Account frozen.");
        await load(searchInput.value.trim());
      } catch (err) {
        showAlert("error", err instanceof ApiError ? err.message : "Couldn't freeze account.");
        btn.disabled = false;
      }
    })
  );

  document.querySelectorAll(".unfreeze-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api.unfreezeUser(btn.dataset.id);
        showAlert("success", "Account unfrozen.");
        await load(searchInput.value.trim());
      } catch (err) {
        showAlert("error", err instanceof ApiError ? err.message : "Couldn't unfreeze account.");
        btn.disabled = false;
      }
    })
  );

  document.querySelectorAll(".reset-access-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (
        !confirm(
          "Reset this account's access? This clears their password and signs them out of all sessions — they'll need to sign in again via magic link."
        )
      )
        return;
      btn.disabled = true;
      try {
        await api.resetUserAccess(btn.dataset.id);
        showAlert("success", "Access reset. The user has been signed out everywhere.");
      } catch (err) {
        showAlert("error", err instanceof ApiError ? err.message : "Couldn't reset access.");
      } finally {
        btn.disabled = false;
      }
    })
  );
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => load(searchInput.value.trim()), 300);
});

showCreateUserBtn.addEventListener("click", () => {
  createUserForm.style.display = "block";
  showCreateUserBtn.style.display = "none";
  document.getElementById("new-user-email").focus();
});

cancelCreateUserBtn.addEventListener("click", () => {
  createUserForm.reset();
  createUserForm.style.display = "none";
  showCreateUserBtn.style.display = "";
});

createUserForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("new-user-email").value.trim();
  const display_name = document.getElementById("new-user-display-name").value.trim();
  const role = document.getElementById("new-user-role").value;
  if (!email) return;

  const btn = createUserForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await api.createUser({ email, display_name: display_name || undefined, role });
    showAlert("success", `Account created. A sign-in link was emailed to ${email}.`);
    createUserForm.reset();
    createUserForm.style.display = "none";
    showCreateUserBtn.style.display = "";
    await load(searchInput.value.trim());
  } catch (err) {
    showAlert("error", err instanceof ApiError ? err.message : "Couldn't create the account.");
  } finally {
    btn.disabled = false;
  }
});

async function init() {
  currentUser = await requireAdmin();
  if (!currentUser) return;
  await load("");
}

init();
