// Cloudflare Pages Function: same-origin /ogimage route.
//
// Mirrors functions/scrape.js: re-exports the Worker handler so a Pages
// deploy serves /ogimage?url=<page> on its own origin. The reader calls this
// lazily to fetch an OpenGraph lead image for feed items that ship none
// (e.g. Al Jazeera's RSS, which carries no per-item image). Configuration is
// identical to /fetch and /extract (PROXY_ALLOW, UA).

import worker from "../worker/src/index.js";

export const onRequest = ({ request, env }) => worker.fetch(request, env);
