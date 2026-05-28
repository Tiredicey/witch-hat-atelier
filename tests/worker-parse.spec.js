// worker-parse.spec.js
//
// Unit tests for worker/src/parse.js — exercised in the browser via
// dynamic import. The parser is a pure ES module, so it loads fine over
// the static dev server without a build step.

import { test, expect } from '@playwright/test';

const MODULE_URL = '/worker/src/parse.js';

const ATOM_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Feed</title>
  <link href="http://example.org/"/>
  <updated>2026-05-01T18:30:02Z</updated>
  <id>urn:uuid:60a76c80-d399-11d9-b93C-0003939e0af6</id>
  <entry>
    <title>Atom-Powered Robots Run Amok</title>
    <link href="http://example.org/2026/05/01/atom"/>
    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
    <published>2026-05-01T18:30:02Z</published>
    <summary>Some text.</summary>
    <content type="html">&lt;p&gt;Body paragraph one.&lt;/p&gt;&lt;p&gt;Body paragraph two.&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>Second entry</title>
    <link href="http://example.org/2026/04/29/second"/>
    <id>urn:uuid:second</id>
    <published>2026-04-29T10:00:00Z</published>
    <summary>Second summary.</summary>
  </entry>
</feed>`;

const RSS2_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>RSS 2.0 example</title>
    <link>http://example.com/</link>
    <description>Channel desc</description>
    <item>
      <title><![CDATA[First post]]></title>
      <link>http://example.com/first</link>
      <guid>tag:example.com,2026:first</guid>
      <pubDate>Wed, 01 May 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[<p>Body text with <em>markup</em>.</p>]]></description>
    </item>
  </channel>
</rss>`;

const JSON_FEED_SAMPLE = JSON.stringify({
  version: "https://jsonfeed.org/version/1.1",
  title: "JSON Feed example",
  home_page_url: "https://example.org/",
  feed_url: "https://example.org/feed.json",
  items: [
    {
      id: "https://example.org/2026/05/01/post",
      url: "https://example.org/2026/05/01/post",
      title: "Hello JSON Feed",
      content_html: "<p>Welcome to JSON Feed.</p>",
      date_published: "2026-05-01T09:00:00Z",
      summary: "Welcome to JSON Feed.",
    },
  ],
});

test.describe('worker parse.js', () => {
  test('parses Atom 1.0 with two entries', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ moduleUrl, text }) => {
      const mod = await import(moduleUrl);
      return mod.parseFeed(text, 'application/atom+xml');
    }, { moduleUrl: MODULE_URL, text: ATOM_SAMPLE });

    expect(result.format).toBe('atom');
    expect(result.feedTitle).toBe('Example Feed');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].title).toBe('Atom-Powered Robots Run Amok');
    expect(result.entries[0].link).toBe('http://example.org/2026/05/01/atom');
    expect(result.entries[0].id).toBe('urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a');
    expect(result.entries[0].published).toBeGreaterThan(0);
    expect(result.entries[0].body.length).toBeGreaterThan(0);
    expect(result.entries[0].body[0]).toContain('Body paragraph one');
  });

  test('parses RSS 2.0 with CDATA + HTML content', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ moduleUrl, text }) => {
      const mod = await import(moduleUrl);
      return mod.parseFeed(text, 'application/rss+xml');
    }, { moduleUrl: MODULE_URL, text: RSS2_SAMPLE });

    expect(result.format).toBe('rss2');
    expect(result.feedTitle).toBe('RSS 2.0 example');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].title).toBe('First post');
    expect(result.entries[0].id).toBe('tag:example.com,2026:first');
    expect(result.entries[0].body[0]).toContain('Body text with markup');
  });

  test('parses JSON Feed 1.1', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ moduleUrl, text }) => {
      const mod = await import(moduleUrl);
      return mod.parseFeed(text, 'application/json');
    }, { moduleUrl: MODULE_URL, text: JSON_FEED_SAMPLE });

    expect(result.format).toBe('jsonfeed');
    expect(result.feedTitle).toBe('JSON Feed example');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].title).toBe('Hello JSON Feed');
    expect(result.entries[0].link).toBe('https://example.org/2026/05/01/post');
  });

  test('rejects empty or unknown input', async ({ page }) => {
    await page.goto('/');
    const error = await page.evaluate(async ({ moduleUrl }) => {
      const mod = await import(moduleUrl);
      try { mod.parseFeed(''); return null; } catch (e) { return e.message; }
    }, { moduleUrl: MODULE_URL });
    expect(error).toContain('empty');

    const error2 = await page.evaluate(async ({ moduleUrl }) => {
      const mod = await import(moduleUrl);
      try { mod.parseFeed('<html><body>not a feed</body></html>'); return null; }
      catch (e) { return e.message; }
    }, { moduleUrl: MODULE_URL });
    expect(error2).toContain('unrecognised root');
  });

  test('quality scorer passes a healthy feed and rejects an empty one', async ({ page }) => {
    await page.goto('/');
    const passing = await page.evaluate(async ({ text }) => {
      const { parseFeed } = await import('/worker/src/parse.js');
      const { scoreFeed, passesQuality } = await import('/worker/src/quality.js');
      const parsed = parseFeed(text, 'application/atom+xml');
      const scored = scoreFeed(parsed);
      return { score: scored.score, passes: passesQuality(scored) };
    }, { text: ATOM_SAMPLE });
    expect(passing.passes).toBe(true);
    expect(passing.score).toBeGreaterThan(0.5);

    const empty = await page.evaluate(async () => {
      const { scoreFeed, passesQuality } = await import('/worker/src/quality.js');
      const scored = scoreFeed({ feedTitle: 'X', entries: [] });
      return { score: scored.score, passes: passesQuality(scored), reason: scored.reason };
    });
    expect(empty.passes).toBe(false);
    expect(empty.reason).toBe('no entries');
  });
});
