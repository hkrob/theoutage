/**
 * Pages Function: /api/[[path]]
 *
 * Forwards all /api/* requests to the theoutage-api Worker via a service
 * binding (bound as API_WORKER in the Pages project's production settings).
 * This is needed because Cloudflare Pages custom-domain routing takes priority
 * over zone-based Worker routes, so the Worker route alone cannot intercept
 * /api/* traffic on the Pages custom domain.
 *
 * The service binding is configured in the Cloudflare dashboard (or via API):
 *   Pages project "theoutage" → Settings → Bindings → Service bindings
 *   Variable name: API_WORKER → Service: theoutage-api (production)
 */
export async function onRequest(context) {
  const { request, env } = context;
  return env.API_WORKER.fetch(request);
}
