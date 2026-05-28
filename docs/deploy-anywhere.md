# Deploy the `/fetch` proxy anywhere

The Worker's `fetch(req, env)` handler is plain Web-Standards code — `Request`, `Response`, `URL`, `fetch`, `AbortController`, `setTimeout`. That means the same handler runs unchanged on Cloudflare Workers, Cloudflare Pages Functions, Deno Deploy, Vercel Edge, Netlify Edge, and Node 20+ on any VM. Each provider just needs a tiny shim that hands the incoming request to the handler.

This page lists working recipes for each. Pick one — you only need to deploy in **one** place. All quoted free-tier numbers below are linked back to the provider's own pricing or limits page; double-check them at deploy time, since free tiers move.

> The browser app currently lives at `https://witch-hat-atelier.pages.dev/`. The **lowest-friction** option for this deployment is the Cloudflare Pages Function in §1 — it puts `/fetch` on the same origin as the site, no separate worker, no cross-origin call.

---

## 1. Cloudflare Pages Function (recommended for `pages.dev`)

The repo already contains `functions/fetch.js`, which re-exports the Worker handler. Once you push to the connected GitHub repo, Cloudflare Pages auto-deploys it as `/fetch` on the same origin as the site.

### 1.1 Set environment variables

Cloudflare dashboard → your Pages project → **Settings** → **Environment variables** → **Production** (and **Preview** if you want it on preview deploys too):

| Variable      | Value (example)                                | Required |
|---------------|------------------------------------------------|----------|
| `PROXY_ALLOW` | `*` (any feed) or `https://www.mnot.net/, https://www.jsonfeed.org/` (allowlist) | yes — unset means 403 |
| `MAX_BYTES`   | `5000000` (default; matches ROADMAP §11 risk 8) | no |
| `UA`          | `CODA/0.1 (+https://github.com/Tiredicey/witch-hat-atelier)` (default) | no |

### 1.2 Verify

```bash
curl -i 'https://witch-hat-atelier.pages.dev/fetch?url=https://www.jsonfeed.org/feed.json'
```

Expected: `200 OK`, `Access-Control-Allow-Origin: *`, original `Content-Type`, body unchanged.

### 1.3 Free-tier limits

Cloudflare Pages Functions share the Workers Free plan quota: **100,000 requests per day, combined across Pages Functions and Workers calls** ([Cloudflare Pages pricing docs, 2026-04-21][cf-pages-pricing]). Static asset requests don't count toward this. The daily counter resets at 00:00 UTC.

[cf-pages-pricing]: https://developers.cloudflare.com/pages/functions/pricing/

---

## 2. Standalone Cloudflare Worker

Use this if you want the proxy on a dedicated `*.workers.dev` subdomain (separate from the Pages site). The setup matches `worker/README.md` — this section just documents the proxy-specific env vars.

```bash
cd worker
npm install
npx wrangler login
# Edit wrangler.toml: bucket_name, FEEDS. Then add to [vars]:
#   PROXY_ALLOW = "*"
#   MAX_BYTES   = "5000000"
npx wrangler deploy
```

The Worker exposes `/fetch`, `/parse`, `/healthz`, and the cron-driven snapshot writer. Free-tier daily cap is **100,000 requests per day** ([Cloudflare Workers limits, 2026-04-23][cf-workers-limits]).

[cf-workers-limits]: https://developers.cloudflare.com/workers/platform/limits/

---

## 3. Vercel Edge Function

The same handler runs on Vercel's Edge runtime. Create one file:

```js
// api/fetch.js
import worker from "../worker/src/index.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  return worker.fetch(req, process.env);
}
```

Set `PROXY_ALLOW`, `MAX_BYTES`, `UA` in **Project settings → Environment Variables** in the Vercel dashboard. Deploy via `vercel --prod` or by connecting the GitHub repo.

Vercel Hobby (free) includes **1,000,000 edge-function invocations per month** ([Vercel Hobby plan docs][vercel-hobby]).

[vercel-hobby]: https://vercel.com/docs/plans/hobby

---

## 4. Netlify Edge Function

```js
// netlify/edge-functions/fetch.js
import worker from "../../worker/src/index.js";

export default async (request, context) => {
  const env = {
    PROXY_ALLOW: Netlify.env.get("PROXY_ALLOW") || "",
    MAX_BYTES:   Netlify.env.get("MAX_BYTES")   || "",
    UA:          Netlify.env.get("UA")          || "",
  };
  return worker.fetch(request, env);
};

export const config = { path: "/fetch" };
```

Free plan includes **1,000,000 edge function invocations per month and 100 GB bandwidth** ([Netlify Free plan announcement, 2024-11][netlify-free]); confirm against the current dashboard before relying on it.

[netlify-free]: https://www.netlify.com/blog/introducing-netlify-free-plan/

---

## 5. Deno Deploy

Deno's runtime exposes Web-Standards `fetch` / `Request` / `Response` directly. The shim is one file:

```ts
// deno-entry.ts
import worker from "./worker/src/index.js";

Deno.serve(req => worker.fetch(req, Deno.env.toObject()));
```

Deploy with `deployctl deploy --entrypoint deno-entry.ts` after setting `PROXY_ALLOW` etc. in the Deno Deploy dashboard. Check the current [Deno Deploy pricing](https://deno.com/deploy/pricing) for free-tier specifics — they have moved during 2024–2026 and aren't worth quoting from memory.

---

## 6. Plain Node 20+ on any VM (Oracle Cloud, Render, your own box)

Node 20 ships `fetch`, `Request`, `Response`, `AbortController`, and `URL` as globals. The Worker handler runs unchanged behind a thin HTTP adapter:

```js
// server.js
import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import worker from "./worker/src/index.js";

const port = Number(process.env.PORT) || 8787;

createServer(async (nodeReq, nodeRes) => {
  const url = `http://${nodeReq.headers.host || "localhost"}${nodeReq.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(nodeReq.headers)) {
    if (Array.isArray(v)) headers.set(k, v.join(","));
    else if (v != null)   headers.set(k, v);
  }
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(nodeReq.method);
  const body = hasBody ? await readBody(nodeReq) : undefined;
  const req = new Request(url, { method: nodeReq.method, headers, body });

  const resp = await worker.fetch(req, process.env);
  nodeRes.statusCode = resp.status;
  resp.headers.forEach((v, k) => nodeRes.setHeader(k, v));
  if (resp.body) {
    const buf = Buffer.from(await resp.arrayBuffer());
    nodeRes.end(buf);
  } else {
    nodeRes.end();
  }
}).listen(port, () => console.log(`proxy listening on :${port}`));

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
```

Run: `PROXY_ALLOW='*' node server.js`. Suitable for:

- **Oracle Cloud Always Free** — 2 AMD VMs + 4 ARM Ampere cores forever, [terms here](https://www.oracle.com/cloud/free/). Stable since 2021.
- **Render** — free web services with cold-start (spins down after inactivity). Verify current limits at [render.com/pricing](https://render.com/pricing) before depending on it.
- **Fly.io** — **note:** Fly removed the prior always-free allowance in 2024; current pricing requires a credit card on file ([fly.io pricing](https://fly.io/docs/about/pricing/)). Listed for completeness, not as a free option.

---

## 7. GitHub Actions for the cron path (not the proxy)

`/fetch` is a server-side route — it needs an always-on HTTP endpoint, which GitHub Actions does not provide. But the **cron snapshot path** (the `scheduled()` handler in `worker/src/index.js` that polls feeds and writes `coda/feeds/snapshot.json`) does fit GitHub Actions perfectly: a cron-triggered workflow can run a Node script that calls the parse modules and commits the snapshot back to the repo via the existing `GitHubAdapter`.

This is a documented follow-up, not part of this PR's runtime code. Sketch of the workflow:

```yaml
# .github/workflows/feed-snapshot.yml  (FOLLOW-UP, not shipped yet)
name: Feed snapshot
on:
  schedule: [{ cron: "*/30 * * * *" }]
  workflow_dispatch:
permissions:
  contents: write
jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: node scripts/snapshot.js  # writes coda/feeds/snapshot.json to the repo
      - run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add coda/feeds/
          git diff --quiet --cached || git commit -m "chore(feeds): snapshot $(date -u +%FT%TZ)"
          git push
```

GitHub Actions is **free for public repositories on standard GitHub-hosted runners and unlimited for self-hosted runners** ([GitHub Actions billing docs][gha-billing]). Private repos get a monthly minute quota that varies by plan.

[gha-billing]: https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions

The follow-up PR will add `scripts/snapshot.js`, a slim Node wrapper around the existing parse modules that writes snapshot bytes to a chosen storage adapter.

---

## 8. Failover across providers

Once the proxy lives at more than one URL, the browser app can try them in order — same idea as `ChainAdapter` already does for storage. A future PR can add a `[proxyUrls]` array to Settings (`js/adapters/index.js` style) and try each URL with a short timeout, falling through to the next on failure. This PR ships the proxy itself; the multi-URL client is a follow-up.

---

## What this PR deliberately does not ship

- `scripts/snapshot.js` for GitHub Actions — sketched above, deferred.
- Settings UI for a user-configurable proxy URL — deferred.
- Browser-side wire-up that automatically calls `/fetch` when a feed lacks CORS — deferred (today the browser app only reads from the R2 snapshot or the bundled sample data; expanding it to per-feed proxy fetches needs Settings UI + a feed-list management surface).
- Encryption of proxy responses (the proxy is a transparent CORS shim — encryption belongs in §5 storage, not in the proxy hop).

These follow-ups stack cleanly on top of `/fetch` without changing its shape.
