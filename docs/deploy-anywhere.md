# Deploy anywhere — the CODA `/fetch` CORS proxy on every free tier

The CODA browser app at <https://witch-hat-atelier.pages.dev/> needs a stable, CORS-friendly origin for fetching feeds. The `/fetch` route in `worker/src/index.js` is the universal CORS proxy described in ROADMAP §4, gated by `PROXY_ALLOW` and capped at `MAX_BYTES`. It is a pure Fetch-API handler with no Cloudflare-specific bindings, so it runs unchanged on every major free-tier serverless platform.

This doc lists working recipes ordered from least friction (same-origin Pages Function on the current deploy) to most friction (self-hosted on Oracle Cloud always-free). Each section names the free-tier source, the deploy command, and the env vars to set.

> **No free-tier number in this doc is invented.** Each one cites the provider's own pricing page in the table below the recipe. Free-tier limits drift — re-check the linked page before publishing usage estimates.

---

## 0. The same-origin path — Cloudflare Pages Functions (recommended)

The site is already on Cloudflare Pages, so the proxy can sit on the same origin as a Pages Function. No extra hostname, no CORS preflight cost, no separate deploy.

**File:** [`functions/fetch.js`](../functions/fetch.js) — a four-line re-export of the Worker's default handler.

**Deploy:** push to `main`. Cloudflare Pages auto-deploys; `functions/fetch.js` becomes `https://witch-hat-atelier.pages.dev/fetch` on the next build.

**Configure:** Cloudflare dashboard → Pages → `witch-hat-atelier` → **Settings** → **Environment variables** → add for the Production environment:

| Variable | Value | Notes |
|---|---|---|
| `PROXY_ALLOW` | `*` or `https://www.mnot.net/, https://www.jsonfeed.org/` | Empty / unset = proxy disabled (403). |
| `MAX_BYTES` | `5000000` | Default if unset. |
| `UA` | `CODA/0.1 (+https://github.com/Tiredicey/witch-hat-atelier)` | Default if unset. |

**Verify:**

```bash
curl -i 'https://witch-hat-atelier.pages.dev/fetch?url=https://www.jsonfeed.org/feed.json'
```

Free-tier limit: shared with the Workers free plan, **100,000 requests/day** combined across all Pages Functions on the account ([Cloudflare Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/), confirmed 2026-04). Static asset requests do not count.

---

## 1. Standalone Cloudflare Worker

Identical handler, separate subdomain. Use this if you want the proxy on a different domain than the site, or to keep Pages quota and Workers quota separated (Workers free has its own 100K/day).

```bash
cd worker
npm install
npx wrangler login
# edit wrangler.toml: set bucket_name (only needed for the cron /poll path)
npx wrangler deploy
npx wrangler secret put PROXY_ALLOW   # paste your allowlist, press Ctrl-D
```

Endpoint: `https://coda-feeds.<your-account>.workers.dev/fetch`.

Free-tier limit: **100,000 requests/day** per script ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), confirmed 2026-04).

---

## 2. Vercel Edge Function

The Worker exports a `{ fetch }` default. Vercel Edge accepts a plain Fetch handler.

Create `api/fetch.js` in a small wrapper repo (or in this repo under `api/` if hosting on Vercel):

```js
import worker from "../worker/src/index.js";

export const config = { runtime: "edge" };

export default function handler(request) {
  return worker.fetch(request, process.env);
}
```

Deploy:

```bash
npm i -g vercel
vercel deploy --prod
vercel env add PROXY_ALLOW production   # paste value
```

Endpoint: `https://<project>.vercel.app/api/fetch`.

Free-tier limit: **1,000,000 Edge Function invocations / month** on the Hobby plan ([Vercel Hobby plan docs](https://vercel.com/docs/plans/hobby), confirmed 2026-02).

---

## 3. Netlify Edge Function

Create `netlify/edge-functions/fetch.js`:

```js
import worker from "../../worker/src/index.js";

export default (request, context) => worker.fetch(request, Netlify.env.toObject());

export const config = { path: "/fetch" };
```

Add to `netlify.toml`:

```toml
[[edge_functions]]
  function = "fetch"
  path     = "/fetch"
```

Deploy:

```bash
npm i -g netlify-cli
netlify deploy --prod
netlify env:set PROXY_ALLOW '*'
```

Endpoint: `https://<site>.netlify.app/fetch`.

Free-tier limit: **1,000,000 Edge Function invocations / month**, plus 125,000 serverless function invocations and 100 GB bandwidth ([Netlify Free plan announcement](https://www.netlify.com/blog/introducing-netlify-free-plan/), 2024-11).

---

## 4. Deno Deploy

Create `deno-deploy.js`:

```js
import worker from "./worker/src/index.js";

Deno.serve(req => worker.fetch(req, Deno.env.toObject()));
```

Deploy via `deployctl` or by linking the GitHub repo in the Deno Deploy dashboard. Set `PROXY_ALLOW` as a project environment variable.

Endpoint: `https://<project>.deno.dev/fetch`.

Free-tier limit: see [Deno Deploy pricing](https://docs.deno.com/deploy/manual/pricing-and-limits/) for the current free tier — the limit page is the source of truth.

---

## 5. Node-on-VM (Oracle Cloud always-free, Render, any Linux box)

Node 20+ has Fetch, Request, Response, URL as globals, so the Worker handler runs unmodified inside a thin HTTP wrapper.

Create `server.js` in the repo root:

```js
import { createServer } from "node:http";
import worker from "./worker/src/index.js";

const port = process.env.PORT || 8787;

createServer(async (nodeReq, nodeRes) => {
  const url = `http://${nodeReq.headers.host || "localhost"}${nodeReq.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(nodeReq.headers)) {
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const hasBody = !["GET", "HEAD"].includes(nodeReq.method);
  const body = hasBody ? await readBody(nodeReq) : undefined;
  const req = new Request(url, { method: nodeReq.method, headers, body });
  const resp = await worker.fetch(req, process.env);
  nodeRes.statusCode = resp.status;
  resp.headers.forEach((v, k) => nodeRes.setHeader(k, v));
  const buf = Buffer.from(await resp.arrayBuffer());
  nodeRes.end(buf);
}).listen(port, () => console.log(`CODA proxy on :${port}`));

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
```

Run on Oracle Cloud always-free (Ampere ARM VM):

```bash
sudo apt install nodejs npm   # Node 20 LTS or newer
PROXY_ALLOW='*' node server.js
# expose via Caddy / nginx + Let's Encrypt for TLS
```

Free-tier limit: Oracle Cloud always-free includes 2 AMD VMs (1/8 OCPU, 1 GB RAM each) and 4 ARM Ampere cores split across up to 4 VMs ([Oracle Cloud always-free resources](https://www.oracle.com/cloud/free/#always-free), product page).

---

## 6. GitHub Actions as a cron writer (no proxy, but a free poll engine)

The `/fetch` proxy is an HTTP server and cannot live on GitHub Actions. The Worker's **cron path** — `scheduled(event, env, ctx)` in `worker/src/index.js` — can.

This is the "free cron + free compute" alternative for users who do not want a Cloudflare account. The cron job fetches each subscribed feed, parses with the existing `worker/src/parse.js`, and commits the resulting snapshot to the same GitHub repo via the existing `js/adapters/github.js` adapter (PR #9).

**Status:** scaffolded here as the deploy path; the runner script itself is a follow-up PR (`feat(actions): cron-driven feed snapshot writer via GitHub adapter`) so this PR stays scoped to the proxy.

Sketch of the workflow file (do not commit until the runner script lands):

```yaml
name: feed-snapshot
on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch: {}
jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: node scripts/poll-and-write.mjs
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN }}
          GH_REPO:  ${{ github.repository }}
```

Free-tier limit: standard GitHub-hosted runners are **free for public repositories** ([GitHub Actions billing](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions)). Private repos consume the account's monthly free-minutes quota, which varies by plan.

---

## Choosing a path

| Use case | Recommended |
|---|---|
| Already on Cloudflare Pages, want the simplest setup | §0 Pages Functions |
| Want to keep proxy quota separate from site quota | §1 standalone Worker |
| Already deploying to Vercel | §2 Vercel Edge |
| Already deploying to Netlify | §3 Netlify Edge |
| Want a non-Cloudflare TS-first edge | §4 Deno Deploy |
| Want a long-lived VM (no per-request limit) | §5 Oracle Cloud always-free |
| No serverless account at all, willing to wait 30 min between polls | §6 GitHub Actions cron (follow-up PR) |

Every path above runs the same `worker/src/index.js` handler. Changes to the gate logic in `worker/src/proxy.js` propagate to all of them with no per-platform diff.

---

## Failover note

The browser app reads its proxy origin from `settings.workerUrl` (follow-up PR, not in this change set). When that setting lands, it will accept a comma-separated list so the client can try Pages → Worker → Vercel → Netlify on connection failures. This is the §4 edge-layer failover the ROADMAP refers to; the multi-provider deploy story above is the prerequisite.
