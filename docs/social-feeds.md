# Social feeds (Facebook, Instagram, X, TikTok)

Design document for the opt-in social-scrape path added alongside the
existing honest refusal in `js/url-resolver.js`. This stays inside the
ROADMAP §13 honesty line: it runs only on explicit reader action, never
overrides a publisher's real feed, never silently routes through a public
bridge, and surfaces an item count and preview before anyone subscribes.

## Why these platforms have no feed

| Platform  | First-party RSS in 2026 | Content gate |
|-----------|-------------------------|--------------|
| Facebook  | Removed 2018            | Login + consent wall; posts render from authenticated GraphQL |
| Instagram | Never published         | Heavy login wall; profile JSON gated for logged-out clients |
| X (Twitter) | Removed 2013          | Timeline requires an authenticated session |
| TikTok    | Never published         | Profile JSON present but obfuscated; no audio/video rehosting |

The blocker was never Cloudflare IP reputation. An unauthenticated fetch of
`facebook.com/<page>` returns a login redirect or a consent interstitial,
not posts. So an open proxy — wherever it runs — sees the wall, not the feed.

## The three honest tiers

### Tier 1 — public Page / profile content
A logged-out fetch of a public Facebook Page or public Instagram profile
sometimes ships post permalinks and caption text inside inline `<script>`
JSON. The worker extracts those into a synthetic Atom feed. Coverage is
partial and degrades whenever the platform tightens the logged-out wall.

### Tier 2 — bring-your-own session (the only path to friends content)
Friends-only posts, private Instagram accounts, and member-only groups are
visible **only to an account inside that social graph**. No datacenter shim,
proxy, or scraper can see them, because there is no public URL and no
unauthenticated render — the content is authorisation-gated, not
IP-gated.

The honest mechanism is to forward **the reader's own logged-in session**:

- The browser stores a per-platform session string in `localStorage`
  (`coda/social/sessions`), never transmitted anywhere except to the
  reader's own configured proxy.
- `add-feed.js` sends it on the `X-WHA-Cookie` request header.
- `worker/src/proxy.js` forwards it as the upstream `Cookie` header
  (with an optional `X-WHA-UA` override, since the platforms serve
  different markup to mobile user-agents).
- The upstream then returns exactly what that account is authorised to see —
  friends posts included — and the existing scraper turns it into a feed.

This is BYO-credential, not credential theft: the reader pastes their own
session, the feed reflects their own access, and the session lives only in
their browser and their proxy.

### Tier 3 — not attempted
- Rehosting Facebook/Instagram video or audio bytes.
- Defeating MFA, CAPTCHA, or checkpoint challenges.
- Rotating-residential-proxy evasion (explicitly out of scope per §13).
- Persisting or syncing the session server-side.

## Data flow

```
paste URL
  → resolve() (browser)
      socialScrape off  → kind:"refused"   (unchanged honest message + bridge hint)
      socialScrape on   → kind:"scrape"     { platform, pageUrl, needsSession, note }
  → add-feed #onScrape
      needsSession && no saved session → stop, tell the reader to paste one
      else → GET /scrape?url=<pageUrl>  [X-WHA-Cookie: <session>]
  → worker handleScrape
      proxyFetch(pageUrl, { cookie, ua })           ← authenticated fetch
      scrapeFeedItems → collectSocialItems          ← FB permalinks, IG /p|reel|tv + code-field
      buildAtom → application/atom+xml
  → candidate rendered with item count + 5-title preview → reader verifies → add
```

## Limitations (stated plainly, per §13)

- **Friends-only / private content requires the reader's own session.**
  With no session, only public content is reachable, and often not even
  that once the logged-out wall tightens.
- **Sessions expire.** A pasted cookie dies when the platform rotates it;
  the feed then returns to public-only or empty. There is no silent
  re-auth — re-paste is required.
- **Extraction is best-effort and brittle.** Inline-JSON shapes change
  without notice. A green run today can yield zero items next week. The UI
  surfaces the item count so a silent regression is visible.
- **No video/audio rehosting.** Items link back to the platform permalink.
- **Proxy must run the actual worker.** `worker/src/index.js` deployed at a
  reachable origin with `PROXY_ALLOW` set. A health-only stub that 404s on
  `/scrape` will not work — verify `/healthz` returns `ok` and
  `/scrape?url=…` returns Atom, not a 404 page.

## Reader setup

1. Deploy the worker (`functions/` on Pages, or `server.js` on any Node
   host) with `PROXY_ALLOW="*"` or an allowlist including the social hosts.
2. In Settings, enable social scraping (`coda/social/enabled = "1"`).
3. For friends/private content, paste your own session into
   `coda/social/sessions` keyed by platform name.
4. Paste a Page/profile URL, resolve, verify the preview, add.

## Follow-ups (not in this change set)

- Settings UI surface for the social toggle and the per-platform session
  fields (today they are `localStorage` keys; the panel wiring is a
  separate PR so this one stays reviewable).
- Per-item published timestamps from the inline JSON (currently derived
  only when the markup exposes a parseable stamp).
- X and TikTok extractors (the resolver already routes them; the worker
  extractor covers Facebook and Instagram first).
