import { initNav } from "./nav.js";

const params = new URLSearchParams(window.location.search);
const status = params.get("status");
const reason = params.get("reason");
const el = document.getElementById("callback-message");

const REASON_MESSAGES = {
  missing_token: "That link is missing its token.",
  invalid_or_expired: "That link is invalid or has expired — magic links are single-use and expire after 15 minutes.",
  account_frozen: "This account has been frozen. Contact support.",
};

if (status === "ok") {
  el.textContent = "You're signed in. Redirecting…";
  initNav().then(() => {
    setTimeout(() => (window.location.href = "/"), 800);
  });
} else {
  el.innerHTML = `
    ${REASON_MESSAGES[reason] || "That sign-in link didn't work."}
    <br /><br />
    <a href="/login.html">Request a new link</a>
  `;
  initNav();
}
