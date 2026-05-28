// Cloudflare Pages Function: same-origin /fetch proxy.
//
// This file makes the deployed site serve `/fetch?url=<feed>` on its own
// origin (e.g. https://witch-hat-atelier.pages.dev/fetch) by re-exporting
// the existing Worker handler from `worker/src/index.js`. No separate
// Worker deployment is required: dropping this file in `functions/` is
// enough — Cloudflare Pages auto-bundles and routes it.
//
// Configure these Pages environment variables in the Cloudflare dashboard
// (Pages project → Settings → Environment variables):
//
//   PROXY_ALLOW   "*"  to allow any public http(s) feed, or a comma-
//                      separated list of URL prefixes the site is allowed
//                      to fetch (e.g. "https://www.mnot.net/, https://www.jsonfeed.org/").
//                      Unset / empty leaves the route disabled (403).
//   MAX_BYTES     Optional. Default 5_000_000 (matches ROADMAP §11 risk 8).
//   UA            Optional. Default identifies as CODA with the repo URL.
//
// See docs/deploy-anywhere.md for alternative providers (Workers,
// Deno Deploy, Vercel Edge, Netlify Edge, plain Node) and how the same
// handler runs on each.

import worker from "../worker/src/index.js";

export const onRequest = ({ request, env }) => worker.fetch(request, env);
