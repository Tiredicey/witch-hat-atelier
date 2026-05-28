// functions/fetch.js
//
// Cloudflare Pages Function that re-exports the Worker's /fetch route on
// the same origin as the deployed site (e.g. witch-hat-atelier.pages.dev).
//
// Filename-based routing maps this file to GET https://<site>/fetch — the
// same path the standalone Worker uses. The browser app therefore hits a
// same-origin URL with no extra hop, no CORS preflight cost, and no extra
// hostname to remember.
//
// Configuration: in the Cloudflare dashboard go to Pages → your project →
// Settings → Environment variables, then add:
//   PROXY_ALLOW   "*" or a comma-separated list of URL prefixes
//   MAX_BYTES     optional, default 5000000
//   UA            optional, default "CODA/0.1 (+repo url)"
//
// The Worker's fetch() handler dispatches by pathname, so this same file
// also passes OPTIONS preflight through to the Worker's existing CORS
// handler. /healthz and POST /parse are deliberately not exposed here —
// only /fetch. To expose those, add additional files under functions/.

import worker from "../worker/src/index.js";

export const onRequest = ({ request, env }) => worker.fetch(request, env);
