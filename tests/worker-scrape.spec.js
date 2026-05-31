// worker-scrape.spec.js
//
// Unit tests for worker/src/scrape.js, run in the browser via dynamic
// import against the static dev server. Matches the discover/parse test
// pattern: pure logic only, no outbound fetches. Covers the synthetic-feed
// anchor-pattern path, per-item image and excerpt enrichment, the
// merge-by-link step that joins a thumbnail anchor to its title anchor,
// and the buildAtom media/summary serialisation the reader consumes.

import { test, expect } from '@playwright/test';

const MODULE_URL = '/worker/src/scrape.js';
const BASE = 'https://example.com/section';

const LISTING = `<!doctype html><html><body><main>
  <article>
    <a href="/section/12345/the-first-real-headline-here/story"><img src="https://cdn.example.com/a.jpg" alt=""></a>
    <div class="card-title"><a href="/section/12345/the-first-real-headline-here/story">The first real headline here</a></div>
    <p class="card-lead">A short standfirst describing the first article in enough detail.</p>
  </article>
  <article>
    <a href="/section/67890/the-second-real-headline-today/story" style="background-image:url('https://cdn.example.com/b.jpg')"></a>
    <div class="card-title"><a href="/section/67890/the-second-real-headline-today/story">The second real headline today</a></div>
    <div class="card-summary">Another lead paragraph that previews the second story for readers.</div>
  </article>
  <article>
    <a href="/section/24680/a-third-distinct-news-headline/story"><img src="https://cdn.example.com/c.jpg"></a>
    <div class="card-title"><a href="/section/24680/a-third-distinct-news-headline/story">A third distinct news headline</a></div>
  </article>
  <nav>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
    <a href="/section/">Home</a>
  </nav>
</main></body></html>`;

const NAV_ONLY = `<!doctype html><html><body><nav>
  <a href="/about">About</a><a href="/contact">Contact</a><a href="/login">Sign in</a>
</nav></body></html>`;

test.describe('worker scrape.js — anchor-pattern extraction', () => {
  test('extracts repeating article cards and ignores chrome', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async ([mu, html, base]) => {
      const { scrapeFeedItems } = await import(mu);
      return scrapeFeedItems(html, base);
    }, [MODULE_URL, LISTING, BASE]);
    expect(r.method).toBe('anchor-pattern');
    expect(r.items).toHaveLength(3);
    expect(r.items.map((it) => it.title)).toEqual([
      'The first real headline here',
      'The second real headline today',
      'A third distinct news headline',
    ]);
  });

  test('merges a thumbnail anchor and a title anchor on the same link', async ({ page }) => {
    await page.goto('/');
    const items = await page.evaluate(async ([mu, html, base]) => {
      const { scrapeFeedItems } = await import(mu);
      return scrapeFeedItems(html, base).items;
    }, [MODULE_URL, LISTING, BASE]);
    expect(items[0]).toMatchObject({
      title: 'The first real headline here',
      image: 'https://cdn.example.com/a.jpg',
      excerpt: 'A short standfirst describing the first article in enough detail.',
    });
  });

  test('reads a background-image url from an anchor style attribute', async ({ page }) => {
    await page.goto('/');
    const items = await page.evaluate(async ([mu, html, base]) => {
      const { scrapeFeedItems } = await import(mu);
      return scrapeFeedItems(html, base).items;
    }, [MODULE_URL, LISTING, BASE]);
    expect(items[1].image).toBe('https://cdn.example.com/b.jpg');
    expect(items[1].excerpt).toBe('Another lead paragraph that previews the second story for readers.');
  });

  test('leaves image and excerpt empty when the card exposes neither', async ({ page }) => {
    await page.goto('/');
    const items = await page.evaluate(async ([mu, html, base]) => {
      const { scrapeFeedItems } = await import(mu);
      return scrapeFeedItems(html, base).items;
    }, [MODULE_URL, LISTING, BASE]);
    expect(items[2].image).toBe('https://cdn.example.com/c.jpg');
    expect(items[2].excerpt).toBe('');
  });

  test('produces no synthetic feed from a nav-only page', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async ([mu, html, base]) => {
      const { scrapeFeedItems } = await import(mu);
      return scrapeFeedItems(html, base);
    }, [MODULE_URL, NAV_ONLY, BASE]);
    expect(r.items).toHaveLength(0);
    expect(r.confidence).toBe('none');
  });
});

test.describe('worker scrape.js — buildAtom serialisation', () => {
  test('emits the media namespace, thumbnails, and summaries', async ({ page }) => {
    await page.goto('/');
    const atom = await page.evaluate(async ([mu, html, base]) => {
      const { scrapeFeedItems, buildAtom } = await import(mu);
      const { items } = scrapeFeedItems(html, base);
      return buildAtom(items, { pageUrl: base, selfUrl: base + '#self', title: 'example.com' });
    }, [MODULE_URL, LISTING, BASE]);
    expect(atom).toContain('xmlns:media="http://search.yahoo.com/mrss/"');
    expect(atom).toContain('<media:thumbnail url="https://cdn.example.com/a.jpg"/>');
    expect(atom).toContain('<summary>A short standfirst describing the first article in enough detail.</summary>');
  });

  test('omits media and summary lines for bare items', async ({ page }) => {
    await page.goto('/');
    const atom = await page.evaluate(async (mu) => {
      const { buildAtom } = await import(mu);
      return buildAtom(
        [{ title: 'Bare title only', link: 'https://example.com/x/99999/bare-entry-here/story', published: 0 }],
        { pageUrl: 'https://example.com/x', selfUrl: 'https://example.com/x#self', title: 'example.com' },
      );
    }, MODULE_URL);
    expect(atom).toContain('<title>Bare title only</title>');
    expect(atom).not.toContain('<media:thumbnail');
    expect(atom).not.toContain('<summary>');
  });
});
