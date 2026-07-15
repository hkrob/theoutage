# TheOutage — Deployment Runbook

Everything reachable through the Cloudflare API has already been provisioned and verified against the live account. What's left needs `wrangler` CLI access and your Cloudflare dashboard (custom domains, secrets), which isn't something I can do through the API tools available here.

## Already done, live, and verified

- **D1**: `theoutage-db` (`e93c0b69-dd6b-4d51-a2e4-699c5ea460b8`) — full schema applied (users, sessions, auth_tokens, outages, artifacts, comments, moderation_log, rate_limits, outages_fts + sync triggers), exercised end-to-end against real data for every flow (auth, CRUD, moderation).
- **R2**: `theoutage-artifacts` bucket created, bound in `wrangler.toml`.
- **Code**: `theoutage-api/` (Workers, Hono) and `theoutage-pages/` (static Pages site) — both typechecked, cross-checked against each other's contract, and the Worker's business logic smoke-tested against live D1.

## ⚠️ One gotcha before you touch migrations again

The D1 schema was applied via direct API calls, **not** `wrangler d1 migrations apply`. That means the `d1_migrations` bookkeeping table Wrangler uses to track "what's already been run" doesn't exist yet on the live database.

**Do not run** `wrangler d1 migrations apply theoutage-db --remote` as-is — it will try to re-run `0001_init.sql` and `0002_rate_limits.sql` from scratch and fail with "table already exists" errors, since those tables are already there.

If you want Wrangler's migration tracking for *future* schema changes, the safe path is:
1. Run `wrangler d1 migrations apply theoutage-db --remote` once against a **throwaway test database** to see the exact `d1_migrations` table it creates.
2. Recreate that same table on `theoutage-db` and manually insert rows marking `0001_init.sql` and `0002_rate_limits.sql` as already applied.
3. From then on, `wrangler d1 migrations apply` will correctly pick up only new migration files.

Or simpler: just keep applying future schema changes the same way I did (`wrangler d1 execute theoutage-db --remote --file=migrations/000N_whatever.sql`) and skip the tracking table entirely.

## 1. Deploy the API Worker

```bash
cd theoutage-api
npm install
npx wrangler login   # if not already authenticated
```

Set secrets (prompted interactively, nothing written to disk):

```bash
npx wrangler secret put SESSION_HMAC_SECRET   # generate with: openssl rand -hex 32
npx wrangler secret put RESEND_API_KEY        # from your Resend dashboard
npx wrangler secret put RESEND_FROM_EMAIL     # a verified sender on your Resend domain,
                                                # e.g. noreply@TheOutage.robcloud.qzz.io
```

Before deploying, open `wrangler.toml` and confirm `[[routes]] zone_name` matches your zone **exactly** as it appears in the Cloudflare dashboard — I set it to `robcloud.qzz.io`, double-check that's right.

```bash
npx wrangler deploy
```

## 2. Deploy the Pages frontend

No build step — it's plain HTML/CSS/JS.

```bash
cd theoutage-pages
npx wrangler pages deploy . --project-name=theoutage-pages
```

(Or connect the folder via the dashboard: Workers & Pages → Create → Pages → Direct upload / Git.)

## 3. Attach the custom domain

- Pages project → Custom domains → add `TheOutage.robcloud.qzz.io`.
- The Worker route `TheOutage.robcloud.qzz.io/api/*` (already in `wrangler.toml`) takes priority over Pages for that path prefix on the same zone, so API calls go to the Worker and everything else falls through to the static site. No separate API subdomain needed.

## 4. Promote a moderator

There's no UI for this (the spec didn't call for one — role is just a DB flag):

```bash
npx wrangler d1 execute theoutage-db --remote --command "UPDATE users SET role='moderator' WHERE email='you@example.com'"
```

Note: that user has to exist first — sign up via magic link once, then promote.

## 5. Smoke-test checklist

- [ ] Visit `https://TheOutage.robcloud.qzz.io` — empty feed loads
- [ ] `/login.html` → request a magic link → check inbox → click through → lands on `/auth-callback.html` → redirected home, logged in
- [ ] `/submit.html` → save a draft → appears on `/dashboard.html`
- [ ] Submit that draft for review → log in as the moderator you promoted → approve it → appears on the public feed
- [ ] Upload an image attachment on your own outage → thumbnail appears on the feed card
- [ ] Post a comment on a published outage → shows up immediately (post-moderated)
- [ ] As moderator, reject a different pending outage with a reason → author would receive a Resend email (check Resend's dashboard logs if you don't have a real inbox to check)

## Known limitations, carried over from the build

- **PBKDF2 password hashing** (100k iterations, ~43ms measured) likely exceeds the Workers **Free** plan's 10ms/request CPU budget. Magic-link auth (the default, spec-preferred path) is unaffected. `/login`, `/set-password`, and `/password-reset/confirm` may throw Cloudflare error 1102 until you're on Workers **Paid** ($5/mo, 30s CPU budget).
- **No frontend for the moderation audit log.** `GET /api/moderation/log` exists and works (moderator/admin only), there's just no page rendering it yet.
- **Country dropdown** is a hand-built ISO 3166-1 alpha-2 list in `theoutage-pages/js/constants.js` — spot-check it if precision matters for your use case.
