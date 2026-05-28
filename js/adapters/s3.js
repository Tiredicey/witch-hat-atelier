import { signRequest } from "./sigv4.js";

function parseNdjson(text) {
  if (!text) return [];
  const out = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function eventsToNdjson(events) {
  return events.map(e => JSON.stringify(e)).join("\n");
}

export class S3Adapter {
  constructor({ endpoint, region = "auto", accessKeyId, secretAccessKey, bucket, prefix = "coda/v1" }) {
    if (!endpoint) throw new Error("S3Adapter: endpoint is required");
    if (!accessKeyId || !secretAccessKey) throw new Error("S3Adapter: access keys required");
    if (!bucket) throw new Error("S3Adapter: bucket is required");
    this.endpoint = endpoint.replace(/\/+$/, "");
    this.region = region;
    this.accessKey = accessKeyId;
    this.secretKey = secretAccessKey;
    this.bucket = bucket;
    this.prefix = prefix.replace(/^\/+|\/+$/g, "");
    this.logKey = `${this.prefix}/log.ndjson`;
    this.snapKey = `${this.prefix}/snapshot.json`;
  }

  #url(key) {
    return `${this.endpoint}/${this.bucket}/${key}`;
  }

  async #request(method, key, body) {
    const url = this.#url(key);
    const headers = await signRequest({
      method, url, body,
      region: this.region,
      service: "s3",
      accessKey: this.accessKey,
      secretKey: this.secretKey,
    });
    return fetch(url, { method, headers, body });
  }

  async readLog() {
    const r = await this.#request("GET", this.logKey);
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`S3 readLog ${r.status}`);
    return parseNdjson(await r.text());
  }

  async appendLog(events) {
    if (!events.length) return;
    const existing = await this.readLog();
    const body = eventsToNdjson([...existing, ...events]);
    const r = await this.#request("PUT", this.logKey, body);
    if (!r.ok) throw new Error(`S3 appendLog ${r.status}`);
  }

  async readSnapshot() {
    const r = await this.#request("GET", this.snapKey);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`S3 readSnapshot ${r.status}`);
    try { return await r.json(); } catch { return null; }
  }

  async writeSnapshot(snapshot) {
    const r = await this.#request("PUT", this.snapKey, JSON.stringify(snapshot));
    if (!r.ok) throw new Error(`S3 writeSnapshot ${r.status}`);
    await this.#request("DELETE", this.logKey).catch(() => {});
  }

  async clear() {
    await this.#request("DELETE", this.logKey).catch(() => {});
    await this.#request("DELETE", this.snapKey).catch(() => {});
  }

  async test() {
    const r = await this.#request("HEAD", this.snapKey);
    if (r.ok || r.status === 404) return { ok: true };
    if (r.status === 401 || r.status === 403) return { ok: false, error: "credentials rejected" };
    return { ok: false, error: `status ${r.status}` };
  }
}
