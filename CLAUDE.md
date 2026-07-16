# TheOutage — Project Context for Claude Code

Outage-tracking web app: Cloudflare Pages (static frontend) + Cloudflare Workers (Hono API) + D1 (SQLite) + R2 (artifacts). Built against a full spec (`TheOutage-spec.md`) covering data model, auth, moderation workflow, and UI/UX. Repo: `hkrob/theoutage` on GitHub, auto-deploys to Cloudflare via Workers Builds (API) and Pages Git integration (frontend) on push to `main`.

## Layout

- `theoutage-api/` — Cloudflare Worker (Hono, TypeScript). Routes: `src/routes/{auth,outages,artifacts,comments,moderation,admin}.ts`. Libs: `src/lib/{crypto,session,email,rateLimit,constants,fts,outageAccess}.ts`. Middleware: `src/middleware/auth.ts`.
- `theoutage-pages/` — static site, no build step. Vanilla HTML/CSS/ES modules. Pages: `index.html` (feed), `outage.html` (detail), `submit.html` (create/edit), `dashboard.html` (my submissions — also used by admins to view any user's submissions via `?author_id=`), `admin.html` (user management, admin-only), `guide.html` (field/workflow explainer, public), `login.html`, `reset-password.html`, `auth-callback.html`.
- `theoutage-api/migrations/0001_init.sql`, `0002_rate_limits.sql` — schema reference copies.
- `DEPLOYMENT.md` — full runbook (read this first for deploy/ops questions).

## Deployment status — fully live and smoke-tested

Everything is live and all smoke-test flows have been verified end-to-end:
- D1 `theoutage-db` — schema applied and exercised end-to-end.
- R2 `theoutage-artifacts` — bucket live, bound.
- Worker `theoutage-api` — deployed via Cloudflare Workers Builds (GitHub-connected, auto-deploys on push to `main`). Route: `TheOutage.robcloud.qzz.io/*` (full host, serves static assets too via `[assets]` binding).
- Pages project `theoutage` — deployed via Pages Git integration. Has `functions/api/[[path]].js` that proxies `/api/*` to the Worker via `API_WORKER` service binding.
- Custom domain `TheOutage.robcloud.qzz.io` — attached to the Pages project.
- Worker secrets (`SESSION_HMAC_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`) — set via dashboard. `RESEND_FROM_EMAIL` is `noreply@theoutage.robcloud.qzz.io` (verified Resend domain).
- Resend sender domain `theoutage.robcloud.qzz.io` — verified (DKIM + SPF records in Cloudflare DNS).

**Smoke-test checklist (DEPLOYMENT.md §5) — all passed:** feed loads, magic-link login, draft→submit→approve→feed, image upload/thumbnail, comment, moderator reject + Resend email confirmed.

## Known gotchas — read before touching these areas

1. **D1 migrations tracking gap**: the schema was applied via direct API calls, not `wrangler d1 migrations apply`. The `d1_migrations` bookkeeping table doesn't exist on `theoutage-db`. Do **not** run `wrangler d1 migrations apply theoutage-db --remote` — it will try to re-run `0001_init.sql`/`0002_rate_limits.sql` and fail on "table already exists". For new schema changes, use `wrangler d1 execute theoutage-db --remote --file=migrations/000N_whatever.sql` directly. Full recovery path (if you want proper migration tracking later) is in `DEPLOYMENT.md`.
2. **D1 FTS5 quirk**: `outages_fts` MATCH queries must use the bare table name, not an alias — `JOIN outages_fts f ON f.rowid = o.id AND f MATCH ?` throws "no such column: f" on live D1 (works fine in stock SQLite). See `src/routes/outages.ts`.
3. **PBKDF2 CPU cost**: 100k iterations ≈ 43ms measured CPU, which exceeds the Workers **Free** plan's 10ms/request budget. `/login`, `/set-password`, `/password-reset/confirm` may throw Cloudflare error 1102 until upgraded to Workers Paid ($5/mo). Magic-link auth (default path) is unaffected.
4. **Hono param typing**: `c.req.param("id")` types as `string | undefined` in handlers registered via multi-arg chains — use `c.req.param("id") ?? ""` consistently (already applied throughout).
5. **Same-origin deployment assumption**: the Worker is mounted on the same zone/host as the Pages site specifically so the session cookie can stay `SameSite=Lax` with no CORS needed. Don't split them onto separate subdomains without adding CORS middleware and switching to `SameSite=None; Secure`.

## Known gaps (not yet built, only build if asked)

- No frontend page for `GET /api/moderation/log` (the audit trail) — the API route exists and works.
- Country dropdown in `theoutage-pages/js/constants.js` is a hand-built ISO 3166-1 alpha-2 list — not verified against an authoritative source.

## Conventions used throughout

- Zod for all request validation.
- Session auth via signed HttpOnly cookies (HMAC-SHA256 via Web Crypto).
- Moderator/admin-only routes gated with `requireRole(...)` middleware in `src/middleware/auth.ts`.
- Moderation actions (`approve`/`reject`/`remove comment`) write to `moderation_log` and best-effort send a Resend email — email failures must never roll back the moderation action itself (see `notifyBestEffort` wrapper in `src/routes/moderation.ts`).
- Admin user-management actions (role change, freeze/unfreeze, reset access, verify email, create/delete user) also write to `moderation_log` — same audit trail as moderation actions, just a wider `action` enum. Adding a new admin action means a migration widening that CHECK constraint (see `theoutage-api/migrations/0005`–`0008` for the pattern).
- **`theoutage-pages/guide.html` explains every outage field and the submission workflow to end users — keep it in sync whenever a field, role capability, or workflow step changes.** It's not derived from code automatically; if you add/remove an outage field or change how moderation/admin works, update the guide in the same change.
