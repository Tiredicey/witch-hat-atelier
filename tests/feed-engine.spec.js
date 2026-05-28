// feed-engine.spec.js
//
// Tests for js/feed-engine.js \u2014 the browser-side feed pull that turns an
// imported OPML into visible entries on every adapter (not just S3 + R2).
//
// Two layers:
//   1. Module-level: import loadFeedFromBrowserEngine, pass a fake adapter
//      and route-intercepted /fetch responses, assert the merged-entries
//      shape.
//   2. End-to-end: pre-seed localStorage with a subscriptions.json, mock
//      /fetch, reload, and assert the article list renders entries from the
//      synthetic feeds. This is the regression test for the deployed
//      Pages site: an OPML import on the default LocalAdapter must produce
//      rows in #rows.

import { test, expect } from '@playwright/test';

const MODULE_URL = '/js/feed-engine.js';

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <link href="https://example.test/"/>
  <entry>
    <id>https://example.test/post/atom-1</id>
    <title>First Atom Post</title>
    <link href="https://example.test/post/atom-1"/>
    <updated>2026-05-01T12:00:00Z</updated>
    <published>2026-05-01T12:00:00Z</published>
    <summary>A first post in atom form.</summary>
  </entry>
  <entry>
    <id>https://example.test/post/atom-2</id>
    <title>Second Atom Post</title>
    <link href="https://example.test/post/atom-2"/>
    <updated>2026-05-10T08:30:00Z</updated>
    <published>2026-05-10T08:30:00Z</published>
    <summary>A second post.</summary>
  </entry>
</feed>`;

const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example RSS</title>
    <link>https://rss.example.test/</link>
    <description>Test channel</description>
    <item>
      <guid>https://rss.example.test/post-a</guid>
      <title>RSS Post A</title>
      <link>https://rss.example.test/post-a</link>
      <pubDate>Wed, 15 May 2026 09:00:00 GMT</pubDate>
      <description>RSS summary A.</description>
    </item>
  </channel>
</rss>`;

const SUBS_KEY = 'coda/subs/subscriptions.json';
const ATOM_URL = 'https://example.test/feed.atom';
const RSS_URL  = 'https://rss.example.test/feed.xml';

function subsJson(feeds) {
  return JSON.stringify({ title: 'Test subs', feeds });
}

test.describe('feed-engine.js \u2014 module-level', () => {
  test('returns null when adapter has no subscriptions', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (moduleUrl) => {
      const mod = await import(moduleUrl);
      const adapter = { read: async () => null };
      return mod.loadFeedFromBrowserEngine({ adapter });
    }, MODULE_URL);
    expect(result).toBeNull();
  });

  test('returns null when subscriptions JSON is malformed', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (moduleUrl) => {
      const mod = await import(moduleUrl);
      const adapter = { read: async () => '{not valid json' };
      return mod.loadFeedFromBrowserEngine({ adapter });
    }, MODULE_URL);
    expect(result).toBeNull();
  });

  test('returns null when feeds[] is empty', async ({ page }) => {
    await page.goto('/');
    const subs = subsJson([]);
    const result = await page.evaluate(async ({ moduleUrl, subs }) => {
      const mod = await import(moduleUrl);
      const adapter = { read: async () => subs };
      return mod.loadFeedFromBrowserEngine({ adapter });
    }, { moduleUrl: MODULE_URL, subs });
    expect(result).toBeNull();
  });

  test('fetches each subscription via /fetch and merges entries', async ({ page }) => {
    // Mock /fetch by inspecting the ?url= query and returning the matching
    // synthetic feed. Anything else 404s so misroutes surface as test failures.
    await page.route('**/fetch?url=*', async (route, request) => {
      const u = new URL(request.url());
      const target = u.searchParams.get('url');
      if (target === ATOM_URL) {
        return route.fulfill({
          status: 200,
          contentType: 'application/atom+xml; charset=utf-8',
          body: ATOM_FEED,
        });
      }
      if (target === RSS_URL) {
        return route.fulfill({
          status: 200,
          contentType: 'application/rss+xml; charset=utf-8',
          body: RSS_FEED,
        });
      }
      return route.fulfill({ status: 404, body: 'no fixture' });
    });

    await page.goto('/');
    const subs = subsJson([
      { id: 'atom', url: ATOM_URL, title: 'Example Atom', shelf: 'Standards' },
      { id: 'rss',  url: RSS_URL,  title: 'Example RSS',  shelf: 'all' },
    ]);
    const entries = await page.evaluate(async ({ moduleUrl, subs }) => {
      const mod = await import(moduleUrl);
      const adapter = { read: async () => subs };
      return mod.loadFeedFromBrowserEngine({ adapter });
    }, { moduleUrl: MODULE_URL, subs });

    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(3);

    // Sorted by published desc \u2014 RSS Post A (May 15) is newest.
    expect(entries[0].title).toBe('RSS Post A');
    expect(entries[1].title).toBe('Second Atom Post');
    expect(entries[2].title).toBe('First Atom Post');

    // shelf comes from the subscription, not the feed.
    const rss = entries.find(e => e.title === 'RSS Post A');
    expect(rss.shelf).toBe('all');
    const atom1 = entries.find(e => e.title === 'First Atom Post');
    expect(atom1.shelf).toBe('Standards');

    // Source comes from the feed's own <title>, normalised by parse.js.
    expect(atom1.source).toBe('Example Atom');
  });

  test('a single failing feed does not poison the rest', async ({ page }) => {
    await page.route('**/fetch?url=*', async (route, request) => {
      const u = new URL(request.url());
      const target = u.searchParams.get('url');
      if (target === ATOM_URL) {
        return route.fulfill({
          status: 200,
          contentType: 'application/atom+xml',
          body: ATOM_FEED,
        });
      }
      // Simulate a bad upstream for the RSS one.
      return route.fulfill({ status: 502, body: 'upstream gone' });
    });

    await page.goto('/');
    const subs = subsJson([
      { id: 'atom', url: ATOM_URL, title: 'Example Atom', shelf: 'all' },
      { id: 'rss',  url: RSS_URL,  title: 'Example RSS',  shelf: 'all' },
    ]);
    const entries = await page.evaluate(async ({ moduleUrl, subs }) => {
      const mod = await import(moduleUrl);
      const adapter = { read: async () => subs };
      return mod.loadFeedFromBrowserEngine({ adapter });
    }, { moduleUrl: MODULE_URL, subs });

    // Two Atom entries survived; the RSS upstream-502 returned no entries.
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.source).toBe('Example Atom');
    }
  });
});

test.describe('feed-engine.js \u2014 end-to-end through app.js', () => {
  test('imported OPML renders entries in #rows on the default LocalAdapter', async ({ page }) => {
    await page.route('**/fetch?url=*', async (route, request) => {
      const target = new URL(request.url()).searchParams.get('url');
      if (target === ATOM_URL) {
        return route.fulfill({
          status: 200,
          contentType: 'application/atom+xml',
          body: ATOM_FEED,
        });
      }
      return route.fulfill({ status: 404, body: 'no fixture' });
    });

    // Pre-seed localStorage with the same subscriptions shape that
    // js/subscriptions.js writes after a successful OPML commit.
    await page.addInitScript((payload) => {
      window.localStorage.setItem(payload.key, payload.body);
    }, {
      key: SUBS_KEY,
      body: subsJson([{ id: 'atom', url: ATOM_URL, title: 'Example Atom', shelf: 'all' }]),
    });

    await page.goto('/');
    // Wait for the article-list to render Atom entries (they replace SAMPLE).
    await expect(page.locator('.article-row .article-row__title', { hasText: 'First Atom Post' })).toBeVisible();
    await expect(page.locator('.article-row .article-row__title', { hasText: 'Second Atom Post' })).toBeVisible();
  });
});
