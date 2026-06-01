# Facebook connect (compliant) — Graph API + Facebook Login

Design document for a sanctioned alternative to the BYO-session social
scrape (`docs/social-feeds.md`, ROADMAP §13 honesty line). Where the
BYO-session tier forwards the reader's own cookie to an authenticated
fetch, this connector uses Facebook Login (OAuth) and the Graph API: the
path Meta itself sanctions for programmatic access.

This is design only. No code in this change set. Implementation is queued
as a separate PR per ROADMAP §19.

## Why this exists alongside the BYO-session tier

The BYO-session tier (`X-WHA-Cookie`) is honest about being BYO-credential,
but it relies on the reader manually obtaining a session string. Two facts
shape the alternative:

- **[S1]** Facebook Automated Data Collection Terms —
  https://www.facebook.com/legal/automated_data_collection_terms — require
  programmatic access to go through the Platform APIs at
  `graph.facebook.com`, and state that accessing data through other tools or
  automated means without prior written permission violates the Terms.
  The OAuth + Graph path is the sanctioned route; replaying a session cookie
  against `facebook.com` is not.
- **[S2]** Chrome Web Store Program Policies —
  https://developer.chrome.com/docs/webstore/program-policies/policies —
  require a privacy policy, prominent disclosure, and affirmative informed
  consent before install when an extension reads authentication data and
  sends it to a remote server.

## Rejected approach: a cookie-capture browser extension

An extension that reads the httpOnly `c_user` / `xs` session cookies and
sends them to CODA was requested. It is not in this design, for reasons
that are constraints, not preferences:

1. It cannot be made compliant with [S1]: the value of reading the session
   is to fetch friends/timeline content outside the Platform APIs, which is
   the exact access [S1] prohibits. There is no compliant variant.
2. A click-once auto-read-and-send flow is the silent transmission ROADMAP
   §4 (line 485) forbids and the §17.1.4 kill-switch + once-per-session
   disclosure pattern is built to prevent.
3. Under [S2], reading auth cookies and transmitting them needs pre-install
   disclosure and informed consent. A frictionless, auto-signup flow aimed
   at non-technical users is the opposite of informed consent.

The BYO-session tier already exists for readers who accept the cookie
trade-off and paste their own session knowingly. This connector serves
readers who want the sanctioned path instead.

## Architecture

Reuses the existing Worker + static-client split (ROADMAP §4). Canonical
Meta endpoints: Facebook Login (https://developers.facebook.com/docs/facebook-login)
and the Graph API (https://developers.facebook.com/docs/graph-api).

```
Settings "Connect Facebook"
  → GET  <worker>/fb/login            302 → Facebook OAuth dialog (state, scope)
  ← Facebook redirects back to
    GET  <worker>/fb/callback?code&state
        worker exchanges code → user access token (server-side, app secret)
        worker returns the user token to the client
  → client stores token in localStorage  coda/social/fb-token
  → GET  <worker>/fb/feed?token=…&kind=posts|page:<id>|group:<id>
        worker calls graph.facebook.com → maps to Atom via existing buildAtom
  → candidate rendered with item count + 5-title preview → reader verifies → add
```

### Configuration (per installation, never hardcoded)

Same model as the existing `PROXY_ALLOW` / RSSHub-bridge per-installation
config. The app secret stays server-side; only the user access token
reaches the browser.

- `FB_APP_ID` — Meta app id, set as a Worker var in `wrangler.toml`.
- `FB_APP_SECRET` — set with `wrangler secret put FB_APP_SECRET`. Never in
  source, never sent to the client.
- `FB_REDIRECT_URI` — `<worker-origin>/fb/callback`, registered in the Meta
  app's Valid OAuth Redirect URIs.

With no app configured, `/fb/*` returns a plain "not configured" message and
the Settings button explains that setup is required. Identical no-config
behaviour to the headless-render tier (§14a).

## Honest scope — what the Graph API returns

Stated plainly per §13, because the connector covers less than the cookie
scrape, and the difference is exactly the non-compliant part.

| Surface | Reachable | Requirement |
|---|---|---|
| Your own posts (`me/posts`) | Partial | `user_posts`; per Meta's reference this edge returns ONLY posts created through the app or ones you're tagged in, NOT your existing timeline |
| Pages you manage (`me/accounts`, `<page>/feed`) | Yes | `pages_show_list`, `pages_read_engagement` |
| Groups | Conditional | Groups API is heavily restricted; the app generally must be installed in the group by an admin |
| Friends' posts / home timeline | No | No Graph permission grants this; the read-stream permission was retired in 2015 |
| Another person's private profile | No | Not available to any compliant method |

The default login scope is `public_profile,user_posts` only, because those
are the permissions a freshly created Facebook Login app can grant for
testing without business verification. The Page permissions
(`pages_show_list`, `pages_read_engagement`) live in a separate Pages use
case that requires business verification; until that is enabled, requesting
them returns "Invalid Scopes". A caller that has enabled the Pages use case
can pass `?scope=` to `/fb/login` to request them, and `/fb/feed` still
serves `kind=page:<id>` once the grant exists.

`user_friends` returns only friends who have also authorised the same app,
not a friends feed. There is no compliant way to read the home timeline.
A reader who needs friends-only content must use the BYO-session tier and
accept its cookie trade-off; this connector does not pretend to replace it.

## Trust contract (inherits §17.1)

- **Off by default.** No `/fb/*` traffic until the reader clicks Connect.
- **Disclosure before first call.** A one-line "this sends your Facebook
  access token to <worker-origin>" notice appears before the first
  `/fb/feed` request, matching the §4 no-silent-transmission rule.
- **Kill switch (§17.1.4).** A Disconnect action deletes the stored token
  and the Settings toggle; the app can be removed at facebook.com/settings.
- **Token, not password.** OAuth tokens are scoped and revocable; CODA
  never sees the Facebook password and never holds the app secret in the
  browser.
- **Single-user BYOS.** The token lives in the reader's own browser and is
  exchanged by the reader's own Worker. No server-side persistence (§5).

## Limitations (stated plainly, per §13)

- Useful surfaces (`user_posts`, page content) need Meta App Review before
  they work for anyone but the app's own test users. Until then the
  connector works only for the developer's own account in the Meta app.
- Tokens expire. Short-lived user tokens last ~1–2 hours; a long-lived
  exchange extends to ~60 days, after which the reader re-connects. No
  silent re-auth.
- Group access is unreliable by Meta's design and may return nothing even
  after a grant.
- This connector does not reach friends' feeds or the home timeline. That
  is a hard limit of the compliant path, not a missing feature.

## Follow-ups (not in the implementation PR's first cut)

- Long-lived token exchange and a re-connect prompt before expiry.
- Page-picker UI when the account manages more than one Page.
- Instagram Graph API (Business/Creator accounts via a linked Page) as a
  separate connector with its own scope table.
