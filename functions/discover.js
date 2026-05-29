// Cloudflare Pages Function: same-origin /discover proxy.
//
// Mirrors functions/fetch.js: re-exports the Worker handler so a Pages
// deploy serves `/discover?url=…` on its own origin without a separate
// Worker subdomain. Configuration variables are identical to /fetch
// (PROXY_ALLOW, MAX_BYTES, UA); see functions/fetch.js for the list.

import worker from "../worker/src/index.js";

export const onRequest = ({ request, env }) => worker.fetch(request, env);
