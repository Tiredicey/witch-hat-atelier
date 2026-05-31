// Cloudflare Pages Function: same-origin /scrape synthetic-feed route.
//
// Mirrors functions/discover.js and functions/fetch.js: re-exports the
// Worker handler so a Pages deploy serves `/scrape?url=<page>&sel=<class>`
// on its own origin. The synthetic-feed candidate that /discover returns
// points here, so this file must exist for that candidate to resolve on a
// Pages deployment. Configuration variables are identical to /fetch
// (PROXY_ALLOW, MAX_BYTES, UA); see functions/fetch.js for the list.

import worker from "../worker/src/index.js";

export const onRequest = ({ request, env }) => worker.fetch(request, env);
