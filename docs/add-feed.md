# Add a feed by URL

Settings → **Add a feed by URL** lets you paste any site URL and have CODA
resolve it to a real feed, then append it to your subscriptions on the
active storage adapter. It is the browser-side companion to the &sect;4
Worker `/discover` endpoint.

## How resolution works

The flow is two layers, deepest-first:

1. **Documented direct patterns** (`js/url-resolver.js`). For URLs that
   match a documented feed-URL pattern published by the platform itself,
   the resolver returns the feed URL with no network round trip. This is
   the fastest path and the most reliable.

2. **Worker `/discover` fallback** (`worker/src/discover.js`,
   `functions/discover.js`). For everything else, the controller asks
   the Worker to fetch the page, scan the `<head>` for
   `<link rel="alternate" type="application/rss+xml|atom+xml|feed+json">`
   tags, and then (if no alternates exist) probe common feed paths like
   `/feed`, `/feed.xml`, `/rss`, `/atom.xml`, `/index.xml`. The Worker
   sniffs each probe response for actual feed content before returning it
   as a candidate.

## Direct-pattern source trail

Every documented pattern below is anchored to the platform's own
documentation or a long-standing public URL convention. If a pattern
ever stops working, fix the resolver, not the docs.

### YouTube channel-by-ID

| Input pattern | Output URL |
| --- | --- |
| `https://www.youtube.com/channel/UC...` | `https://www.youtube.com/feeds/videos.xml?channel_id=UC...` |

YouTube channel pages have shipped this `feeds/videos.xml?channel_id=...`
URL since the GData v1 era (2009) and continue to do so. The `UC`
prefix is the documented channel-ID format. `@handles` and `/c/customnames`
fall through to `/discover` because the channel-ID is not derivable
client-side; the channel page itself does ship an
`<link rel="alternate" type="application/rss+xml">` pointing at the
same `feeds/videos.xml?channel_id=...` URL, so `/discover` resolves them
on the round trip.

### YouTube playlist

| Input pattern | Output URL |
| --- | --- |
| `https://www.youtube.com/playlist?list=PL...` | `https://www.youtube.com/feeds/videos.xml?playlist_id=PL...` |

Same `feeds/videos.xml` endpoint family. Accepts `PL`, `UU`, `FL`, `OL`
prefixed list IDs.

### YouTube legacy user

| Input pattern | Output URL |
| --- | --- |
| `https://www.youtube.com/user/{name}` | `https://www.youtube.com/feeds/videos.xml?user={name}` |

Legacy YouTube usernames (pre-2013 accounts that still resolve at
`/user/{name}`) keep working through the `?user=` parameter on the same
feed endpoint.

### Reddit subreddit and user

| Input pattern | Output URL |
| --- | --- |
| `https://www.reddit.com/r/{name}` | `https://www.reddit.com/r/{name}/.rss` |
| `https://www.reddit.com/user/{name}` | `https://www.reddit.com/user/{name}/.rss` |

Reddit's `.rss` suffix has been part of the public site since
the original Reddit codebase. Appending `.rss` to any listing URL
returns an RSS 2.0 feed of the same listing.

### Mastodon profile

| Input pattern | Output URL |
| --- | --- |
| `https://{instance}/@{user}` | `https://{instance}/@{user}.rss` |

Every Mastodon server exposes a per-account RSS feed at `/@user.rss`.
This is shipped by the upstream Mastodon code and applies on every
self-hosted instance unless the operator disabled it.

The resolver skips this pattern for `youtube.com`, `reddit.com`,
`github.com`, `medium.com`, and `substack.com` because those sites use
`@username` URLs that are NOT Mastodon.

### Substack publication

| Input pattern | Output URL |
| --- | --- |
| `https://{name}.substack.com/...` | `https://{name}.substack.com/feed` |

Every Substack publication exposes an Atom feed at the publication
subdomain `/feed` path. The pattern only matches subdomains; the bare
`substack.com` / `www.substack.com` host is the directory homepage and
falls through to `/discover`.

### Medium @user and publication

| Input pattern | Output URL |
| --- | --- |
| `https://medium.com/@{user}` | `https://medium.com/feed/@{user}` |
| `https://medium.com/{slug}` | `https://medium.com/feed/{slug}` |

Medium ships `/feed/@{user}` for personal feeds and `/feed/{slug}` for
publication feeds at the canonical `medium.com` host. Custom-domain
Medium publications fall through to `/discover`; the publication page
ships an `<link rel="alternate">` that resolves on the round trip.

### Tumblr blog

| Input pattern | Output URL |
| --- | --- |
| `https://{name}.tumblr.com/...` | `https://{name}.tumblr.com/rss` |

Every Tumblr blog exposes RSS at the blog subdomain `/rss` path. The
pattern only matches subdomains; bare `tumblr.com` / `www.tumblr.com`
falls through.

### GitHub releases

| Input pattern | Output URL |
| --- | --- |
| `https://github.com/{owner}/{repo}` | `https://github.com/{owner}/{repo}/releases.atom` |

Every public GitHub repository exposes an Atom feed of its releases at
`/releases.atom`, plus parallel `/commits.atom` and `/tags.atom` feeds.
The resolver picks releases because it is the most useful default for a
reader; if you want commits, paste the explicit `/commits.atom` URL.

## When `/discover` returns no candidates

The Worker `/discover` route reports back one of four states in its JSON
body so the UI can show a specific diagnostic instead of a generic
"no feeds found" sentence:

| Worker response shape | UI message |
| --- | --- |
| `gateBlocked: true, gateReason: "..."` | The Worker `PROXY_ALLOW` env var refused the URL; tell the deploy owner to widen it. |
| `upstreamError: "..."` | Worker could not connect to the site (timeout, DNS, network). |
| `sourceStatus: >=400` | Site responded with HTTP 4xx/5xx when the Worker fetched it; usually a bot block. |
| `probed: true, candidates: []` | Page loaded, no `<link rel="alternate">`, common paths also empty. Site likely has no RSS. |
| `probed: false, candidates: []` | Page loaded, no `<link rel="alternate">`. Try a known feed URL. |

This shape is asserted by `tests/add-feed.spec.js`. If you change the
worker response, update both the worker and the UI together.

## Refused platforms

The resolver refuses four platforms with an honest inline explanation
because they do not publish public RSS in 2026:

| Platform | Reason |
| --- | --- |
| Facebook | Removed page RSS in June 2018. There is no first-party feed URL. |
| Instagram | Has never published public RSS. |
| X (Twitter) | Removed public RSS in 2013. The v2 API requires a paid tier and an account. |
| TikTok | Does not publish RSS. |

Refusing is the correct behavior. Silently calling `/discover` and
returning "no feeds found" would obscure WHY no feed exists.

#### Host coverage is suffix-based

Detection matches the platform's registrable domain as a suffix, so
every subdomain a user might paste is refused — not just the bare apex.
This closes a class of bug where a marketing or mobile subdomain slipped
past an exact-host list, fell through to the Mastodon `@user` pattern,
and produced a dead `{subdomain}/@name.rss` "feed" that never existed.

| Platform | Hosts refused (suffix match) |
| --- | --- |
| Facebook | `facebook.com` and any subdomain (`www.`, `m.`, `web.`, `business.`, `l.`, `lm.`), plus `fb.com`, `fb.watch` |
| Instagram | `instagram.com` and any subdomain, plus `instagr.am` |
| X (Twitter) | `twitter.com` / `x.com` and any subdomain (`www.`, `mobile.`) |
| TikTok | `tiktok.com` and any subdomain (`www.`, `m.`, `vm.`, `vt.`) |

### Optional RSSHub bridge

If you operate your own RSSHub instance (self-hosted or rented), you can
enter its base URL in **Settings → Add a feed by URL → RSSHub bridge
URL (optional)**. When set, refused-platform inputs surface a candidate
bridge URL (e.g. `{bridge}/facebook/page/{name}`) that you can adopt
with one click.

CODA never defaults to a public RSSHub instance. Public instances are
rate-limited, often blocked by upstream platforms, and route your
subscription list through a third party. Leaving the bridge URL blank
keeps refused inputs as plain refusals.

#### Bridge candidates are emitted only for documented route shapes

CODA suggests a bridge URL only when the pasted URL matches a route
shape RSSHub actually documents. URLs that are not a profile/page — and
therefore have no working bridge route — surface the bridge docs message
instead of a malformed candidate the user would have to debug:

| Platform | Emits a candidate for | Returns no candidate for |
| --- | --- | --- |
| Facebook | vanity page slug → `{bridge}/facebook/page/{slug}` | `profile.php?id=`, `/groups/`, `/people/`, `/pages/`, `/watch/`, `/events/`, `fb.watch` share links, `l.facebook.com` redirects |
| Instagram | username → `{bridge}/instagram/user/{handle}` | `/p/`, `/reel/`, `/reels/`, `/tv/`, `/stories/`, `/explore/` |
| X (Twitter) | handle → `{bridge}/twitter/user/{handle}` | `/i/`, `/home`, `/search`, `/hashtag/`, any URL containing `/status/` |
| TikTok | `@handle` → `{bridge}/tiktok/user/@{handle}` | share-shortener hosts and any path without a leading `@handle` |

The RSSHub route names above (`/facebook/page/:page`, `/instagram/user/:id`,
`/twitter/user/:id`, `/tiktok/user/:user`) are RSSHub's documented route
namespaces. Whether a given route succeeds still depends on the bridge
operator's configuration and the upstream platform's current defenses —
CODA only guarantees the candidate URL is well-formed, never that the
remote feed exists.

## Adapter compatibility

The Add-by-URL flow writes through the active adapter's generic
`read(key)` / `write(key, body)` API at `coda/subs/subscriptions.json`.
Every adapter that landed in or before PR #22 supports this API
(LocalAdapter, S3, WebDAV, Dropbox, GitHub, Telegram, chain). New
adapters that ship only a snapshot interface will be a no-op for this
feature; add the generic key API to enable it.

## Tests

- `tests/url-resolver.spec.js` — 17 unit tests across direct patterns,
  refused platforms, the `/discover` fallback signal, and invalid input.
- `tests/add-feed.spec.js` — 9 integration tests for the settings panel
  with `/discover` and `/fetch` mocked via `page.route`. Verifies that
  documented patterns skip the discover round trip, that the verify
  button parses the fetched feed and reports the entry count, that
  refused platforms render the refused panel with no discover hit, and
  that the bridge URL setting persists and surfaces candidate URLs.

Both specs run on `desktop-chromium`, `mobile-chromium`, and
`reduced-motion` projects.
