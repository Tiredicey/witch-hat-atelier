# witch-hat-atelier

[![tests](https://github.com/Tiredicey/witch-hat-atelier/actions/workflows/test.yml/badge.svg)](https://github.com/Tiredicey/witch-hat-atelier/actions/workflows/test.yml)

CODA — a three-pane shell for a 2026 RSS reader. Static site. Real feed
fetching, sync, and encryption live in a separate Cloudflare Worker and
storage adapter layer (see `ROADMAP.md` §4 and §5).

> *"A coda is what closes a piece of music — the calm after the noise feed."*

## What's here

This repo currently ships only the **shell** described in ROADMAP §7:

- sigil rail · article list · reader pane
- atelier mode (rails hidden), mobile single-pane swap
- keyboard shortcuts inherited from Google Reader (j/k/o/m/s/n/a/?/g g/g s)
- empty state ("This shelf is quiet."), error dot on a shelf
- hand-drawn SVG dividers between rows, watercolour wash on the reader
- local persistence (read · starred · notes) via a §5 event-log store
  backed by a `LocalAdapter` writing to `localStorage`. Cloud adapters
  (Dropbox / R2 / WebDAV) and encryption land in a follow-up PR.
- DMZ page (§15): a shared, unencrypted scratch-board for family use.
  Sibling storage path `coda/dmz/...`, never co-mingled with the private
  reader. Reachable in one click from the rail; one click back.
- Storage adapters (§8.2, opt-in): Settings page (rail → cog sigil) lets you
  switch the private reader and DMZ from `LocalAdapter` to **WebDAV**,
  **Dropbox**, or **S3-compatible** (R2 / B2 / Wasabi). Enabling any cloud
  adapter requires typing `PLAINTEXT` into a confirmation field — encryption
  lands in a follow-up PR. Default remains `LocalAdapter`.

The sample articles in `js/sample-data.js` are hand-written demo content,
not fetched from real feeds. Every quantitative claim in the sample
excerpts cites the roadmap's `[S1]–[S8]` anchors.

## File layout

```
.
├── index.html              ← markup only (rails, list, reader, overlay)
├── tokens.css              ← design tokens (Witch Hat Atelier palette + type scale)
├── styles/
│   └── shell.css           ← three-pane layout, atelier mode, mobile rules
├── js/
│   ├── app.js              ← entry point; wires modules together
│   ├── sample-data.js      ← fixture content (NOT real feeds)
│   ├── article-list.js     ← class ArticleList — middle pane
│   ├── reader.js           ← class Reader — reader pane (empty / article states)
│   ├── shelves.js          ← class Shelves — rail active-state
│   ├── atelier.js          ← class Atelier — rails-hidden toggle
│   ├── mobile.js           ← class Mobile — single-pane swap at ≤768px
│   ├── help.js             ← class Help — shortcuts overlay
│   ├── shortcuts.js        ← class Shortcuts — keyboard bindings + g g prefix
│   ├── storage.js          ← StorageAdapter interface + LocalAdapter (localStorage)
│   ├── store.js            ← §5 event log + materialised snapshot store
│   ├── notes.js            ← class Notes — note pane bound to current article
│   ├── dmz.js              ← class Dmz + mountRouter — the §15 shared board page
│   ├── settings.js         ← class Settings — adapter configuration page
│   └── adapters/
│       ├── index.js        ← makeAdapter factory + settings load/save
│       ├── webdav.js       ← WebDAV adapter (PUT/GET/DELETE)
│       ├── dropbox.js      ← Dropbox adapter (paste-token)
│       ├── s3.js           ← S3-compatible adapter (R2 / B2 / Wasabi)
│       └── sigv4.js        ← browser SigV4 signer (SubtleCrypto)
├── tests/
│   ├── shell.spec.js
│   ├── empty-and-reader.spec.js
│   ├── keyboard.spec.js
│   ├── shelves-and-density.spec.js
│   ├── atelier-and-mobile.spec.js
│   ├── motion-and-contrast.spec.js
│   ├── a11y-basics.spec.js
│   ├── persistence-and-notes.spec.js
│   ├── dmz.spec.js
│   └── adapters.spec.js
├── playwright.config.js    ← desktop + mobile + reduced-motion projects
├── package.json
└── README.md
```

## Run locally

The site is static. Anything that serves a directory will do:

```bash
npm run dev
# → http://127.0.0.1:4173/
```

(`npm run dev` is just a thin alias for `python3 -m http.server 4173` — no
node runtime is needed to view the site. The `node_modules` setup below is
only for running tests.)

## Run the test suite

```bash
npm install
npx playwright install chromium    # one-time, downloads the browser
npm test
```

Tests run against three Playwright projects: `desktop-chromium`,
`mobile-chromium`, and `reduced-motion`. The `webServer` block in
`playwright.config.js` starts a static server automatically — you don't
need to run `npm run dev` first.

To see the HTML report after a run:

```bash
npm run test:report
```

## What's *not* here (and where it lives in the roadmap)

| Capability                          | Roadmap section | Status |
|-------------------------------------|-----------------|--------|
| Feed fetching, parse, quality score | §4 (Worker)     | not built |
| Storage adapters (Dropbox/R2/WebDAV)| §5 + §8.2       | **all three shipped (opt-in, plaintext)**; cloud-DMZ split deferred |
| AES-256-GCM client encryption       | §5              | not built (PR #7 — required before cloud adapters become default) |
| OPML 2.0 import + triage screen     | §8.1            | not built |
| WebSub subscriber                   | §8.10           | not built |
| AI summarisation                    | explicitly punted (§8 "does NOT ship") | won't build in v1 |
| The full 24-sigil set               | §14 step 4      | 8 of 24 included as stand-ins |

## License

See `LICENSE`.
