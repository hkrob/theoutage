import { api } from "./api.js";

function escapeText(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

/** Populates #nav-auth-area based on session state. Returns the user (or null). */
export async function initNav() {
  const mount = document.getElementById("nav-auth-area");

  try {
    const { user } = await api.me();

    if (mount) {
      if (user) {
        mount.innerHTML = `
          <a href="/guide.html">Guide</a>
          <a href="/submit.html">Submit outage</a>
          <a href="/dashboard.html">My submissions</a>
          ${user.role === "admin" ? `<a href="/admin.html">Admin</a>` : ""}
          <span class="text-secondary">${escapeText(user.display_name)}</span>
          <button class="btn btn-sm" id="logout-btn" type="button">Log out</button>
        `;
        const btn = document.getElementById("logout-btn");
        btn?.addEventListener("click", async () => {
          await api.logout().catch(() => {});
          window.location.href = "/";
        });
      } else {
        mount.innerHTML = `<a href="/guide.html">Guide</a> <a href="/login.html">Log in</a>`;
      }
    }

    return user;
  } catch {
    if (mount) mount.innerHTML = `<a href="/login.html">Log in</a>`;
    return null;
  }
}

/** Redirects to /login.html (preserving return path) if not logged in. */
export async function requireUser() {
  const user = await initNav();
  if (!user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login.html?next=${next}`;
    return null;
  }
  return user;
}

export function isModerator(user) {
  return !!user && (user.role === "moderator" || user.role === "admin");
}

export function isAdmin(user) {
  return !!user && user.role === "admin";
}

/** Redirects to / (silently, no error shown) if not an admin. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!user) return null;
  if (!isAdmin(user)) {
    window.location.href = "/";
    return null;
  }
  return user;
}
