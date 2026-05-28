// feed-source.js
//
// Browser-side reader for the §4 Cloudflare Worker output. The Worker writes
// `coda/feeds/snapshot.json` to the user's R2 bucket. This module reads that
// snapshot using the same SigV4 signer the S3Adapter uses, normalises the
// entries to match the ArticleList shape, and returns either the entries or
// null (so app.js can fall back to SAMPLE).
//
// Only the S3 adapter is supported as a source. Dropbox and WebDAV users
// don't get real feeds yet (the §4 Worker is Cloudflare-native). LocalAdapter
// users obviously can't have a Worker-fed snapshot either.

import { signRequest } from "./adapters/sigv4.js";

const SNAPSHOT_KEY = "coda/feeds/snapshot.json";

export async function loadFeedSnapshot(settings) {
  if (!settings || settings.kind !== "s3") return null;
  const { endpoint, region = "auto", accessKeyId, secretAccessKey, bucket } = settings;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;

  const url = `${endpoint.replace(/\/+$/, "")}/${bucket}/${SNAPSHOT_KEY}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const headers = await signRequest({
      method: "GET",
      url,
      body: "",
      region,
      service: "s3",
      accessKey: accessKeyId,
      secretKey: secretAccessKey,
    });
    const r = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (r.status === 404) return null;
    if (!r.ok) {
      console.warn("feed-source: snapshot fetch failed", r.status);
      return null;
    }
    const snap = await r.json();
    if (!snap || !Array.isArray(snap.entries)) return null;
    return snap.entries;
  } catch (e) {
    if (e.name === "AbortError") console.warn("feed-source: snapshot fetch timed out");
    else console.warn("feed-source: snapshot fetch error", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
