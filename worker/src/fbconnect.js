// Compliant Facebook connector (ROADMAP §19, design in docs/facebook-connect.md).
//
// Three GET routes, all self-contained (own CORS/JSON helpers, like dmz.js):
//   /fb/login     302 → Facebook OAuth dialog with an HMAC-signed state
//   /fb/callback  exchanges code → user access token, posts it to the opener
//   /fb/feed      calls the Graph API with the user token → Atom via buildAtom
//
// Config (per installation, never hardcoded):
//   env.FB_APP_ID         Meta app id            (wrangler var)
//   env.FB_APP_SECRET     Meta app secret        (wrangler secret; server-only)
//   env.FB_REDIRECT_URI   <origin>/fb/callback   (registered in the Meta app)
//   env.FB_GRAPH_VERSION  optional Graph version (default below; override freely)
//
// The app secret signs the OAuth state and exchanges the code. It never
// appears in any response body, so it never reaches the browser.

import { buildAtom } from "./scrape.js";

const DEFAULT_GRAPH_VERSION = "v21.0";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const FEED_LIMIT = 25;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function notConfigured() {
  return jsonResp({
    error: "not_configured",
    message: "Facebook connect is not set up on this Worker. Set FB_APP_ID, FB_APP_SECRET, and FB_REDIRECT_URI to enable it.",
  }, 200);
}

function graphVersion(env) {
  const v = (env.FB_GRAPH_VERSION || "").trim();
  return /^v\d+\.\d+$/.test(v) ? v : DEFAULT_GRAPH_VERSION;
}

function isConfigured(env) {
  return Boolean(env.FB_APP_ID && env.FB_APP_SECRET && env.FB_REDIRECT_URI);
}

function b64urlFromBytes(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromB64url(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function hmac(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return b64urlFromBytes(new Uint8Array(sig));
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signState(secret) {
  const payload = `${crypto.randomUUID()}.${Date.now()}`;
  const sig = await hmac(secret, payload);
  return `${b64urlFromBytes(new TextEncoder().encode(payload))}.${sig}`;
}

async function verifyState(secret, state) {
  if (typeof state !== "string" || state.split(".").length !== 2) return false;
  const [payloadB64, sig] = state.split(".");
  let payload;
  try { payload = new TextDecoder().decode(bytesFromB64url(payloadB64)); }
  catch { return false; }
  const expected = await hmac(secret, payload);
  if (!constantTimeEqual(sig, expected)) return false;
  const ts = Number(payload.split(".")[1]);
  return Number.isFinite(ts) && Date.now() - ts <= STATE_MAX_AGE_MS;
}

function postMessageHtml(payload) {
  const json = JSON.stringify({ source: "coda-fb", ...payload });
  const body = [
    "<!doctype html><meta charset=\"utf-8\"><title>CODA · Facebook</title>",
    "<body style=\"font:14px system-ui;padding:2rem;color:#2b2622;background:#f4efe6\">",
    "<p>You can close this window and return to CODA.</p>",
    "<script>",
    `(function(){var m=${json};try{if(window.opener){window.opener.postMessage(m,"*");}}catch(e){}`,
    "try{window.close();}catch(e){}})();",
    "</script></body>",
  ].join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function notConfiguredPopup() {
  return postMessageHtml({
    ok: false,
    error: "Facebook connect is not set up on this Worker yet. The site owner needs to set FB_APP_ID, FB_APP_SECRET, and FB_REDIRECT_URI (see docs/facebook-connect.md).",
  });
}

export async function handleFbLogin(req, url, env) {
  if (!isConfigured(env)) return notConfiguredPopup();
  const requested = (url.searchParams.get("scope") || "").trim();
  const scope = requested || "public_profile,user_posts,pages_show_list,pages_read_engagement";
  const state = await signState(env.FB_APP_SECRET);
  const dialog = new URL(`https://www.facebook.com/${graphVersion(env)}/dialog/oauth`);
  dialog.searchParams.set("client_id", env.FB_APP_ID);
  dialog.searchParams.set("redirect_uri", env.FB_REDIRECT_URI);
  dialog.searchParams.set("state", state);
  dialog.searchParams.set("response_type", "code");
  dialog.searchParams.set("scope", scope);
  return new Response(null, { status: 302, headers: { Location: dialog.toString(), ...corsHeaders() } });
}

export async function handleFbCallback(req, url, env) {
  if (!isConfigured(env)) return notConfiguredPopup();
  const err = url.searchParams.get("error");
  if (err) {
    return postMessageHtml({ ok: false, error: url.searchParams.get("error_description") || err });
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) return postMessageHtml({ ok: false, error: "Missing authorization code." });
  if (!(await verifyState(env.FB_APP_SECRET, state))) {
    return postMessageHtml({ ok: false, error: "State check failed. Start the connection again." });
  }
  const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion(env)}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", env.FB_APP_ID);
  tokenUrl.searchParams.set("redirect_uri", env.FB_REDIRECT_URI);
  tokenUrl.searchParams.set("client_secret", env.FB_APP_SECRET);
  tokenUrl.searchParams.set("code", code);
  let token = "";
  let expiresIn = 0;
  try {
    const res = await fetch(tokenUrl.toString());
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      const msg = (data && data.error && data.error.message) || `Token exchange failed (${res.status}).`;
      return postMessageHtml({ ok: false, error: msg });
    }
    token = data.access_token;
    expiresIn = Number(data.expires_in) || 0;
  } catch (e) {
    return postMessageHtml({ ok: false, error: `Token exchange error: ${String((e && e.message) || e)}` });
  }
  return postMessageHtml({ ok: true, token, expiresIn });
}

function kindToGraphPath(kind) {
  if (!kind || kind === "posts") return "me/posts";
  const m = /^(page|group):(.+)$/.exec(kind);
  if (m) return `${encodeURIComponent(m[2])}/feed`;
  return null;
}

function graphItemsToFeed(data, kind) {
  const rows = Array.isArray(data && data.data) ? data.data : [];
  const items = rows.map((row) => {
    const message = String(row.message || row.story || "").trim();
    const title = message ? (message.length > 80 ? `${message.slice(0, 77)}…` : message) : "(no text)";
    const stamp = row.created_time ? Date.parse(row.created_time) : NaN;
    return {
      title,
      link: row.permalink_url || "",
      published: Number.isFinite(stamp) ? stamp : undefined,
      excerpt: message || undefined,
      image: row.full_picture || undefined,
    };
  });
  const label = kind && kind.startsWith("page:") ? "Facebook Page"
    : kind && kind.startsWith("group:") ? "Facebook Group"
    : "My Facebook posts";
  return { items, label };
}

export async function handleFbFeed(req, url, env) {
  if (!isConfigured(env)) return notConfigured();
  const token = url.searchParams.get("token");
  const kind = url.searchParams.get("kind") || "posts";
  if (!token) return jsonResp({ error: "missing token" }, 400);
  const path = kindToGraphPath(kind);
  if (!path) return jsonResp({ error: "unknown kind" }, 400);
  const graphUrl = new URL(`https://graph.facebook.com/${graphVersion(env)}/${path}`);
  graphUrl.searchParams.set("fields", "message,story,permalink_url,created_time,full_picture");
  graphUrl.searchParams.set("limit", String(FEED_LIMIT));
  graphUrl.searchParams.set("access_token", token);
  let data;
  try {
    const res = await fetch(graphUrl.toString());
    data = await res.json();
    if (!res.ok || (data && data.error)) {
      const msg = (data && data.error && data.error.message) || `Graph request failed (${res.status}).`;
      return jsonResp({ error: msg }, 502);
    }
  } catch (e) {
    return jsonResp({ error: `Graph request error: ${String((e && e.message) || e)}` }, 502);
  }
  const { items, label } = graphItemsToFeed(data, kind);
  const selfUrl = `${url.origin}${url.pathname}?kind=${encodeURIComponent(kind)}`;
  const atom = buildAtom(items, { title: label, pageUrl: "https://www.facebook.com/", selfUrl });
  return new Response(atom, {
    status: 200,
    headers: { "Content-Type": "application/atom+xml; charset=utf-8", ...corsHeaders() },
  });
}
