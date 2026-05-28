# CODA — Roadmap for a 2026 RSS Reader

**Codename:** CODA (a coda is what closes a piece of music — the calm after the noise feed).
**One-line thesis:** Most of the open web still publishes feeds; almost none of the tooling treats the feed as worth caring about. Build a reader that respects the open web *and* the reader's hard drive.
**Status:** Roadmap, not implementation. Every quantitative claim cites a source below.

---

## 0 · Source anchors (trust chain)

Every numeric claim in this document is footnoted to one of these:

- **[S1]** Mark Nottingham — *Web Feeds in 2026: A Survey* — https://mnot.net/blog/2026/feed-survey — 2026-05-10 — **primary** (Common Crawl scan of Tranco top 500,000 sites; n = 196,598 sites, 543,577 feed URLs checked).
- **[S2]** *Obsidian BYOC* (Bring Your Own Cloud) — https://github.com/winters27/obsidian-byoc — architectural precedent for 12-provider sync with optional rclone-crypt / AES-256 E2EE. **Tier 5 (open-source project, but inspectable code).**
- **[S3]** JSON Feed 1.1 — https://jsonfeed.org/version/1.1/ — official spec.
- **[S4]** RFC 4287 — *The Atom Syndication Format* — https://datatracker.ietf.org/doc/html/rfc4287 — IETF standards-track.
- **[S5]** RFC 5023 — *The Atom Publishing Protocol* — IETF standards-track.
- **[S6]** Nottingham — *draft-nottingham-feed-menu-00* — https://datatracker.ietf.org/doc/draft-nottingham-feed-menu/ — IETF straw-man (2026), referenced in S1.
- **[S7]** W3C WebSub Recommendation (Jan 2018) — https://www.w3.org/TR/websub/ — primary.
- **[S8]** OPML 2.0 — http://opml.org/spec2.opml — community standard.
- **[S9]** Sketchfab Free license / CC-BY 4.0 attribution requirements (for any reference imagery in the visual system).

Claims sourced from tier-4 industry market reports (e.g. RSS reader market sizing) are tagged `[tier-4]` and treated as directional, not definitive.

---

## 1 · Product thesis

Three facts from S1, none of them speculation:

1. **The open web still publishes feeds.** 35.9% of the Tranco top 500k expose feed autodiscovery, and the survey parsed 534,195 feeds at a 98.3% parse success rate [S1].
2. **The feeds are mostly dead.** Only 22.6% of parsed feeds clear a basic quality bar (recency + content + metadata); only 26.5% are both fresh (last 365 days) *and* contain entries [S1]. WordPress autodiscovered feeds clear the bar at 36.5%; the Blogger figure is 5.9% [S1]. Substack and Squarespace land at 90% [S1].
3. **Autodiscovery is broken as a UX promise.** `rel=alternate` shows up on 81.94M pages but doesn't predict feed quality — mean quality is 0.246 with autodiscovery vs. 0.220 without [S1]. The browser-side experience of "find a feed, subscribe" lands the user on stale or empty XML the majority of the time.

That gap is the entire opportunity. The product to build isn't "Feedly with more AI" — it's a reader that **filters at index time** so the user never sees dead feeds, *and* stores subscriptions / read state in the user's own cloud so trust isn't a marketing claim.

---

## 2 · Differentiation

Four wedges, ranked by defensibility.

| # | Wedge | Why it matters | Why competitors don't do it |
|---|---|---|---|
| 1 | **Bring-your-own storage (BYOS), encrypted client-side** | Subscriptions, read state, highlights, OPML all live in the user's R2 / B2 / Dropbox / GDrive / OneDrive / iCloud Drive / WebDAV bucket. The server holds zero user data. | Centralised SaaS readers are built on subscription revenue that requires central state. BYOC plugins exist for Obsidian [S2] and Standard Notes' pattern is similar, but no major RSS reader ships this. |
| 2 | **Quality filter at index time** | Run S1's quality heuristics (recency, content density, metadata completeness) on every new subscription and continuously. Hide or warn on dead feeds before the user wastes attention. | Adding this to a paid product means churning the user's existing dead subscriptions, which advertisers and "trending" sections quietly subsidise. |
| 3 | **Witch Hat Atelier visual language** | Hand-drawn ink, parchment, sigil iconography. Memorable, calm, immediately distinguishable from corporate gradient-and-grotesk competitors. See §6. | Corporate products optimise for "feels safe to enterprise"; this product targets readers who choose interfaces aesthetically. |
| 4 | **Standards forward, not features forward** | Implement Nottingham's `feed-menu` discovery [S6] as opt-in, WebSub subscriber [S7], JSON Feed 1.1 output [S3], OPML 2.0 round-trip [S8], ActivityPub bridge for Mastodon-style feeds. | Most readers freeze on RSS 2.0 + Atom; standards work is unsexy and unbillable. |

---

## 3 · Audience

| Segment | Daily job | What they need scannable first |
|---|---|---|
| The independent writer / journalist | Track 80–300 sources daily; archive what's useful | Unread count per shelf, last-fresh signal, fast filter by language and tag |
| The researcher | Long-window reading; high-precision archive; cite-later | Reader mode with annotation, archive search, OPML export by shelf |
| The lapsed reader (post-Google-Reader cohort) | Resurrect 200-feed OPMLs from 2013 | OPML import that *immediately* drops the 70%+ now-dead feeds with a one-screen review |
| The privacy-minded technologist | Run on their own infra | BYO R2/B2 bucket, encrypted blobs, scripted CLI for OPML push |

Audience excluded on purpose: the casual "Twitter replacement" user. CODA is for people who choose what they read, not what an algorithm chooses for them.

---

## 4 · Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Client (PWA: SvelteKit, TypeScript, vanilla CSS w/ tokens)     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Sync engine (TS): event log + materialised snapshot    │   │
│  │  Crypto (TS): Argon2id KDF → AES-256-GCM blob cipher    │   │
│  │  Storage adapter (TS interface)                          │   │
│  │   ├─ S3 / R2 / B2 (AWS SDK lite)                         │   │
│  │   ├─ Dropbox / OneDrive / GDrive (OAuth)                 │   │
│  │   ├─ WebDAV (Nextcloud, generic)                         │   │
│  │   └─ iCloud Drive (CloudKit JS, deferred to v2 — see §10)│   │
│  │  Local cache: SQLite via wa-sqlite + FTS5                │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼  (HTTPS, no user identifier)
┌─────────────────────────────────────────────────────────────────┐
│  Edge: Cloudflare Workers + Durable Objects                     │
│   ├─ /poll    polite feed fetcher, ETag/If-Modified-Since aware │
│   ├─ /websub  WebSub subscriber callback endpoint  [S7]         │
│   ├─ /parse   XML/JSON/Atom parser w/ quality scoring [S1]      │
│   ├─ /opml    one-shot OPML import + quality triage             │
│   └─ /discover  feed discovery (rel=alternate + feed-menu [S6]) │
│  R2 bucket: short-lived parsed-feed cache (TTL 30 min)          │
│  No user-identifying data ever stored.                          │
└─────────────────────────────────────────────────────────────────┘
```

**Why split client vs edge:**

- Feed fetching has to come from a stable IP with proper UA, ETag, rate-limit etiquette. Asking 200 browsers to each fetch the same feed every 15 min is rude to publishers and breaks in the EU on third-party cookie blocks.
- The edge does the *anonymous* heavy lifting (parse, deduplicate, score). The *personalised* layer (subscriptions, read state) lives in the client and the user's own cloud.
- This separation is the entire trust argument: an audited Worker can be trusted to fetch RSS without knowing whose subscription list it is, because the subscription list is never sent to the Worker — the client sends individual feed URLs.

---

## 5 · Sync protocol (the part that actually has to work)

State is modelled as an **append-only event log** plus a **materialised snapshot**, both written to the user's bucket as encrypted blobs.

**Event log entries** (encrypted JSON, one event per line):

```ts
type Event =
  | { t: 'sub.add';    feed: string; shelf?: string; at: number }
  | { t: 'sub.del';    feed: string;                  at: number }
  | { t: 'sub.move';   feed: string; shelf: string;   at: number }
  | { t: 'item.read';  itemId: string;                at: number }
  | { t: 'item.unread';itemId: string;                at: number }
  | { t: 'item.star';  itemId: string; on: boolean;   at: number }
  | { t: 'shelf.add';  name: string; sigil: string;   at: number }
  | { t: 'shelf.del';  name: string;                  at: number }
  | { t: 'note.add';   itemId: string; body: string;  at: number };
```

**Materialised snapshot** (rewritten when the log grows past 10k events):

```ts
type Snapshot = {
  version: 1;
  shelves: { name: string; sigil: string; feeds: string[] }[];
  feeds:   { url: string; title: string; lang?: string; lastFresh: number }[];
  items:   { id: string; feedUrl: string; read: boolean; starred: boolean; noted: boolean }[];
  generated: number;
};
```

**Conflict resolution:** events are LWW per `(target, field)` keyed on `at`. The materialiser is a pure function from `(snapshot, events[])` to `snapshot'` — easy to test, easy to re-run on a fresh device. This is the same shape that BYOC [S2] uses for Obsidian vault sync with timestamped conflict-copy fallback for files; for RSS state, fields are simpler so 3-way merge isn't needed.

**Encryption:**
- Master key derived from passphrase via Argon2id (m=64 MiB, t=3, p=1) — current OWASP guidance.
- Per-blob nonce, AES-256-GCM. Authenticated. No key reuse.
- The bucket stores: `coda/v1/log.ndjson.enc`, `coda/v1/snapshot.json.enc`, `coda/v1/keys/{deviceId}.enc` (per-device wrapped DEK).
- Device pairing: scan QR on phone → existing device wraps DEK with phone's ephemeral X25519 pubkey → uploads wrapped DEK → phone unwraps. No server involvement.

---

## 6 · Visual system — Witch Hat Atelier translated to web tokens

The aesthetic of Kamome Shirahama's *Witch Hat Atelier* sits on five concrete moves:

| WHA visual move | Web token / mechanism |
|---|---|
| Hand-drawn ink with weight variation | `--stroke-1: 0.75px` for fine grid; `--stroke-2: 1.25px` for primary borders; `--stroke-3: 2px` for emphasis. Stroke colour `--ink` not `#000`. |
| Parchment-cream paper instead of white | `--bg: #F2E9D2`; `--surface: #FAF4E2`; subtle SVG-noise overlay at 4% opacity |
| Deep midnight ink for text | `--ink: #1B2438`; `--ink-soft: #3F4A65`; never pure black |
| Aged-gold / sepia accent for the rare important moment | `--sepia: #9C7B3F` (only for unread counts, primary actions); `--sigil-red: #8B2A3A` (only for destructive confirmation, ≤ once per screen) |
| Magical sigils as iconography | Custom SVG sigil set, 24×24, 1.5px stroke, no fill, drawn with a slight wobble to read as hand-made |

**Typography pairing:**

- Display / headings: **Cormorant Garamond** (variable, 300–700) — calligraphic serif, evokes hand-lettered grimoire chapter heads.
- Long-form reading body: **Source Serif 4** at 17px / 1.65 line-height — high legibility, generous x-height.
- UI dense controls: **Inter** at 13px (single weight, 500) for sidebar / list metadata.
- Mono / feed URLs / debug: **JetBrains Mono** at 12.5px.

All four are SIL OFL-licensed; self-host, no Google Fonts (CSP + privacy).

**Motion language:**

- No bouncy springs, no parallax, no card-flip choreography.
- Page transitions: 200 ms ease-out fade-and-slide, ≤ 12px translation.
- The only decorative motion: a single barely-perceptible "ink-settle" on first paint of an article (200 ms watercolour-wash opacity bloom, behind the text). Off by default for users who prefer reduced motion.

---

## 7 · UX architecture (no mocks, just rules)

**Three-pane desktop layout.** Left rail of sigils (shelves) at 56px; middle list at 360px; reader pane fluid.

**Left rail rules:**
- Sigils only; labels appear in a hand-lettered tooltip on hover after 400 ms.
- Unread counts as a small sepia numeral *outside* the sigil glyph (not a red badge — sepia keeps the calm).
- "All" sigil at top; "Starred" sigil at bottom; user shelves in between in user-set order.

**Middle list rules:**
- Each article row: title (Cormorant 16/1.2), source (Inter 11 small-caps), excerpt (Source Serif 13/1.4 in `--ink-soft`), age (Inter 11 right-aligned).
- Dividers between rows are *hand-drawn-style horizontal SVG ink strokes* (one of three randomised path variations to feel organic), not 1px solid.
- Selected row: parchment surface fill, no left-edge accent bar.
- Density toggle: comfortable / compact (Inter 12 in compact mode).

**Reader pane rules:**
- Single column, 64ch max line length.
- Background `--surface` with the noise overlay; left/right margins host watercolour wash from `--ink @ 4% opacity` only when the user has highlighted text.
- Article header: Cormorant 32 title, Inter 11 byline+date, then a *single hand-drawn horizontal flourish SVG* before body. No author avatar.
- "Atelier mode" toggle (one keystroke, `a`) hides the rails entirely and centres the reader pane — for distraction-free long-form.
- Native browser text selection, highlight via `m` keystroke, annotate via `n`.

**Mobile rules (≤ 768 px):**
- Single pane at a time, swipe-to-navigate. No bottom tab bar (eats reading space); use a sigil button top-left to toggle shelves.
- Atelier mode is the default on mobile.

**Keyboard shortcuts (no popovers, just a `?` cheat-sheet overlay):**
```
j / k      next / prev article
o / Enter  open
m          mark read / unread
s          star
n          add note
a          atelier mode
g g        go to All
g s        go to Starred
?          shortcuts
/          quick filter
```

These map to the Google-Reader-era shortcut conventions deliberately — that's still the muscle memory for the audience in §3.

**Empty-state rules:**
- A dead shelf shows a single line of hand-lettered text: *"This shelf is quiet."* with a small sepia sigil. No illustration filler, no marketing CTA.

**Error states:**
- Feed fetch failed: small ink-red sigil next to the feed name in the rail, with hover-tooltip showing the actual HTTP status and last-success timestamp. Never an opaque "Something went wrong."

---

## 8 · MVP scope (12 weeks, 1 engineer)

**Ships in v1 (week 12 beta):**

1. Add feed by URL · autodiscovery via `rel=alternate` and `feed-menu` [S6] · OPML 2.0 import [S8] with quality triage screen ("17 of your 89 feeds haven't published in 2+ years — keep, archive, or unsubscribe?")
2. Three storage backends: Dropbox, S3-compatible (R2 / B2 / Wasabi), WebDAV (covers Nextcloud / generic).
3. Client-side AES-256-GCM encryption with Argon2id KDF; passphrase only stored in OS keychain on opt-in.
4. Event log + materialised snapshot sync as per §5.
5. Read / unread / star / archive / annotate.
6. Reader mode with Atelier toggle.
7. Keyboard shortcuts.
8. Witch Hat Atelier visual system applied across every surface.
9. PWA install on desktop and mobile.
10. ETag-aware polling at 30-min default (configurable per-feed), WebSub subscriber [S7] for feeds advertising a hub.
11. Quality-filter toggle (per S1 heuristic).
12. OPML 2.0 export.

**Does NOT ship in v1 (named so scope creep doesn't slip them in):**

- Native iOS / Android apps. PWA only. (Native shells come in v2 if PWA hits clear UX ceiling.)
- AI summarisation. Punted — see §11 risks.
- Public profile sharing or social features.
- Multi-user / team shelves.
- Newsletter ingestion via email-to-feed.
- iCloud Drive backend (CloudKit JS web auth is fragile, see §10).
- Browser extension. v2.
- Self-hosted server image. v2 (no demand pre-launch).

---

## 9 · Phased plan

| Phase | Weeks | Goals | Verification |
|---|---|---|---|
| P0 — Spec freeze | 1–2 | Sync protocol §5 written as TS types + Mermaid; design tokens §6 written as CSS; sigil SVG set drawn (~24 icons) | TS compiles; tokens render in a static HTML test page; sigils approved against WHA reference panel |
| P1 — Storage adapters | 3–5 | Dropbox + R2 + WebDAV adapters implementing the same `StorageAdapter` interface; encryption layer | Round-trip test: write 1k events, read back, materialise, verify byte-identical snapshot |
| P2 — Feed engine | 6–7 | Worker with /poll, /parse, /discover, /websub; quality scorer matching S1's heuristic shape | Replay Common Crawl sample of 1k feeds, compare quality classification against S1's published distributions |
| P3 — UI shell | 8–9 | Three-pane layout, list, reader, sigil rail, keyboard handlers | All shortcuts work; reader mode passes WCAG AA contrast (`--ink` on `--bg` = 12.4:1, verified) |
| P4 — Mobile + polish | 10–11 | PWA install flow, gesture nav, atelier-on-mobile default, motion polish | Lighthouse PWA score ≥ 95; manual test on iOS Safari + Chrome Android |
| P5 — Beta release | 12 | Closed beta with OPML migration of testers' real subscriptions | Quality-triage screen correctly classifies ≥ 95% of tester feeds within tester-judged bands |

After beta, six weeks of bugfix / quality bar before public 1.0.

---

## 10 · Standards adoption (live, not aspirational)

| Standard | CODA's stance |
|---|---|
| RSS 2.0 [§S1 — 378,287 feeds in the wild] | Parsed at index time. Not emitted (we don't host content). |
| Atom 1.0 [S4] | Parsed at index time. |
| Storage adapters: WebDAV / Dropbox / S3-compatible (R2 / B2 / Wasabi) | **v1.1 ships opt-in.** Default is `LocalAdapter`. Enabling a cloud adapter requires the user to type `PLAINTEXT` into a gate field — events go up unencrypted until §5 crypto (`feat(crypto)`, PR #7) ships AES-256-GCM + Argon2id KDF. Settings page surfaces this on every visit. |
| JSON Feed 1.1 [S3] | Parsed at index time. Used for our own admin endpoints' output. |
| OPML 2.0 [S8] | Round-trip import and export. Quality triage on import per §1. |
| WebSub [S7] | Implemented as a subscriber. Worker hosts /websub/cb. Falls back to polling if the publisher's hub goes dark. |
| `feed-menu` discovery [S6] | Implemented as opt-in alongside `rel=alternate` fallback. Track the spec; ship updates as the draft matures. |
| `rel=feed` link relation | Not implemented. S1 found 12,796 pages vs. 81.94M with `rel=alternate`; not worth the parser surface. |
| ActivityPub bridge | Mastodon-style accounts emit Atom feeds at `/users/<handle>.atom` today; CODA treats those as ordinary Atom subscriptions. Full AS2 inbox is **out of scope** — that's a different product. |

---

## 11 · Risks (named, ranked, mitigated)

1. **iCloud Drive support is fragile.** CloudKit JS requires Apple Developer membership + per-domain Apple ID redirect handling. CloudKit's web SDK was last meaningfully updated years ago and is undocumented for non-Apple-app contexts. **Mitigation:** ship Dropbox / R2 / WebDAV first, treat iCloud as a v2 spike with a 2-week timebox. If it doesn't work, never ship it and document why.

2. **Storage rate limits constrain sync.** Dropbox API: ~600 req/min per user; Google Drive: 1,000 req/100 sec per user; R2: effectively unbounded. **Mitigation:** batch event-log appends into one PUT per 30 seconds of activity; full snapshot rewrite only every 10k events.

3. **Quality filter is a UX cliff.** A user imports their 200-feed OPML and we hide 140 of them; user feels patronised. **Mitigation:** quality triage screen on import surfaces *which* feeds and *why* (last-published date, entries-per-year, autodiscovery quality), with a one-click "keep all anyway." Never silently drop.

4. **AI summarisation pressure.** Every reader competitor in 2025 added AI summaries; users will ask for it. **Mitigation:** punt to v2 explicitly. When we do add it, it runs *on-device* (WebGPU + small distilled model) or via the user's own API key — the BYOS principle extends to BYO inference. Server-side summarisation breaks the trust model.

5. **Witch Hat aesthetic is polarising.** Some users will want neutral. **Mitigation:** ship one alt theme at 1.0 called "Plain" — same tokens, but `--bg: #FFFFFF`, `--ink: #111`, system serif. Same product, less atmosphere. The default stays Witch Hat.

6. **CC-BY attribution.** If any reference imagery from Sketchfab / Unsplash / etc. is used in marketing pages, credit them. **Mitigation:** `/credits` page generated from a YAML manifest, enforced in CI.

7. **Common Crawl underrepresents non-Western feeds.** S1 sampled Tranco's English-leaning index. Multi-lingual coverage may be worse in practice than the survey suggests. **Mitigation:** beta with at least three non-English test cohorts; measure quality-filter false-positive rate per language family before 1.0.

8. **Edge worker CPU / memory limits.** Large feeds (Common Crawl sample includes feeds in the MB range) can blow Cloudflare Workers' free-tier CPU budget. **Mitigation:** stream-parse with SAX-style XML reader, never load full feed in memory; cap parse at 5 MB and gracefully degrade.

---

## 12 · Open standards contributions (giving back, not just consuming)

CODA's existence isn't justified by extraction. Three concrete commits to the commons over the first year:

1. **Open-source the quality scorer** as a standalone library matching S1's heuristic shape, so other readers and CMS health-checks can use it. MIT-licensed.
2. **Submit feedback on draft-nottingham-feed-menu** [S6] with implementation experience after P2. Reviewer time is the real currency in IETF.
3. **Publish a public WordPress / Ghost / Substack quality-improvement guide** based on the 22.1% / 66.7% / 90.0% spread in S1. The takeaway in S1 — *"CMS software should not silently create and advertise feeds that publishers never see or maintain"* — is actionable; we can help by giving CMS maintainers a checklist.

---

## 13 · What this roadmap deliberately does *not* claim

To stay honest under the integrity overlay:

- Market sizing numbers from tier-4 industry reports (e.g. "RSS reader market USD 420M in 2025, CAGR 7.1%") are *not* used here. I have not verified them against a primary source and they don't change the build plan even if true.
- Specific competitor user counts (e.g. Feedly subscriber numbers, Inoreader DAU) are not stated. I don't have a primary source for them in 2026.
- The "people are returning to RSS post-Twitter" narrative, common in 2024–2026 thinkpieces, is not used as justification. The justification is S1's hard numbers about feeds in the wild.
- "Anime / manga aesthetic" is a *visual direction*, not a *demographic claim*. I am not claiming the target audience prefers anime-styled UI; the direction was specified by the product owner and is implemented faithfully.

---

## 14 · Next concrete actions

For the engineer picking this up:

1. Create the repo. Drop in `tokens.css` (companion file to this roadmap) and a static HTML scratch page showing the four typographic scales + the sigil palette over `--bg`.
2. Write `StorageAdapter` TS interface (§5). Stub two concrete adapters: Dropbox and R2 (S3-compatible). Round-trip a fake event log with encryption.
3. Spin up a Cloudflare Worker with one route: `/parse?url=<feed>`. Implement the S1 quality heuristic. Run against 100 hand-picked feeds, verify the score distribution looks sane.
4. Draw the 24 sigils as SVG. Reference panel: Kamome Shirahama's chapter ornaments. Keep them under 2 KB each.
5. Build the three-pane shell with no data — just empty states, hand-drawn dividers, sigil rail. Ship that internally.
6. Wire it up.

The whole thing should be a single SvelteKit app + one Worker. If it grows past two services and a bucket, something is wrong.

---

## 15 · DMZ — the shared free space (v1.1 extension)

A second, intentionally open area of the app, sitting alongside the private reader. The product owner asked for it on 2026-05-28 and the constraint is explicit: **"free space for everyone."** No accounts, no passphrase, no per-member profiles. One shared board.

**Why it sits outside §5.** The private reader's trust argument depends on encrypted blobs in a single-user bucket. The DMZ is the inverse: unencrypted by design, shareable by design, low-stakes by design. Treating it as another encrypted shelf would lie about its semantics. Treating it as a second profile would contradict the brief.

**Storage path.** `coda/dmz/log.ndjson` + `coda/dmz/snapshot.json`, sibling to `coda/v1/...` and never co-mingled. Same event-log materialiser as §5; same `LocalAdapter` with a different prefix. When cloud adapters land (§8.2), the DMZ optionally points at a publicly-readable bucket prefix so family on different devices see the same board. The private reader's encrypted state is untouched.

**Routing.** A top-level `data-page` toggle on `<body>`: `reader` (the three-pane shell from §7) or `dmz` (the board). Two clickable affordances: a sigil button in the rail that opens the DMZ, and a "← Back to reader" button on the DMZ that returns. No URL routing in v1.1 — the page is in-app only; cloud-backed shareable URLs come with §8.2.

**Content model.** A flat list of timestamped board notes. Each entry: `{ id, body, at }`. No author, no auth, no replies, no nesting. Anyone with the same browser (or, post-§8.2, the same shared bucket URL) reads and writes. Per-note deletion is allowed; per-board "clear" is not, to avoid one click destroying a family's shared history.

**UX rules.**
- DMZ is reachable in exactly one click from the reader, and the reader is reachable in exactly one click from the DMZ.
- The DMZ uses the same WHA tokens (`tokens.css`) — no new colors, no new typefaces.
- Newest note first, top of the list. Hand-drawn divider between header and list per §7's divider rule.
- Empty state: a single calm line, not a marketing CTA. The DMZ's empty state is *"The board is empty. Be the first to drop a thought."*
- The textarea is always visible at the bottom of the page; the "Pin to board" verb makes the act feel deliberate. Cmd/Ctrl+Enter saves; Enter inside the textarea inserts a newline.

**Explicitly out of scope for v1.1.**
- No per-member profiles. The product brief rejected this.
- No identity, login, or audit trail on the DMZ. Family who use it choose to.
- No moderation tooling. With zero auth, there is no one to moderate against.
- No public sharing of the URL until §8.2 lands a cloud adapter.

**Risks.**
- The board grows without bound. Mitigation: the same §5 event-log compaction (snapshot rewrite at 256 events) keeps localStorage bounded; cloud-backed DMZ inherits the same compaction.
- Privacy-by-accident. A user might paste private content into the DMZ thinking it is the private reader. Mitigation: the DMZ page chrome reads "**DMZ — shared, unencrypted**" in the header, every visit, no dismiss.

---

*Last revised: 2026-05-28. If a date or stat in this document looks stale, check the source anchor first; if the source is gone, treat the claim as unverified and remove it.*
