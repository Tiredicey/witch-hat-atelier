// worker-discover.spec.js
//
// Unit tests for worker/src/discover.js, run in the browser via dynamic
// import against the static dev server. Matches the proxy + parse test
// pattern: every assertion exercises pure logic only (no outbound
// fetches). The /discover route's network glue lives in index.js and is
// covered in production by the README example.

import { test, expect } from '@playwright/test';

const MODULE_URL = '/worker/src/discover.js';

test.describe('worker discover.js — extractFeedLinks', () => {
  test('extracts rss, atom, and json alternates from <head>', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (mu) => {
      const { extractFeedLinks } = await import(mu);
      const html = `<!doctype html><html><head>
        <title>Example</title>
        <link rel="alternate" type="application/rss+xml" title="Main feed" href="/feed.xml">
        <link rel="alternate" type="application/atom+xml" href="https://example.com/atom">
        <link rel="alternate" type="application/json" href="/feed.json">
        <link rel="stylesheet" href="/x.css">
      </head><body>
        <link rel="alternate" type="application/rss+xml" href="/should-not-be-seen">
      </body></html>`;
      return extractFeedLinks(html, 'https://example.com/page/');
    }, MODULE_URL);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      url: 'https://example.com/feed.xml', type: 'rss', title: 'Main feed',
    });
    expect(result[1]).toMatchObject({
      url: 'https://example.com/atom', type: 'atom',
    });
    expect(result[2]).toMatchObject({
      url: 'https://example.com/feed.json', type: 'json',
    });
  });

  test('dedupes identical hrefs and ignores non-alternate rel', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (mu) => {
      const { extractFeedLinks } = await import(mu);
      const html = `<head>
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        <link rel="canonical" type="application/rss+xml" href="/should-skip">
        <link rel="me" href="https://example.com/about">
      </head>`;
      return extractFeedLinks(html, 'https://example.com/');
    }, MODULE_URL);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/feed.xml');
  });

  test('rejects application/json links that do not look like a feed', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (mu) => {
      const { extractFeedLinks } = await import(mu);
      const html = `<head>
        <link rel="alternate" type="application/json" href="/api/data">
        <link rel="alternate" type="application/json" href="/feed.json">
      </head>`;
      return extractFeedLinks(html, 'https://example.com/');
    }, MODULE_URL);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/feed.json');
  });

  test('returns [] on empty / non-string input and malformed href', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (mu) => {
      const { extractFeedLinks } = await import(mu);
      return [
        extractFeedLinks('', 'https://example.com/'),
        extractFeedLinks(null, 'https://example.com/'),
        extractFeedLinks('<head><link rel="alternate" type="application/rss+xml" href=":::"></head>', 'not-a-base'),
      ];
    }, MODULE_URL);
    expect(result[0]).toEqual([]);
    expect(result[1]).toEqual([]);
    expect(result[2]).toEqual([]);
  });
});

test.describe('worker discover.js — commonFeedPaths', () => {
  test('produces root and directory candidates for a deep page url', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (mu) => {
      const { commonFeedPaths } = await import(mu);
      return commonFeedPaths('https://example.com/blog/2026/post/');
    }, MODULE_URL);
    expect(result).toContain('https://example.com/feed');
    expect(result).toContain('https://example.com/feed.xml');
    expect(result).toContain('https://example.com/atom.xml');
    expect(result).toContain('https://example.com/blog/2026/post/feed');
    expect(result).toContain('https://example.com/blog/2026/post/feed.xml');
    expect(result.length).toBeGreaterThanOrEqual(8);
  });

  test('returns only root probes when the page is at /', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (mu) => {
      const { commonFeedPaths } = await import(mu);
      return commonFeedPaths('https://example.com/');
    }, MODULE_URL);
    expect(result).toContain('https://example.com/feed');
    expect(result).toContain('https://example.com/feed/');
    expect(result).toContain('https://example.com/feed.xml');
    expect(result.every(u => new URL(u).host === 'example.com')).toBe(true);
  });

  test('returns [] for invalid url', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (mu) => {
      const { commonFeedPaths } = await import(mu);
      return commonFeedPaths('not-a-url');
    }, MODULE_URL);
    expect(result).toEqual([]);
  });
});

test.describe('worker discover.js — looksLikeFeed', () => {
  test('trusts authoritative content-types', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (mu) => {
      const { looksLikeFeed } = await import(mu);
      return [
        looksLikeFeed(null, 'application/rss+xml; charset=utf-8'),
        looksLikeFeed(null, 'application/atom+xml'),
        looksLikeFeed(null, 'application/feed+json'),
        looksLikeFeed(null, 'text/html'),
        looksLikeFeed(null, ''),
      ];
    }, MODULE_URL);
    expect(r).toEqual([true, true, true, false, false]);
  });

  test('sniffs bytes when content-type is generic', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (mu) => {
      const { looksLikeFeed } = await import(mu);
      const enc = (s) => new TextEncoder().encode(s).buffer;
      return [
        looksLikeFeed(enc('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>'), 'text/xml'),
        looksLikeFeed(enc('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>'), 'application/xml'),
        looksLikeFeed(enc('<!doctype html><html><body>nope</body></html>'), 'text/html'),
        looksLikeFeed(enc('{"version":"https://jsonfeed.org/version/1.1","items":[]}'), 'application/json'),
        looksLikeFeed(enc('{"foo":"bar"}'), 'application/json'),
      ];
    }, MODULE_URL);
    expect(r).toEqual([true, true, false, true, false]);
  });
});

test.describe('worker discover.js — classifyByBody', () => {
  test('prefers content-type, falls back to body sniff', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (mu) => {
      const { classifyByBody } = await import(mu);
      const enc = (s) => new TextEncoder().encode(s).buffer;
      return [
        classifyByBody(null, 'application/atom+xml'),
        classifyByBody(null, 'application/rss+xml'),
        classifyByBody(null, 'application/feed+json'),
        classifyByBody(enc('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>'), 'application/xml'),
        classifyByBody(enc('<?xml version="1.0"?><rss version="2.0"></rss>'), 'application/xml'),
        classifyByBody(enc('<!doctype html>'), 'text/html'),
      ];
    }, MODULE_URL);
    expect(r).toEqual(['atom', 'rss', 'json', 'atom', 'rss', 'unknown']);
  });
});
