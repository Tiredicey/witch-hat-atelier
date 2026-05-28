// worker-extract.spec.js
//
// Unit tests for worker/src/extract.js — exercised in the browser via
// dynamic import, same pattern as worker-parse.spec.js.

import { test, expect } from '@playwright/test';

const MODULE_URL = '/worker/src/extract.js';

test.describe('worker extract.js — JS-disabled rendering', () => {
  test('stripScripts removes <script>...</script> blocks of every shape', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (modUrl) => {
      const m = await import(modUrl);
      const input = `
        <html><body>
          <p>keep me</p>
          <script>window.paywall.show()</script>
          <script type="module">import x from '/p.js'; x();</script>
          <script defer src="/p.js"></script>
          <script async src="/track.js"   ></script>
          <p>also keep</p>
        </body></html>`;
      return m.stripScripts(input);
    }, MODULE_URL);
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('<p>keep me</p>');
    expect(out).toContain('<p>also keep</p>');
  });

  test('stripScripts removes inline on*= event handlers but keeps the element', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (modUrl) => {
      const m = await import(modUrl);
      return m.stripScripts(`<a href="/x" onclick="paywall()" data-id="3">link</a><div onmouseover='leak()'>x</div>`);
    }, MODULE_URL);
    expect(out).toContain('<a href="/x" data-id="3">link</a>');
    expect(out).toContain('<div>x</div>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/onmouseover/i);
  });

  test('stripScripts neutralises javascript: URLs in href/src/action', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (modUrl) => {
      const m = await import(modUrl);
      return m.stripScripts(`<a href="javascript:alert(1)">x</a><img src='javascript:void(0)'><form action="javascript:bad()"></form>`);
    }, MODULE_URL);
    expect(out).not.toContain('javascript:');
    expect(out).toContain('href="#"');
    expect(out).toContain("src='#'");
    expect(out).toContain('action="#"');
  });

  test('stripScripts unwraps <noscript> blocks so their fallback content renders', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (modUrl) => {
      const m = await import(modUrl);
      return m.stripScripts(`<noscript><p>the real article body</p></noscript>`);
    }, MODULE_URL);
    expect(out).toBe('<p>the real article body</p>');
  });
});

test.describe('worker extract.js — @media print CSS promotion', () => {
  test('promotePrintCss rewrites @media print inside <style> to @media all', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (modUrl) => {
      const m = await import(modUrl);
      return m.promotePrintCss(`<style>.paywall{display:none}@media print { .paywall { display: block !important } .article { color: black } }</style>`);
    }, MODULE_URL);
    expect(out).toContain('@media all');
    expect(out).not.toMatch(/@media\s+print/i);
    expect(out).toContain('.paywall { display: block !important }');
  });

  test('promotePrintCss handles nested @media correctly via balanced braces', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (modUrl) => {
      const m = await import(modUrl);
      return m.promotePrintCss(`<style>@media print { @supports (display: grid) { .a { display: grid } } } @media screen { .b{} }</style>`);
    }, MODULE_URL);
    expect(out).toContain('@media all');
    expect(out).toContain('@supports (display: grid)');
    expect(out).toContain('@media screen { .b{} }');
  });

  test('promotePrintCss rewrites <link rel="stylesheet" media="print"> to media="all"', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (modUrl) => {
      const m = await import(modUrl);
      return m.promotePrintCss(`<link rel="stylesheet" media="print" href="/p.css"><link rel="stylesheet" media="screen" href="/s.css">`);
    }, MODULE_URL);
    expect(out).toContain('media="all" href="/p.css"');
    expect(out).toContain('media="screen" href="/s.css"');
  });

  test('promotePrintCss rewrites <style media="print"> attribute to all', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (modUrl) => {
      const m = await import(modUrl);
      return m.promotePrintCss(`<style media="print">.x{display:block}</style>`);
    }, MODULE_URL);
    expect(out).toMatch(/<style media="all">/);
  });

  test('promotePrintCss is a no-op on stylesheets with no print rules', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (modUrl) => {
      const m = await import(modUrl);
      return m.promotePrintCss(`<style>.a{color:red}@media (min-width: 600px){.b{color:blue}}</style>`);
    }, MODULE_URL);
    expect(out).toContain('.a{color:red}');
    expect(out).toContain('@media (min-width: 600px)');
  });
});

test.describe('worker extract.js — extractArticle orchestrator', () => {
  test('runs both transforms and injects <base href> when missing', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (modUrl) => {
      const m = await import(modUrl);
      const input = `<!doctype html><html><head><title>x</title></head><body>
        <style>.gate{display:block}@media print{.gate{display:none}.article{display:block}}</style>
        <div class="gate"><script>blockReader()</script>SUBSCRIBE</div>
        <article onclick="track()">real content</article>
      </body></html>`;
      return m.extractArticle(input, 'https://example.com/articles/123');
    }, MODULE_URL);
    expect(out).toContain('<base href="https://example.com/articles/123">');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('@media all');
    expect(out).toContain('real content');
  });

  test('preserves existing <base href> instead of adding a duplicate', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (modUrl) => {
      const m = await import(modUrl);
      return m.extractArticle(`<html><head><base href="https://orig.example/"></head><body>x</body></html>`, 'https://new.example/p');
    }, MODULE_URL);
    const bases = (out.match(/<base\b/gi) || []).length;
    expect(bases).toBe(1);
    expect(out).toContain('https://orig.example/');
  });
});
