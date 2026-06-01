// Cloudflare Pages Function: same-origin /fb/* OAuth + Graph routes.
//
// Mirrors functions/dmz/[[path]].js: re-exports the Worker handler so a
// Pages deploy serves /fb/login, /fb/callback, and /fb/feed on its own
// origin. Config variables (FB_APP_ID, FB_APP_SECRET, FB_REDIRECT_URI,
// optional FB_GRAPH_VERSION) live on the Pages project; see
// docs/facebook-connect.md and ROADMAP §19.

import worker from "../../worker/src/index.js";

export const onRequest = ({ request, env }) => worker.fetch(request, env);
