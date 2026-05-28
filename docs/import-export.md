# Import / export your subscriptions

CODA Settings can read and write OPML 2.0 — the lingua franca of feed-reader exports. After this PR, you do not need to edit `worker/wrangler.toml` to change your subscription list. You upload an OPML file in the browser, the file is written to your storage adapter at `coda/subs/subscriptions.json`, and the §4 Worker reads it on its next cron tick.

## Import: OPML → CODA

1. Open the deployed site → click the cog sigil at the bottom of the rail.
2. Scroll to **Import subscriptions (OPML)**.
3. Pick your `subscriptions.opml` (or `.xml` from a previous reader — Inoreader, Feedly, NetNewsWire, Reeder all work).
4. A **triage panel** appears with every parsed feed grouped by folder. Every feed is checked by default; uncheck anything dormant, broken, or unwanted.
5. Click **Import N of M** to commit. The status line shows how many feeds landed and how many you dropped. **Cancel** abandons the import without writing anything.
6. Wait up to 30 minutes for the next Worker cron tick. The Worker fetches every feed, applies the §1 quality heuristic, and writes the merged entries snapshot to `coda/feeds/snapshot.json`. The site reads that on reload.

### Why manual triage instead of auto-flagging dormant feeds?

The §1 pitch was "17 of your 89 feeds haven't published in 2+ years — keep, archive, or unsubscribe?" That signal needs per-feed last-publish metadata that only the §4 Worker can produce: the browser can't fetch most feeds directly (CORS), and probing 89 feeds inline during import would stall the page for minutes. Until the Worker exposes a `dormantFeeds[]` field on its snapshot, triage is fully manual. When that lands, the same triage UI will pre-uncheck dormant rows so you only have to confirm.

Where this lands in your storage:

| Adapter | Subscription file path |
|---|---|
| Cloudflare R2 / S3 | `coda/subs/subscriptions.json` in your bucket |
| GitHub | `coda/subs/subscriptions.json` in your repo |
| Dropbox | `<your-app-folder>/coda/subs/subscriptions.json` |
| WebDAV / Nextcloud | `<webdav-root>/coda/subs/subscriptions.json` |
| Local | `coda/subs/subscriptions.json` in browser `localStorage` |

The Worker only reads the R2 path. If you are on a non-R2 adapter, your subscriptions are stored for round-trip purposes but the §4 Worker will not see them — you would still need an R2 bucket and a deployed Worker for real feeds to flow into the reader.

## Export: CODA → OPML

1. Same Settings → **Import subscriptions** section.
2. Open the **Export current subscriptions** drawer at the bottom.
3. Click **Export OPML**.
4. A file named `coda-subscriptions.opml` downloads. Open it in any feed reader to migrate out, or re-import into CODA on another browser to sync your subscription list.

The exported OPML preserves your feed URLs, titles, and folder/shelf assignment. Read state, starred items, and notes are stored in the event log (`coda/v1/log.ndjson` on the active adapter), not in OPML — OPML is for subscriptions only.

## What about a folder→shelf map?

The reader's left rail shelves are still hardcoded stand-ins (`standards`, `indie`, `engineering`, `science`, `quiet`). Imported OPML folders are preserved in each feed's `shelf` field, but the rail doesn't render them dynamically yet. A future PR will replace the static rail with one rendered from your imported subscriptions; until then, all feeds appear on the "All" shelf regardless of folder.

## What this does NOT import

- **Starred items.** Inoreader's `starred.json` (or Google Reader's API export) uses a different schema. A separate PR adds a starred-items importer.
- **Saved web pages** (Inoreader-specific). The CODA reader has no archive-the-full-HTML concept; this content has no place to land.
- **Read state.** Each reader tracks read state independently. CODA starts your imported feeds as unread.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Import failed: malformed XML" | OPML file is HTML, truncated, or not valid XML | Open the file in a text editor; ensure it starts with `<?xml` and has matching `<opml>...</opml>` tags |
| "No feeds found in subscriptions.xml." | OPML had only folder outlines, no `<outline type="rss" xmlUrl="...">` | Check the file actually contains feed entries (search for `xmlUrl=`) |
| Import succeeds, Worker keeps using `wrangler.toml` feeds | Worker hasn't tick'd yet, or your R2 bucket is different from the Worker's | (a) wait up to 30 min, (b) confirm the bucket name in `worker/wrangler.toml` matches the bucket your Settings page is configured against |
| Export downloads an empty OPML | No subscriptions stored yet | Import an OPML first, then export to round-trip |
| Some imported feeds never appear in the reader | They failed the §1 quality bar (dormant / no content / metadata gaps) | Inspect `coda/feeds/meta.json` in your bucket; the `score` field shows why each feed was kept or dropped |
