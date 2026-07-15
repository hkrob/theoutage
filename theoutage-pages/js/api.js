// Thin fetch wrapper over the theoutage-api Worker. Assumes same-origin
// deployment (Worker bound to this Pages site's /api/* route — see
// theoutage-api/wrangler.toml), so no CORS handling is needed and cookies
// travel automatically.

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function qs(params) {
  if (!params) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

async function apiFetch(path, { method = "GET", body, headers = {} } = {}) {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: isFormData ? headers : { "Content-Type": "application/json", ...headers },
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }

  return data;
}

export const api = {
  // ---- auth ----
  requestMagicLink: (email) => apiFetch("/auth/magic-link", { method: "POST", body: { email } }),
  login: (email, password) => apiFetch("/auth/login", { method: "POST", body: { email, password } }),
  logout: () => apiFetch("/auth/logout", { method: "POST" }),
  me: () => apiFetch("/auth/me"),
  requestPasswordReset: (email) =>
    apiFetch("/auth/password-reset/request", { method: "POST", body: { email } }),
  confirmPasswordReset: (token, password) =>
    apiFetch("/auth/password-reset/confirm", { method: "POST", body: { token, password } }),
  setPassword: (currentPassword, newPassword) =>
    apiFetch("/auth/set-password", { method: "POST", body: { currentPassword, newPassword } }),

  // ---- outages ----
  listOutages: (params) => apiFetch(`/outages${qs(params)}`),
  getOutage: (id) => apiFetch(`/outages/${id}`),
  createOutage: (payload) => apiFetch("/outages", { method: "POST", body: payload }),
  updateOutage: (id, payload) => apiFetch(`/outages/${id}`, { method: "PATCH", body: payload }),
  deleteOutage: (id) => apiFetch(`/outages/${id}`, { method: "DELETE" }),

  // ---- artifacts ----
  listArtifacts: (outageId) => apiFetch(`/outages/${outageId}/artifacts`),
  uploadArtifact: (outageId, file, caption) => {
    const form = new FormData();
    form.append("file", file);
    if (caption) form.append("caption", caption);
    return apiFetch(`/outages/${outageId}/artifacts`, { method: "POST", body: form });
  },
  deleteArtifact: (artifactId) => apiFetch(`/artifacts/${artifactId}`, { method: "DELETE" }),
  setPrimaryArtifact: (artifactId) =>
    apiFetch(`/artifacts/${artifactId}`, { method: "PATCH", body: { is_primary: true } }),
  artifactFileUrl: (artifactId) => `/api/artifacts/${artifactId}/file`,

  // ---- comments ----
  listComments: (outageId, params) => apiFetch(`/outages/${outageId}/comments${qs(params)}`),
  createComment: (outageId, body) => apiFetch(`/outages/${outageId}/comments`, { method: "POST", body: { body } }),

  // ---- moderation ----
  approveOutage: (id) => apiFetch(`/moderation/outages/${id}/approve`, { method: "POST" }),
  rejectOutage: (id, reason) => apiFetch(`/moderation/outages/${id}/reject`, { method: "POST", body: { reason } }),
  removeComment: (id, reason, internal_note) =>
    apiFetch(`/moderation/comments/${id}/remove`, { method: "POST", body: { reason, internal_note } }),
  moderationLog: (params) => apiFetch(`/moderation/log${qs(params)}`),

  // ---- admin ----
  listUsers: (params) => apiFetch(`/admin/users${qs(params)}`),
  createUser: (payload) => apiFetch("/admin/users", { method: "POST", body: payload }),
  setUserRole: (id, role) => apiFetch(`/admin/users/${id}/role`, { method: "PATCH", body: { role } }),
  freezeUser: (id) => apiFetch(`/admin/users/${id}/freeze`, { method: "POST" }),
  unfreezeUser: (id) => apiFetch(`/admin/users/${id}/unfreeze`, { method: "POST" }),
  resetUserAccess: (id) => apiFetch(`/admin/users/${id}/reset-access`, { method: "POST" }),
};
