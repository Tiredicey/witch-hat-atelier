// feed-source.js
//
// Browser-side reader for the §4 Cloudflare Worker output. The Worker writes
// `coda/feeds/snapshot.json` to the user's R2 bucket. This module loads that
// snapshot via the active adapter's generic `read(key)` method and returns
// normalised entries (or null, so app.js can fall back to SAMPLE).
//
// Today only the S3 adapter is supported as the feed source — the §4 Worker
// is Cloudflare-native and writes to R2. Users on other adapters can still
// import OPML and export OPML for round-trip purposes, but won't see real
// entries until they configure an R2 bucket + Worker.

const SNAPSHOT_KEY = "coda/feeds/snapshot.json";

export async function loadFeedSnapshot(settings, adapter) {
  if (!settings || settings.kind !== "s3") return null;
  if (!adapter || typeof adapter.read !== "function") return null;
  try {
    const raw = await adapter.read(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap || !Array.isArray(snap.entries)) return null;
    return snap.entries
      .slice()
      .sort((a, b) => (b.published || 0) - (a.published || 0));
  } catch (e) {
    console.warn("feed-source: snapshot load failed", e);
    return null;
  }
}
