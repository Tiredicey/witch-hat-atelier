// inoreader-import.spec.js
//
// Parser + Settings-page UI tests for js/inoreader-import.js.
import { test, expect } from '@playwright/test';

const MODULE_URL = '/js/inoreader-import.js';

const SAMPLE_EXPORT = {
  id: "user/1/state/com.google/starred",
  updated: 1714521600,
  items: [
    {
      id: "tag:google.com,2005:reader/item/0000000000aaaa01",
      categories: ["user/1/state/com.google/reading-list", "user/1/state/com.google/starred"],
      title: "Mark Nottingham — Web Feeds in 2026",
      published: 1714500000,
      timestampUsec: "1714520000000000",
      canonical: [{ href: "https://www.mnot.net/blog/2026/feed-survey" }],
      alternate: [{ href: "https://www.mnot.net/blog/2026/feed-survey", type: "text/html" }],
    },
    {
      id: "tag:example.com,2024:post-2",
      categories: ["user/1/state/com.google/starred"],
      title: "JSON Feed 1.1",
      crawlTimeMsec: "1714521000000",
      alternate: [{ href: "https://www.jsonfeed.org/version/1.1/" }],
    },
    {
      // No URL — should be skipped.
      id: "tag:bad,2024:no-url",
      categories: ["user/1/state/com.google/starred"],
      title: "Skip me",
    },
    {
      // Duplicate URL — should be deduped.
      id: "tag:dup,2024:1",
      categories: ["user/1/state/com.google/starred"],
      title: "Dup",
      canonical: [{ href: "https://www.mnot.net/blog/2026/feed-survey" }],
    },
    {
      // Not in starred state — should be skipped.
      id: "tag:notstar,2024:1",
      categories: ["user/1/state/com.google/read"],
      title: "Not starred",
      canonical: [{ href: "https://example.com/read-only" }],
    },
  ],
};

test.describe('inoreader-import parser', () => {
  test('extracts URL, title, timestamp from a canonical Inoreader export', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ moduleUrl, payload }) => {
      const mod = await import(moduleUrl);
      return mod.parseInoreaderStars(JSON.stringify(payload));
    }, { moduleUrl: MODULE_URL, payload: SAMPLE_EXPORT });

    expect(result.stars).toHaveLength(2);
    expect(result.skipped).toBe(3); // no-url, dup, wrong-state

    const mnot = result.stars[0];
    expect(mnot.itemId).toBe('https://www.mnot.net/blog/2026/feed-survey');
    expect(mnot.title).toContain('Web Feeds in 2026');
    expect(mnot.at).toBe(1714520000000); // timestampUsec → ms

    const jf = result.stars[1];
    expect(jf.itemId).toBe('https://www.jsonfeed.org/version/1.1/');
    expect(jf.at).toBe(1714521000000); // crawlTimeMsec → ms
  });

  test('accepts a bare array of items', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ moduleUrl, items }) => {
      const mod = await import(moduleUrl);
      return mod.parseInoreaderStars(JSON.stringify(items));
    }, { moduleUrl: MODULE_URL, items: SAMPLE_EXPORT.items.slice(0, 2) });

    expect(result.stars).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });

  test('falls back to published seconds when no usec/msec is present', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ moduleUrl }) => {
      const mod = await import(moduleUrl);
      return mod.parseInoreaderStars(JSON.stringify({
        items: [{
          title: 'Sec-only',
          published: 1700000000,
          alternate: [{ href: 'https://example.com/a' }],
        }],
      }));
    }, { moduleUrl: MODULE_URL });
    expect(result.stars[0].at).toBe(1700000000 * 1000);
  });

  test('rejects empty input, non-JSON, and shape mismatches', async ({ page }) => {
    await page.goto('/');
    const errs = await page.evaluate(async ({ moduleUrl }) => {
      const mod = await import(moduleUrl);
      const out = [];
      try { mod.parseInoreaderStars(''); } catch (e) { out.push(e.message); }
      try { mod.parseInoreaderStars('not-json'); } catch (e) { out.push(e.message); }
      try { mod.parseInoreaderStars('{}'); } catch (e) { out.push(e.message); }
      return out;
    }, { moduleUrl: MODULE_URL });
    expect(errs[0]).toMatch(/empty input/);
    expect(errs[1]).toMatch(/not JSON/);
    expect(errs[2]).toMatch(/no items/);
  });
});

test.describe('inoreader-import UI (Settings page)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    const btn = page.locator('#enterSettingsBtn');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await expect(page.locator('#settingsPage')).toBeVisible();
  });

  test('writes item.star events to the local adapter log and is idempotent', async ({ page }) => {
    const fileBuf = Buffer.from(JSON.stringify(SAMPLE_EXPORT), 'utf-8');
    const input = page.locator('#inoreader-stars-file');
    const status = page.locator('#inoreader-stars-status');

    await input.setInputFiles({
      name: 'starred.json',
      mimeType: 'application/json',
      buffer: fileBuf,
    });
    await expect(status).toHaveAttribute('data-status', 'ok', { timeout: 5000 });
    await expect(status).toContainText(/Imported 2 star/);

    const log = await page.evaluate(() => localStorage.getItem('coda/v1/log.ndjson'));
    expect(log).not.toBeNull();
    const events = log.trim().split('\n').map(l => JSON.parse(l));
    const stars = events.filter(e => e.t === 'item.star' && e.on === true);
    expect(stars).toHaveLength(2);
    expect(stars.map(e => e.itemId).sort()).toEqual([
      'https://www.jsonfeed.org/version/1.1/',
      'https://www.mnot.net/blog/2026/feed-survey',
    ]);

    // Re-import — must be a no-op.
    await input.setInputFiles({
      name: 'starred.json',
      mimeType: 'application/json',
      buffer: fileBuf,
    });
    await expect(status).toContainText(/already starred/);

    const log2 = await page.evaluate(() => localStorage.getItem('coda/v1/log.ndjson'));
    const stars2 = log2.trim().split('\n').map(l => JSON.parse(l))
      .filter(e => e.t === 'item.star' && e.on === true);
    expect(stars2).toHaveLength(2);
  });

  test('surfaces a fail status when the file is malformed JSON', async ({ page }) => {
    const status = page.locator('#inoreader-stars-status');
    await page.locator('#inoreader-stars-file').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"items": [', 'utf-8'),
    });
    await expect(status).toHaveAttribute('data-status', 'fail', { timeout: 5000 });
    await expect(status).toContainText(/Import failed/);
  });

  test('reports zero items when the export has no starred entries', async ({ page }) => {
    const status = page.locator('#inoreader-stars-status');
    await page.locator('#inoreader-stars-file').setInputFiles({
      name: 'empty.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ items: [] }), 'utf-8'),
    });
    await expect(status).toHaveAttribute('data-status', 'fail', { timeout: 5000 });
    await expect(status).toContainText(/No starred items/);
  });
});
