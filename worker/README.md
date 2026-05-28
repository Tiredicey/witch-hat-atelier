# CODA §4 feed engine — Cloudflare Worker

This Worker fetches the feeds in your subscription list, parses Atom / RSS 2.0 / JSON Feed 1.1, applies a quality filter (§1), and writes the merged entries to your R2 bucket. The browser site then reads that R2 snapshot and renders real feeds instead of the sample data.

## What it does

Subscription source precedence: the Worker first checks R2 for `coda/subs/subscriptions.json` (written by the browser Settings → Import OPML flow). If that file is absent, it falls back to the static `FEEDS` env var in `wrangler.toml`. This means once a user imports an OPML, the Worker picks up the new list on the next cron tick — no redeploy needed.

Every 30 minutes (configurable in `wrangler.toml`), the Worker:

1. Reads `coda/feeds/meta.json` from R2 to recover per-feed ETag / Last-Modified state.
2. For each feed in the `FEEDS` env var, fetches the URL with the stored conditional headers, a polite UA, and a 15-second timeout.
3. On 200: parses the body, runs the quality heuristic (recency / content / metadata). Feeds scoring < 0.5 are kept on the per-feed meta but their entries are dropped.
4. On 304: reuses the cached entries from the previous successful fetch.
5. Merges + dedupes all kept entries across feeds, sorts by `published` desc, writes `coda/feeds/snapshot.json` to R2.
6. Writes the updated meta back to `coda/feeds/meta.json`.

It also exposes two HTTP endpoints:

| Method | Path        | Purpose |
|--------|-------------|---------|
| GET    | `/healthz`  | Returns `ok` — for uptime monitoring. |
| POST   | `/parse`    | Body: `{ "url": "...", "etag"?: "...", "lastModified"?: "..." }`. Returns the parsed feed and quality score without persisting. Useful for the planned §8.1 add-by-URL flow and for debugging. |
| GET    | `/fetch?url=<feed_url>` | Universal CORS proxy. Gated by the `PROXY_ALLOW` env var (default disabled). Forwards conditional headers (`If-None-Match`, `If-Modified-Since`), returns the upstream body with original `Content-Type` plus `ETag` / `Last-Modified` passthrough, capped at `MAX_BYTES` (default 5 MB). Used by the browser app when bucket-side CORS is unavailable. |

### The `/fetch` proxy in detail

The browser app cannot fetch arbitrary feeds directly: most publishers do not send `Access-Control-Allow-Origin` headers, so the browser blocks the response. `/fetch` is a thin pass-through on the Worker that adds those headers and returns the body, so any HTTP feed becomes reachable from the static site without storing credentials.

**Gating.** The route is closed by default. To enable it, set `PROXY_ALLOW` to either:
- `*` — allow any public http(s) URL. Private addresses (`localhost`, `127.0.0.1`, RFC-1918 ranges, `169.254/16`, `::1`, `0.0.0.0`) are blocked regardless, as SSRF defense.
- A comma-separated list of URL prefixes — only URLs starting with one of these prefixes pass the gate. Example: `https://www.mnot.net/, https://www.jsonfeed.org/`.

**Size cap.** Responses larger than `MAX_BYTES` (default 5 MB, matching ROADMAP §11 risk 8) return `502 upstream too large: <n> > <max>`. The cap is checked against the upstream-declared `Content-Length` first and then against the actual `arrayBuffer().byteLength` for servers that omit `Content-Length`.

**Timeout.** Hard 15 s upstream timeout; on timeout the proxy returns `502 timeout after 15000ms`.

**Caching.** The proxy never adds its own cache. `Cache-Control: no-store` is set on responses so browsers re-validate on every load. The upstream `ETag` / `Last-Modified` are forwarded so the browser can issue `If-None-Match` / `If-Modified-Since` on its own.

**Verify locally:**

```bash
PROXY_ALLOW='*' npx wrangler dev
curl -i 'http://127.0.0.1:8787/fetch?url=https://www.jsonfeed.org/feed.json' \
  -H 'Origin: https://witch-hat-atelier.pages.dev'
```

You should see `200 OK`, `Access-Control-Allow-Origin: *`, the original `Content-Type`, and the JSON Feed body. The proxy adds nothing to the body.

## Deploy

One-time setup:

```bash
cd worker
npm install
npx wrangler login        # opens browser, links your Cloudflare account
```

Edit `wrangler.toml`:

1. `bucket_name` — set to your R2 bucket (can be the same one used for state sync; the Worker writes under `coda/feeds/`).
2. `FEEDS` — JSON array of `{ id, url, shelf? }`. `id` must be unique and stable (used as the meta-cache key).
3. `UA` — leave as default or set your own contact URL.

Then:

```bash
npx wrangler deploy       # ships the Worker
npx wrangler tail         # streams logs from the live Worker
```

The cron starts firing automatically once deployed.

## Configure the browser to read the snapshot

The deployed site reads `coda/feeds/snapshot.json` from your R2 bucket via the same S3 adapter that powers state sync. On boot:

- If the user has the S3 adapter configured and `coda/feeds/snapshot.json` exists, real entries are loaded.
- Otherwise, the hand-written sample articles in `js/sample-data.js` are used as the fallback.

Encryption is not yet implemented (§5 follow-up). The Worker writes plaintext JSON to R2. If your bucket is publicly readable, anyone who knows the URL can read your feed list and entries. Keep the bucket private.

## Limitations

This Worker is the MVP of §4. The roadmap calls for more endpoints; these are deferred:

| Endpoint | Roadmap | Status |
|---|---|---|
| `/poll`, `/parse` (HTTP) | §4 | shipped (cron + POST `/parse`) |
| `/websub` subscriber callback | §4 + §8.10 | deferred |
| `/opml` import endpoint | §4 + §8.1 | deferred |
| `/discover` (rel=alternate + feed-menu [S6]) | §4 + §8.1 | deferred |

The parser is hand-rolled (~200 lines, no third-party deps). It handles common-case Atom 1.0, RSS 2.0, and JSON Feed 1.1 well. It does not handle:

- XML namespaces beyond the canonical Atom and RSS ones (Dublin Core `dc:date` is handled; other namespaces are ignored).
- Deeply malformed XML — a feed that doesn't well-form will fail to parse and the Worker logs `parse failed` to its `lastError` meta field.
- HTML entities beyond the canonical five (`&lt;`, `&gt;`, `&quot;`, `&amp;`, `&apos;` / `&#39;`).

The quality scorer is the recency + content + metadata triplet from §1, not the full distribution-matching scorer S1 references. It is calibrated to drop the obvious low-quality / dormant feeds and let actively-published feeds through.

## Local development

```bash
npx wrangler dev          # runs the Worker locally on http://127.0.0.1:8787
curl http://127.0.0.1:8787/healthz
curl -X POST http://127.0.0.1:8787/parse \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.jsonfeed.org/feed.json"}'
```

For the cron handler, trigger it manually via:

```bash
curl 'http://127.0.0.1:8787/__scheduled?cron=*/30+*+*+*+*'
```

(wrangler's local dev runtime exposes that endpoint for cron simulation.)
