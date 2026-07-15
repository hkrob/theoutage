import type { Env } from "../types";

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function send(env: Env, args: SendArgs): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}

export async function sendMagicLinkEmail(env: Env, to: string, link: string): Promise<void> {
  await send(env, {
    to,
    subject: "Your TheOutage sign-in link",
    html: `<p>Click below to sign in to TheOutage. This link expires in ${env.MAGIC_LINK_TTL_MIN} minutes and can only be used once.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    text: `Sign in to TheOutage: ${link}\n(expires in ${env.MAGIC_LINK_TTL_MIN} minutes, single use)`,
  });
}

export async function sendAccountCreatedEmail(env: Env, to: string, link: string): Promise<void> {
  await send(env, {
    to,
    subject: "An account was created for you on TheOutage",
    html: `<p>An administrator created an account for you on TheOutage. Click below to sign in.</p><p><a href="${link}">${link}</a></p><p>This link expires in ${env.MAGIC_LINK_TTL_MIN} minutes and can only be used once — you can request a new sign-in link from the login page any time after that.</p>`,
    text: `An administrator created an account for you on TheOutage. Sign in here: ${link}\n(expires in ${env.MAGIC_LINK_TTL_MIN} minutes, single use — request a new link from the login page any time after that)`,
  });
}

export async function sendPasswordResetEmail(env: Env, to: string, link: string): Promise<void> {
  await send(env, {
    to,
    subject: "Reset your TheOutage password",
    html: `<p>Click below to set a new password. This link expires in ${env.MAGIC_LINK_TTL_MIN} minutes and can only be used once.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can ignore this email — your password won't change.</p>`,
    text: `Reset your TheOutage password: ${link}\n(expires in ${env.MAGIC_LINK_TTL_MIN} minutes, single use)`,
  });
}

// ------------------------------------------------------------------
// Moderation notifications — spec §9: author notified on approve/reject,
// commenter notified on removal.
// ------------------------------------------------------------------

export async function sendOutageApprovedEmail(
  env: Env,
  to: string,
  title: string,
  outageUrl: string
): Promise<void> {
  await send(env, {
    to,
    subject: `Your outage report "${title}" is now live`,
    html: `<p>Your submission was approved and is now public on TheOutage.</p><p><a href="${outageUrl}">${outageUrl}</a></p>`,
    text: `Your submission "${title}" was approved and is now live: ${outageUrl}`,
  });
}

export async function sendOutageRejectedEmail(
  env: Env,
  to: string,
  title: string,
  reason: string
): Promise<void> {
  await send(env, {
    to,
    subject: `Your outage report "${title}" needs changes`,
    html: `<p>Your submission wasn't approved.</p><p><strong>Reason:</strong> ${reason}</p><p>You can edit and resubmit it from your dashboard.</p>`,
    text: `Your submission "${title}" wasn't approved.\nReason: ${reason}\nYou can edit and resubmit it from your dashboard.`,
  });
}

export async function sendCommentRemovedEmail(env: Env, to: string, reason: string): Promise<void> {
  await send(env, {
    to,
    subject: "Your comment on TheOutage was removed",
    html: `<p>A moderator removed your comment.</p><p><strong>Reason:</strong> ${reason}</p>`,
    text: `A moderator removed your comment.\nReason: ${reason}`,
  });
}
