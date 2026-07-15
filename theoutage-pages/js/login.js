import { api, ApiError } from "./api.js";
import { initNav } from "./nav.js";
import { alertHtml } from "./render.js";

initNav();

const alertArea = document.getElementById("alert-area");
const nextParam = new URLSearchParams(window.location.search).get("next") || "/";

function showAlert(kind, message) {
  alertArea.innerHTML = alertHtml(kind, message);
}

document.getElementById("magic-link-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("ml-email").value.trim();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await api.requestMagicLink(email);
    showAlert("success", "Check your inbox — we sent you a sign-in link. It expires in 15 minutes and works once.");
    e.target.reset();
  } catch (err) {
    showAlert("error", err instanceof ApiError ? err.message : "Something went wrong. Try again.");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("password-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("pw-email").value.trim();
  const password = document.getElementById("pw-password").value;
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await api.login(email, password);
    window.location.href = nextParam;
  } catch (err) {
    showAlert("error", err instanceof ApiError ? err.message : "Something went wrong. Try again.");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("forgot-link").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("reset-request-form").style.display = "block";
  e.target.style.display = "none";
});

document.getElementById("reset-request-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("reset-email").value.trim();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await api.requestPasswordReset(email);
    showAlert("success", "If that email is registered, a reset link is on its way.");
    e.target.reset();
  } catch (err) {
    showAlert("error", err instanceof ApiError ? err.message : "Something went wrong. Try again.");
  } finally {
    btn.disabled = false;
  }
});
