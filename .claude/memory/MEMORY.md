# TheOutage — Persistent Memory

## Deployment (fully live, smoke-tested 2026-07-15)

- **URL**: `https://TheOutage.robcloud.qzz.io`
- **Repo**: `hkrob/theoutage` on GitHub (`main` branch)
- **Account ID**: `b1af7044f7979b0fcea7cfe0f1b0329a`
- **Zone**: `robcloud.qzz.io` (Zone ID: `230bc603c2c2bc59511672afe5016dff`)
- **API token** (wrangler OAuth, limited scope — no DNS edit): stored locally in `theoutage-api/deploy.sh`, not committed

### Components
- **Worker** `theoutage-api` — Hono/TypeScript, auto-deploys via Workers Builds on push to `main`. Route: `TheOutage.robcloud.qzz.io/*`. Serves static assets via `[assets]` binding pointing at `../theoutage-pages`.
- **Pages project** `theoutage` — static frontend, auto-deploys via Pages Git integration on push to `main`. Has `functions/api/[[path]].js` that proxies `/api/*` to Worker via `API_WORKER` service binding.
- **D1** `theoutage-db` (UUID: `e93c0b69-dd6b-4d51-a2e4-699c5ea460b8`) — schema fully applied, no wrangler migration tracking (see gotcha below).
- **R2** `theoutage-artifacts` — live and bound.
- **Resend sender domain**: `theoutage.robcloud.qzz.io` — verified. `RESEND_FROM_EMAIL` = `noreply@theoutage.robcloud.qzz.io`.

### Worker secrets (set via dashboard)
- `SESSION_HMAC_SECRET` — random hex, signs session cookies
- `RESEND_API_KEY` — set in dashboard (Resend key), not committed
- `RESEND_FROM_EMAIL` — `noreply@theoutage.robcloud.qzz.io`

## Key gotchas

1. **D1 migration tracking**: schema applied via direct API, not wrangler. `d1_migrations` table doesn't exist. Never run `wrangler d1 migrations apply --remote` — use `wrangler d1 execute theoutage-db --remote --file=...` for new migrations.
2. **D1 FTS5**: MATCH queries must use bare table name, not alias — `outages_fts MATCH ?` not `f MATCH ?`.
3. **PBKDF2**: 100k iterations ≈ 43ms, exceeds Workers Free 10ms budget. Password routes need Workers Paid ($5/mo). Magic-link auth unaffected.
4. **API token scope**: the `cfut_*` wrangler OAuth token has no DNS edit permissions. Use Cloudflare dashboard for DNS changes.
5. **Updating existing Worker secrets**: the wrangler OAuth token can't update secrets set via dashboard (error 10053). Use dashboard to update.
6. **Pages routing priority**: Cloudflare Pages custom-domain routing overrides zone Worker routes. The Pages Function `functions/api/[[path]].js` + `API_WORKER` service binding is what makes `/api/*` reach the Worker.

## Manual deploy (if auto-deploy breaks)

```bash
# Worker
cd theoutage-api
bash deploy.sh   # uses Cursor's node.exe + local wrangler

# Pages — trigger via Cloudflare API (use token from deploy.sh)
curl -X POST "https://api.cloudflare.com/client/v4/accounts/b1af7044f7979b0fcea7cfe0f1b0329a/pages/projects/theoutage/deployments" \
  -H "Authorization: Bearer <CF_TOKEN>"
```

`deploy.sh` uses `C:/Users/robadmin/AppData/Local/Programs/cursor/resources/app/resources/helpers/node.exe` (v22.22.0) with `node_modules/wrangler` installed locally in `theoutage-api/`. The node_modules has Windows-compatible binaries (`@esbuild/win32-x64`, `@cloudflare/workerd-windows-64`).

## Known gaps (build only if asked)

- No frontend page for `GET /api/moderation/log`
- Country dropdown in `theoutage-pages/js/constants.js` is hand-built, unverified
