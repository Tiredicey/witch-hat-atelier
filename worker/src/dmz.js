import { moderateText } from "./moderation.js";

const MAX_BODY = 100000;
const PAGE_LIMIT = 500;
const DEFAULT_MAX_FILE_MB = 25;
const BLOCKED_EXT = new Set(["exe","msi","bat","cmd","com","scr","pif","jar","sh","bash","ps1","psm1","vbs","vbe","js","mjs","cjs","wsf","hta","apk","app","deb","rpm","dll","so","dylib","html","htm","xhtml","shtml","svg","swf","wasm","php","phtml","asp","aspx","jsp","cgi"]);
const INLINE_MIME = /^(image\/(?!svg)|video\/|audio\/|application\/pdf$)/i;
const HMAC_VERSION = "v1";
const LOG_KEY = "dmz/log.ndjson";
const SNAPSHOT_KEY = "dmz/snapshot.json";
const MIGRATED_KEY = "dmz/migrated.json";
const GH_API = "https://api.github.com";
const UA = "CODA-DMZ/1.0";

function corsHeaders(env, req) {
  const origin = req?.headers?.get?.("origin") || "*";
  const allowed = (env.DMZ_ALLOWED_ORIGINS || "*").split(",").map(s => s.trim()).filter(Boolean);
  const allow = allowed.includes("*") || allowed.includes(origin) ? origin : allowed[0] || "*";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-dmz-token,x-dmz-owner,x-dmz-client",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function json(body, init = {}, env, req) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(env, req),
      ...(init.headers || {}),
    },
  });
}

function err(status, code, detail, env, req) {
  return json({ ok: false, error: code, detail }, { status }, env, req);
}

function base64url(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return base64url(new Uint8Array(sig));
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return acc === 0;
}

async function makeDeleteToken(env, noteId, clientId) {
  if (!env.DMZ_HMAC_SECRET) throw new Error("DMZ_HMAC_SECRET not configured");
  const cid = String(clientId || "anon").slice(0, 64);
  return `${HMAC_VERSION}.${cid}.${await hmac(env.DMZ_HMAC_SECRET, `${HMAC_VERSION}|${noteId}|${cid}`)}`;
}

async function verifyDeleteToken(env, noteId, token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [ver, cid, sig] = parts;
  if (ver !== HMAC_VERSION) return false;
  const expected = await hmac(env.DMZ_HMAC_SECRET, `${HMAC_VERSION}|${noteId}|${cid}`);
  return constantTimeEqual(expected, sig);
}

function isOwner(env, req) {
  const provided = req.headers.get("x-dmz-owner");
  if (!provided || !env.DMZ_OWNER_TOKEN) return false;
  return constantTimeEqual(provided, env.DMZ_OWNER_TOKEN);
}

function ensureConfigured(env) {
  const missing = [];
  if (!env.DMZ_GITHUB_TOKEN) missing.push("DMZ_GITHUB_TOKEN");
  if (!env.DMZ_GITHUB_OWNER) missing.push("DMZ_GITHUB_OWNER");
  if (!env.DMZ_GITHUB_REPO) missing.push("DMZ_GITHUB_REPO");
  if (!env.DMZ_HMAC_SECRET) missing.push("DMZ_HMAC_SECRET");
  if (!env.DMZ_OWNER_TOKEN) missing.push("DMZ_OWNER_TOKEN");
  return missing;
}

function ghHeaders(env) {
  return {
    "authorization": `Bearer ${env.DMZ_GITHUB_TOKEN}`,
    "accept": "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": UA,
  };
}

function repoBase(env) {
  return `${GH_API}/repos/${env.DMZ_GITHUB_OWNER}/${env.DMZ_GITHUB_REPO}`;
}

function branch(env) {
  return env.DMZ_GITHUB_BRANCH || "dmz-data";
}

function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function ghGetFile(env, path) {
  const url = `${repoBase(env)}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch(env))}`;
  const r = await fetch(url, { headers: ghHeaders(env) });
  if (r.status === 404) return { exists: false };
  if (!r.ok) throw new Error(`github get ${path}: ${r.status} ${await r.text().catch(() => "")}`);
  const j = await r.json();
  return { exists: true, sha: j.sha, content: j.content ? b64decode(j.content) : "" };
}

async function ghPutFile(env, path, content, sha, message) {
  const url = `${repoBase(env)}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
  const body = {
    message: message || `dmz: update ${path}`,
    content: b64encode(content),
    branch: branch(env),
    ...(sha ? { sha } : {}),
  };
  const r = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(env), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const error = new Error(`github put ${path}: ${r.status} ${text}`);
    error.status = r.status;
    throw error;
  }
  return r.json();
}

async function withRetry(fn, max = 3) {
  let lastErr;
  for (let i = 0; i < max; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (e.status !== 409 && e.status !== 422) throw e;
      await new Promise(r => setTimeout(r, 250 * Math.pow(2, i) + Math.random() * 200));
    }
  }
  throw lastErr;
}

function parseLog(content) {
  if (!content) return [];
  const notes = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const n = JSON.parse(trimmed);
      if (n && typeof n.id === "string" && (typeof n.body === "string" || n.op === "del")) notes.push(n);
    } catch {}
  }
  return notes;
}

function materialise(events) {
  const byId = new Map();
  for (const ev of events) {
    if (ev.op === "del") {
      byId.delete(ev.id);
    } else if (ev.op === "edit") {
      const existing = byId.get(ev.id);
      if (existing) byId.set(ev.id, { ...existing, body: ev.body, editedAt: ev.at });
    } else {
      byId.set(ev.id, {
        id: ev.id,
        body: ev.body,
        at: ev.at,
        name: ev.name || "",
        clientId: ev.cid || "anon",
        editedAt: ev.editedAt || null,
        kind: ev.kind || "text",
        file: ev.file || null,
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

async function loadState(env) {
  const file = await ghGetFile(env, LOG_KEY);
  const events = parseLog(file.content || "");
  return { events, sha: file.sha, exists: file.exists };
}

async function appendEvent(env, event) {
  return withRetry(async () => {
    const state = await loadState(env);
    const next = state.events.concat([event]);
    const ndjson = next.map(e => JSON.stringify(e)).join("\n") + "\n";
    const snapshot = JSON.stringify(materialise(next), null, 0);
    await ghPutFile(env, LOG_KEY, ndjson, state.sha, `dmz: ${event.op} ${event.id}`);
    const snapFile = await ghGetFile(env, SNAPSHOT_KEY);
    await ghPutFile(env, SNAPSHOT_KEY, snapshot, snapFile.sha, `dmz: refresh snapshot`);
    return next;
  });
}

function fileLimitBytes(env) {
  const mb = Number(env.DMZ_MAX_FILE_MB) || DEFAULT_MAX_FILE_MB;
  return Math.max(1, mb) * 1024 * 1024;
}

function ensureFileConfigured(env) {
  const missing = [];
  if (!env.DMZ_TELEGRAM_TOKEN) missing.push("DMZ_TELEGRAM_TOKEN");
  if (!env.DMZ_TELEGRAM_CHAT) missing.push("DMZ_TELEGRAM_CHAT");
  return missing;
}

function extOf(name) {
  const dot = String(name || "").lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function safeName(name) {
  const base = String(name || "file").split(/[\\\\/]/).pop().slice(0, 120);
  return base.replace(/[\\u0000-\\u001f\\u007f"]/g, "").trim() || "file";
}

function tgBase(env) {
  return `https://api.telegram.org/bot${env.DMZ_TELEGRAM_TOKEN}`;
}

async function tgSendDocument(env, bytes, filename, mime) {
  const fd = new FormData();
  fd.append("chat_id", String(env.DMZ_TELEGRAM_CHAT));
  fd.append("disable_notification", "true");
  fd.append("document", new Blob([bytes], { type: mime || "application/octet-stream" }), filename);
  const r = await fetch(`${tgBase(env)}/sendDocument`, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`telegram sendDocument: ${j.description || r.status}`);
  const res = j.result || {};
  const doc = res.document || res.video || res.audio || (Array.isArray(res.photo) ? res.photo[res.photo.length - 1] : null);
  if (!doc || !doc.file_id) throw new Error("telegram sendDocument: missing file_id");
  return { fileId: doc.file_id, size: doc.file_size || bytes.byteLength };
}

async function tgGetFilePath(env, fileId) {
  const r = await fetch(`${tgBase(env)}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false || !j.result || !j.result.file_path) throw new Error(`telegram getFile: ${j.description || r.status}`);
  return j.result.file_path;
}

async function moderateImage(env, bytes, mime) {
  if (!env.AI || !env.DMZ_NSFW_MODEL || !/^image\\//i.test(mime || "")) return { ok: true };
  try {
    const out = await env.AI.run(env.DMZ_NSFW_MODEL, { image: [...new Uint8Array(bytes)] });
    const arr = Array.isArray(out) ? out : (out && out.results) || [];
    const thr = Number(env.DMZ_NSFW_THRESHOLD) || 0.6;
    for (const r of arr) {
      const label = String(r.label || r.className || "").toLowerCase();
      const score = Number(r.score ?? r.probability ?? 0);
      if (/nsfw|porn|explicit|hentai|nude|sexy|unsafe/.test(label) && score >= thr) {
        return { ok: false, label, score };
      }
    }
    return { ok: true };
  } catch (e) {
    if (env.DMZ_NSFW_FAILCLOSED === "true") return { ok: false, label: "classifier_error" };
    return { ok: true, skipped: e.message };
  }
}

async function findFileNote(env, id) {
  const snap = await ghGetFile(env, SNAPSHOT_KEY).catch(() => ({ exists: false }));
  let notes = [];
  if (snap.exists && snap.content) {
    try { notes = JSON.parse(snap.content); } catch { notes = materialise((await loadState(env)).events); }
  } else {
    notes = materialise((await loadState(env)).events);
  }
  if (!Array.isArray(notes)) return null;
  return notes.find(n => n && n.id === id && n.kind === "file" && n.file && n.file.tgFileId) || null;
}

async function postFile(env, req) {
  const missing = ensureConfigured(env).concat(ensureFileConfigured(env));
  if (missing.length) return err(503, "not_configured", { missing }, env, req);

  let form;
  try { form = await req.formData(); } catch { return err(400, "bad_payload", null, env, req); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return err(400, "no_file", null, env, req);

  const name = safeName(form.get("name") || file.name);
  const caption = String(form.get("caption") || "").trim();
  const mime = String(file.type || "application/octet-stream");
  const limit = fileLimitBytes(env);
  if (typeof file.size === "number" && file.size > limit) return err(413, "file_too_large", { limit }, env, req);
  if (BLOCKED_EXT.has(extOf(name))) return err(415, "bad_type", { ext: extOf(name) }, env, req);

  const verdict = moderateText(`${name} ${caption}`, { maxLength: MAX_BODY });
  if (!verdict.ok) return err(verdict.severity === "hard" ? 451 : 422, "moderation_blocked", { severity: verdict.severity }, env, req);

  const buf = await file.arrayBuffer();
  if (buf.byteLength > limit) return err(413, "file_too_large", { limit }, env, req);
  const imageVerdict = await moderateImage(env, buf, mime);
  if (!imageVerdict.ok) return err(422, "moderation_blocked", { severity: "nsfw", source: "image" }, env, req);

  const up = await tgSendDocument(env, new Uint8Array(buf), name, mime);

  const id = crypto.randomUUID();
  const at = Date.now();
  const clientId = (req.headers.get("x-dmz-client") || "anon").toString().slice(0, 64);
  await appendEvent(env, {
    op: "add", id, body: caption, at, name: "", cid: clientId,
    kind: "file", file: { name, mime, size: up.size, tgFileId: up.fileId },
  });
  const deleteToken = await makeDeleteToken(env, id, clientId);
  return json({ ok: true, id, at, deleteToken, file: { name, mime, size: up.size } }, {}, env, req);
}

async function getFile(env, req, url) {
  const missing = ensureConfigured(env).concat(ensureFileConfigured(env));
  if (missing.length) return err(503, "not_configured", { missing }, env, req);
  const id = url.searchParams.get("id");
  if (!id) return err(400, "missing_id", null, env, req);
  const note = await findFileNote(env, id);
  if (!note) return err(404, "not_found", null, env, req);

  const path = await tgGetFilePath(env, note.file.tgFileId);
  const r = await fetch(`https://api.telegram.org/file/bot${env.DMZ_TELEGRAM_TOKEN}/${path}`);
  if (!r.ok) return err(502, "blob_unavailable", { status: r.status }, env, req);

  const mime = note.file.mime || "application/octet-stream";
  const inline = INLINE_MIME.test(mime);
  const headers = {
    ...corsHeaders(env, req),
    "content-type": inline ? mime : "application/octet-stream",
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeName(note.file.name)}"`,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };
  return new Response(r.body, { status: 200, headers });
}

async function postNote(env, req) {
  const missing = ensureConfigured(env);
  if (missing.length) return err(503, "not_configured", { missing }, env, req);

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload.body !== "string") return err(400, "bad_payload", null, env, req);

  const body = payload.body.trim();
  if (!body) return err(400, "empty", null, env, req);

  const verdict = moderateText(body, { maxLength: MAX_BODY });
  if (!verdict.ok) return err(verdict.severity === "hard" ? 451 : 422, "moderation_blocked", { severity: verdict.severity }, env, req);

  const id = crypto.randomUUID();
  const at = Date.now();
  const clientId = (req.headers.get("x-dmz-client") || payload.clientId || "anon").toString().slice(0, 64);
  const name = typeof payload.name === "string" ? payload.name.slice(0, 64) : "";

  await appendEvent(env, { op: "add", id, body, at, name, cid: clientId });
  const deleteToken = await makeDeleteToken(env, id, clientId);
  return json({ ok: true, id, at, deleteToken }, {}, env, req);
}

async function listNotes(env, req) {
  const missing = ensureConfigured(env);
  if (missing.length) return err(503, "not_configured", { missing }, env, req);

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10), 1), PAGE_LIMIT);

  const snapFile = await ghGetFile(env, SNAPSHOT_KEY).catch(() => ({ exists: false }));
  let notes;
  if (snapFile.exists && snapFile.content) {
    try { notes = JSON.parse(snapFile.content); }
    catch { notes = materialise((await loadState(env)).events); }
  } else {
    notes = materialise((await loadState(env)).events);
  }
  if (!Array.isArray(notes)) notes = [];
  return json({ ok: true, notes: notes.slice(0, limit) }, {}, env, req);
}

async function editNote(env, req) {
  const missing = ensureConfigured(env);
  if (missing.length) return err(503, "not_configured", { missing }, env, req);

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload.id !== "string" || typeof payload.body !== "string") return err(400, "bad_payload", null, env, req);

  const body = payload.body.trim();
  if (!body) return err(400, "empty", null, env, req);

  const verdict = moderateText(body, { maxLength: MAX_BODY });
  if (!verdict.ok) return err(verdict.severity === "hard" ? 451 : 422, "moderation_blocked", { severity: verdict.severity }, env, req);

  const token = req.headers.get("x-dmz-token");
  const ownerOk = isOwner(env, req);
  const senderOk = await verifyDeleteToken(env, payload.id, token);
  if (!ownerOk && !senderOk) return err(403, "forbidden", null, env, req);

  await appendEvent(env, { op: "edit", id: payload.id, body, at: Date.now() });
  return json({ ok: true, id: payload.id }, {}, env, req);
}

async function deleteNote(env, req) {
  const missing = ensureConfigured(env);
  if (missing.length) return err(503, "not_configured", { missing }, env, req);

  const payload = await req.json().catch(() => ({}));
  if (typeof payload.id !== "string" || !payload.id) return err(400, "missing_id", null, env, req);

  const token = req.headers.get("x-dmz-token");
  const ownerOk = isOwner(env, req);
  const senderOk = await verifyDeleteToken(env, payload.id, token);
  if (!ownerOk && !senderOk) return err(403, "forbidden", null, env, req);

  await appendEvent(env, { op: "del", id: payload.id, at: Date.now() });
  return json({ ok: true }, {}, env, req);
}

async function migrate(env, req) {
  const missing = ensureConfigured(env);
  if (missing.length) return err(503, "not_configured", { missing }, env, req);
  if (!isOwner(env, req)) return err(403, "owner_only", null, env, req);

  const payload = await req.json().catch(() => null);
  if (!payload || !Array.isArray(payload.notes)) return err(400, "bad_payload", null, env, req);

  const marker = await ghGetFile(env, MIGRATED_KEY).catch(() => ({ exists: false }));
  if (marker.exists) return err(409, "already_migrated", null, env, req);

  const existing = await loadState(env);
  if (existing.events.length > 0) return err(409, "log_not_empty", null, env, req);

  const results = [];
  const newEvents = [];
  for (const raw of payload.notes.slice(0, 1000)) {
    if (!raw || typeof raw.body !== "string" || !raw.body.trim()) continue;
    const verdict = moderateText(raw.body, { maxLength: MAX_BODY });
    if (!verdict.ok) {
      results.push({ id: raw.id, status: "blocked", severity: verdict.severity });
      continue;
    }
    const id = typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID();
    const at = typeof raw.at === "number" ? raw.at : Date.now();
    newEvents.push({ op: "add", id, body: raw.body.trim(), at, name: "", cid: "migrated" });
    results.push({ id, status: "ok" });
  }

  if (newEvents.length) {
    const ndjson = newEvents.map(e => JSON.stringify(e)).join("\n") + "\n";
    const snapshot = JSON.stringify(materialise(newEvents), null, 0);
    await ghPutFile(env, LOG_KEY, ndjson, existing.sha, "dmz: migrate from localStorage");
    const snapFile = await ghGetFile(env, SNAPSHOT_KEY);
    await ghPutFile(env, SNAPSHOT_KEY, snapshot, snapFile.sha, "dmz: snapshot after migration");
  }

  await ghPutFile(env, MIGRATED_KEY, JSON.stringify({ at: Date.now(), count: newEvents.length }, null, 2), null, "dmz: mark migrated");
  return json({ ok: true, migrated: newEvents.length, results }, {}, env, req);
}

async function health(env, req) {
  return json({ ok: true, configured: ensureConfigured(env).length === 0, files: ensureFileConfigured(env).length === 0, branch: branch(env) }, {}, env, req);
}

export async function handleDmz(req, url, env) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env, req) });
  const path = url.pathname;
  if (path === "/dmz/health") return health(env, req);
  if (path === "/dmz/messages" && req.method === "GET") return listNotes(env, req);
  if (path === "/dmz/message" && req.method === "POST") return postNote(env, req);
  if (path === "/dmz/message" && req.method === "PATCH") return editNote(env, req);
  if (path === "/dmz/message" && req.method === "DELETE") return deleteNote(env, req);
  if (path === "/dmz/file" && req.method === "POST") return postFile(env, req);
  if (path === "/dmz/file" && req.method === "GET") return getFile(env, req, url);
  if (path === "/dmz/migrate" && req.method === "POST") return migrate(env, req);
  return null;
}
