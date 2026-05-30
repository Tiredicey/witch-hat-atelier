# DMZ Worker architecture

The DMZ (§15 in the roadmap) is the shared, unencrypted, free-for-everyone board. PR 1 introduces a Cloudflare-Worker-proxied path that lets every device opening the page see and post to the same log.

## Why a Worker proxy

The DMZ has no per-user auth: anyone with the page URL can read and write. That means three things have to happen server-side, not in the browser, or they are not enforced:

1. **Storage credentials.** The browser cannot hold a GitHub token without leaking it to anyone who opens the link. The Worker holds the PAT.
2. **Moderation.** A client-side classifier can be bypassed by any user with developer tools. The Worker classifier runs before any state hits the log.
3. **Sender attribution.** Per-note delete tokens are signed by an HMAC secret only the Worker knows. The Worker is the only place that can verify them.

## Storage

The Worker writes the DMZ event log to a dedicated branch of the repo via GitHub Contents API. Two files live on that branch:

- `dmz/log.ndjson` — append-only event log. One JSON object per line: `{ op: "add" | "edit" | "del", id, body?, at, name?, cid? }`.
- `dmz/snapshot.json` — materialised state, rewritten after every event so list reads are O(1) cached blobs.

The `dmz/migrated.json` marker file records the one-shot localStorage migration so it never re-fires.

`getChatHistory` does not exist on the Telegram Bot API; that is the reason we use GitHub, not Telegram, for the text log. Telegram becomes the file-storage backend in PR 2 once file uploads land.

## Routes

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET  | `/dmz/health`   | None | Reports whether the five required secrets are present. |
| GET  | `/dmz/messages` | None | Returns the snapshot, newest first, capped at 500. |
| POST | `/dmz/message`  | None | Posts a new note. Server runs moderation. Returns a delete token. |
| PATCH| `/dmz/message`  | sender or owner | Edits an existing note. Server re-runs moderation. |
| DELETE | `/dmz/message`| sender or owner | Removes a note. |
| POST | `/dmz/migrate`  | owner only | One-shot: replay the owner's localStorage DMZ into the empty shared log. Refuses if the log is non-empty. |

## Delete tokens (Messenger-style ownership)

When a note is posted, the Worker returns `deleteToken = "v1.<clientId>.<HMAC(DMZ_HMAC_SECRET, "v1|<noteId>|<clientId>")>"`. The client stores it in `localStorage` under `coda/dmz/delete-tokens`. To delete or edit, the client presents the token in `x-dmz-token`. The Worker recomputes the HMAC and constant-time-compares.

The owner token is a single global secret set on the Worker and pasted into Settings on the owner's browser. It bypasses the delete-token check on every note. Treat losing this token the same as losing the DMZ keys: anyone holding it can wipe the board.

## Configuration

On the Worker, set five secrets with `wrangler secret put`:

| Secret | Purpose |
|---|---|
| `DMZ_GITHUB_TOKEN` | Fine-grained PAT, Contents: Read & Write on the DMZ branch only |
| `DMZ_HMAC_SECRET` | Random 32+ byte string. Signs delete tokens. |
| `DMZ_OWNER_TOKEN` | Random 32+ byte string. Bypasses delete-token check. |

And three plain vars in `wrangler.toml`:

```toml
[vars]
DMZ_GITHUB_OWNER  = "your-github-login"
DMZ_GITHUB_REPO   = "witch-hat-atelier"
DMZ_GITHUB_BRANCH = "dmz-data"
DMZ_ALLOWED_ORIGINS = "https://witch-hat-atelier.pages.dev"
```

Before first run, create the `dmz-data` branch:

```
git checkout --orphan dmz-data
git rm -rf .
git commit --allow-empty -m "dmz: empty data branch"
git push origin dmz-data
```

In the browser, open Settings, paste the Worker URL into "Worker base URL", paste the owner token into "Owner token", tick "Use the Worker for the DMZ board on this device", and reload.

## Moderation

`worker/src/moderation.js` runs every body through:

1. **Unicode confusables fold.** Cyrillic / Greek / fullwidth lookalikes map to the closest ASCII letter. NFKD strips combining marks.
2. **Leetspeak normalisation.** `0→o`, `1→i`, `3→e`, `4→a`, `5→s`, `$→s`, `@→a`, `+→t`, and similar substitutions.
3. **Compressed-form check.** Whitespace and punctuation between letters are stripped so `f u c k` and `f.u.c.k` collapse to `fuck`.
4. **Word-boundary match** plus a **fuzzy hit** (single-character deletion, repeated-letter collapse) for terms of length ≥ 6.

Two severity levels:

- `hard` → terms in `HARD_BLOCK_LEXICON` (CSAM-adjacent, trafficking, exploitation). HTTP 451 on the response. These cannot be posted under any circumstance.
- `nsfw` → general adult lexicon. HTTP 422. Same outcome, different code so the UI can surface a different message later.

This is a deterministic classifier, not a model. It catches obvious cases and common bypass patterns. It does not understand context, paraphrase, or novel terminology. The upgrade path is Cloudflare Workers AI `@cf/meta/llama-guard-3-8b` once you opt the account into Workers AI (free tier 10,000 neurons/day, no card required). That upgrade is a follow-up PR.

## Polling

The client polls `GET /dmz/messages` every 5 seconds. Multi-device delay is therefore bounded by 5s + GitHub propagation. A Durable Object WebSocket push replaces this transparently in a follow-up PR by swapping the `RemoteDmzStore.start()` body; the rest of the architecture is unchanged.

## What this PR does not change

- The private reader vault (§5) is untouched. Different storage prefix, different adapter, different trust contract.
- Local-only DMZ (no Worker configured) keeps its current behavior: localStorage-backed, single-browser, anyone-can-delete. The new path activates only when the Settings checkbox is on.
- File uploads, image moderation, CSAM hashing are PR 2 work and intentionally absent here.
