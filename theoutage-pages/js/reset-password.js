import { api, ApiError } from "./api.js";
import { initNav } from "./nav.js";
import { alertHtml } from "./render.js";

initNav();

const alertArea = document.getElementById("alert-area");
const token = new URLSearchParams(window.location.search).get("token");

function showAlert(kind, message) {
  alertArea.innerHTML = alertHtml(kind, message);
}

if (!token) {
  showAlert("error", "This link is missing its reset token. Request a new one from the login page.");
  document.getElementById("form-card").style.display = "none";
}

document.getElementById("reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = document.getElementById("password").value;
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await api.confirmPasswordReset(token, password);
    showAlert("success", "Password set. You can now log in with it.");
    document.getElementById("form-card").style.display = "none";
    setTimeout(() => (window.location.href = "/login.html"), 1500);
  } catch (err) {
    showAlert("error", err instanceof ApiError ? err.message : "That link may have expired. Request a new one.");
  } finally {
    btn.disabled = false;
  }
});
