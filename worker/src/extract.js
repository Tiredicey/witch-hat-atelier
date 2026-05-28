// extract.js
//
// Two paywall-bypass transforms for HTML fetched server-side by the worker.
// Both run on the upstream response before it is returned to the browser.
//
//   1. stripScripts(html)
//      JS-disabled rendering. Many paywalls are injected by client-side JS
//      (Medium overlay, NYT modal, Quora login wall, Substack subscribe
//      gate). Removing every <script> block, every inline on*= handler,
//      every javascript: URL, and unwrapping <noscript> fallback content
//      reveals the article body that was always in the DOM but hidden by
//      the gate.
//
//   2. promotePrintCss(html)
//      @media print CSS injection. Most publishers leave their print
//      stylesheet permissive so readers can actually print — the paywall
//      overlay's display:none/position:fixed rules only target screen
//      media. Rewriting every `@media print { ... }` to `@media all`,
//      every `<style media="print">` to `media="all"`, and every
//      <link rel="stylesheet" media="print"> to `media="all"` lifts the
//      print-only reveal onto screen rendering.
//
// extractArticle(html, originUrl) runs both in order and adds a <base href>
// so relative URLs in the cleaned page still resolve.

const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const SCRIPT_SELF  = /<script\b[^>]*\/>/gi;
const ON_ATTR      = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL_HREF  = /\b(href|src|action|formaction)\s*=\s*(["'])\s*javascript:[^"']*\2/gi;
const NOSCRIPT     = /<\/?noscript\b[^>]*>/gi;

export function stripScripts(html) {
  if (typeof html !== "string") return "";
  let out = html;
  out = out.replace(SCRIPT_BLOCK, "");
  out = out.replace(SCRIPT_SELF,  "");
  out = out.replace(ON_ATTR,      "");
  out = out.replace(JS_URL_HREF,  (_, attr, q) => `${attr}=${q}#${q}`);
  out = out.replace(NOSCRIPT,     "");
  return out;
}

const STYLE_BLOCK      = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi;
const LINK_PRINT       = /<link\b([^>]*?)\bmedia\s*=\s*(["'])([^"']*)\2([^>]*)>/gi;
const STYLE_MEDIA_ATTR = /\bmedia\s*=\s*(["'])([^"']*)\1/i;

function mediaIncludesPrint(value) {
  if (!value) return false;
  const v = value.toLowerCase();
  return v === "print" || v.split(/[\s,]+/).some(t => t.trim() === "print");
}

function promoteAtMediaPrint(cssText) {
  let out = "";
  let i = 0;
  while (i < cssText.length) {
    const idx = cssText.toLowerCase().indexOf("@media", i);
    if (idx === -1) { out += cssText.slice(i); break; }
    out += cssText.slice(i, idx);
    let j = idx + 6;
    while (j < cssText.length && cssText[j] !== "{") j++;
    if (j >= cssText.length) { out += cssText.slice(idx); break; }
    const condition = cssText.slice(idx + 6, j).trim();
    let depth = 1;
    let k = j + 1;
    while (k < cssText.length && depth > 0) {
      const c = cssText[k];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      k++;
    }
    const body = cssText.slice(j + 1, k - 1);
    if (mediaIncludesPrint(condition)) {
      out += `@media all {${body}}`;
    } else {
      out += `@media ${condition} {${body}}`;
    }
    i = k;
  }
  return out;
}

export function promotePrintCss(html) {
  if (typeof html !== "string") return "";
  let out = html.replace(STYLE_BLOCK, (_, attrs, css) => {
    const promoted = promoteAtMediaPrint(css);
    const mediaMatch = (attrs || "").match(STYLE_MEDIA_ATTR);
    let newAttrs = attrs || "";
    if (mediaMatch && mediaIncludesPrint(mediaMatch[2])) {
      newAttrs = newAttrs.replace(STYLE_MEDIA_ATTR, `media=${mediaMatch[1]}all${mediaMatch[1]}`);
    }
    return `<style${newAttrs}>${promoted}</style>`;
  });
  out = out.replace(LINK_PRINT, (full, pre, q, mediaValue, post) => {
    if (!mediaIncludesPrint(mediaValue)) return full;
    return `<link${pre} media=${q}all${q}${post}>`;
  });
  return out;
}

function ensureBase(html, originUrl) {
  if (!originUrl) return html;
  if (/<base\b/i.test(html)) return html;
  const tag = `<base href="${escapeHtml(originUrl)}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, m => `${m}${tag}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, m => `${m}<head>${tag}</head>`);
  }
  return `<head>${tag}</head>${html}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}

export function extractArticle(html, originUrl) {
  let out = stripScripts(html);
  out = promotePrintCss(out);
  out = ensureBase(out, originUrl);
  return out;
}
