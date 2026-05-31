// render.js
//
// Last-resort headless-render tier for the synthetic-feed fallback. Static
// fetch + scrape (scrape.js) always runs first; this only fires when that
// returns zero items, because some sites (GMA's lifestyle SPA, any
// client-rendered listing) ship a JS shell whose article list is injected
// after load and is invisible to raw-HTML scanning.
//
// FREE-FIRST by design. The default backend is Cloudflare Browser
// Rendering's REST `/content` endpoint, which is included on the Workers
// FREE plan (10 minutes of browser time per day, 3 concurrent browsers,
// ~6 REST calls/min). On the Free plan, exceeding those limits returns
// HTTP 429 and renders nothing further that UTC day; it never bills. This
// module treats 429 as a soft "quota reached" and degrades to no items, so
// staying on the Free plan means no surprise charge. To stretch the daily
// budget, every render rejects images, fonts, stylesheets, and media so a
// page costs the minimum browser time.
//
// Backends (auto-selected from env, no code change needed):
//   - "cloudflare": needs CF_ACCOUNT_ID + BROWSER_RENDER_TOKEN (an API
//     token with the Browser Rendering permission). Stay on Workers Free.
//   - "generic": set RENDER_URL to a Browserless-style POST /content
//     endpoint (e.g. a self-hosted instance, token in the URL). Body
//     { url } returns rendered HTML directly.
//   - none configured: renderHtml returns { ok:false } and the caller
//     falls back to "no synthetic feed", exactly as before this tier.

const DEFAULT_TIMEOUT_MS = 25_000;
const HARD_TIMEOUT_CAP_MS = 55_000;
const REJECT_RESOURCE_TYPES = ["image", "imageset", "media", "font", "stylesheet"];

export function rendererConfigured(env) {
  return pickBackend(env) !== "";
}

export async function renderHtml(targetUrl, env, opts = {}) {
  const backend = pickBackend(env);
  if (!backend) return { ok: false, reason: "no renderer configured" };

  const timeoutMs = Math.min(
    Number(env.RENDER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    HARD_TIMEOUT_CAP_MS,
  );
  const waitUntil = env.RENDER_WAIT_UNTIL || "networkidle2";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res;
    if (backend === "cloudflare") {
      const body = {
        url: targetUrl,
        rejectResourceTypes: REJECT_RESOURCE_TYPES,
        gotoOptions: { waitUntil, timeout: timeoutMs },
      };
      if (opts.waitForSelector) body.waitForSelector = { selector: opts.waitForSelector, timeout: timeoutMs };
      res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/content`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.BROWSER_RENDER_TOKEN}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
    } else {
      res = await fetch(env.RENDER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl, gotoOptions: { waitUntil } }),
        signal: controller.signal,
      });
    }

    if (res.status === 429) return { ok: false, reason: "render quota reached (free daily limit); try again tomorrow" };
    if (!res.ok) return { ok: false, reason: `renderer ${res.status}` };

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();

    if (backend === "cloudflare" && ct.includes("application/json")) {
      try {
        const j = JSON.parse(text);
        if (j && typeof j.result === "string") return { ok: true, html: j.result };
        if (j && j.success === false) {
          const msg = j.errors && j.errors[0] && j.errors[0].message;
          return { ok: false, reason: msg || "render failed" };
        }
      } catch {
        // fall through: treat the body as HTML
      }
    }
    if (!text) return { ok: false, reason: "renderer returned empty body" };
    return { ok: true, html: text };
  } catch (e) {
    if (e.name === "AbortError") return { ok: false, reason: `render timeout after ${timeoutMs}ms` };
    return { ok: false, reason: e.message || "render failed" };
  } finally {
    clearTimeout(timer);
  }
}

function pickBackend(env) {
  if (!env) return "";
  const explicit = String(env.RENDER_BACKEND || "").toLowerCase();
  if (explicit === "generic") return env.RENDER_URL ? "generic" : "";
  if (explicit === "cloudflare" || (env.CF_ACCOUNT_ID && env.BROWSER_RENDER_TOKEN)) {
    return env.CF_ACCOUNT_ID && env.BROWSER_RENDER_TOKEN ? "cloudflare" : "";
  }
  if (env.RENDER_URL) return "generic";
  return "";
}
