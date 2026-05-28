// opml.spec.js — parser + serializer round-trip for js/opml.js
import { test, expect } from '@playwright/test';

const MODULE_URL = '/js/opml.js';

const SAMPLE_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>My subscriptions</title>
    <dateCreated>Wed, 01 May 2026 09:00:00 GMT</dateCreated>
  </head>
  <body>
    <outline text="Standards">
      <outline text="Mark Nottingham" title="Mark Nottingham" type="rss"
               xmlUrl="https://www.mnot.net/blog/index.atom" htmlUrl="https://www.mnot.net/blog/"/>
      <outline text="JSON Feed" title="JSON Feed" type="rss"
               xmlUrl="https://www.jsonfeed.org/feed.json"/>
    </outline>
    <outline text="Tech" type="rss"
             xmlUrl="https://hnrss.org/newest" htmlUrl="https://news.ycombinator.com/"/>
  </body>
</opml>`;

test.describe('opml.js', () => {
  test('parses an OPML document with a folder and a root feed', async ({ page }) => {
    await page.goto('/');
    const parsed = await page.evaluate(async ({ moduleUrl, text }) => {
      const mod = await import(moduleUrl);
      return mod.parseOpml(text);
    }, { moduleUrl: MODULE_URL, text: SAMPLE_OPML });

    expect(parsed.title).toBe('My subscriptions');
    expect(parsed.feeds).toHaveLength(3);

    const titles = parsed.feeds.map(f => f.title);
    expect(titles).toContain('Mark Nottingham');
    expect(titles).toContain('JSON Feed');
    expect(titles).toContain('Tech');

    const mnot = parsed.feeds.find(f => f.title === 'Mark Nottingham');
    expect(mnot.url).toBe('https://www.mnot.net/blog/index.atom');
    expect(mnot.htmlUrl).toBe('https://www.mnot.net/blog/');
    expect(mnot.shelf).toBe('Standards');

    const root = parsed.feeds.find(f => f.title === 'Tech');
    expect(root.shelf).toBe('all');  // root-level feed → "all"
  });

  test('rejects malformed XML', async ({ page }) => {
    await page.goto('/');
    const err = await page.evaluate(async ({ moduleUrl }) => {
      const mod = await import(moduleUrl);
      try { mod.parseOpml('<opml><body><outline'); return null; }
      catch (e) { return e.message; }
    }, { moduleUrl: MODULE_URL });
    expect(err).toMatch(/malformed XML|not an OPML/);

    const err2 = await page.evaluate(async ({ moduleUrl }) => {
      const mod = await import(moduleUrl);
      try { mod.parseOpml('<html><body>no opml</body></html>'); return null; }
      catch (e) { return e.message; }
    }, { moduleUrl: MODULE_URL });
    expect(err2).toContain('not an OPML');
  });

  test('serialize → parse round-trip preserves urls and shelves', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ moduleUrl }) => {
      const mod = await import(moduleUrl);
      const subs = {
        title: "Round-trip test",
        feeds: [
          { id: "a", url: "https://a.example/feed", title: "Site A",       shelf: "Tech" },
          { id: "b", url: "https://b.example/feed", title: "Site B Quote\"s & <stuff>", shelf: "Tech" },
          { id: "c", url: "https://c.example/feed", title: "Site C",       shelf: "all" },
        ],
      };
      const opml = mod.serializeOpml(subs);
      const reparsed = mod.parseOpml(opml);
      return {
        opmlIncludesXmlDecl: opml.startsWith('<?xml'),
        titles: reparsed.feeds.map(f => f.title).sort(),
        urls:   reparsed.feeds.map(f => f.url).sort(),
        shelves: reparsed.feeds.reduce((m, f) => { m[f.title] = f.shelf; return m; }, {}),
      };
    }, { moduleUrl: MODULE_URL });

    expect(result.opmlIncludesXmlDecl).toBe(true);
    expect(result.urls).toEqual([
      'https://a.example/feed',
      'https://b.example/feed',
      'https://c.example/feed',
    ]);
    // Special chars survived the XML escape round-trip
    expect(result.titles).toContain('Site B Quote"s & <stuff>');
    // shelf="all" feeds emit at root → parsed back as shelf "all"
    expect(result.shelves['Site C']).toBe('all');
    // Folder feeds preserve their shelf name
    expect(result.shelves['Site A']).toBe('Tech');
  });

  test('subscriptionsFromOpml maps to the Worker FEEDS shape', async ({ page }) => {
    await page.goto('/');
    const subs = await page.evaluate(async ({ moduleUrl, text }) => {
      const mod = await import(moduleUrl);
      const parsed = mod.parseOpml(text);
      return mod.subscriptionsFromOpml(parsed);
    }, { moduleUrl: MODULE_URL, text: SAMPLE_OPML });

    expect(subs.version).toBe(1);
    expect(subs.feeds).toHaveLength(3);
    for (const f of subs.feeds) {
      expect(typeof f.id).toBe('string');
      expect(typeof f.url).toBe('string');
      expect(typeof f.shelf).toBe('string');
    }
  });
});
