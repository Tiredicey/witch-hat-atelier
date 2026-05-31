// worker-gma.spec.js
//
// Unit tests for worker/src/gma.js, run in the browser via dynamic import
// against the static dev server. Pure logic only, no outbound fetches: the
// data.igma.tv network call lives in index.js#fetchStructuredItems. Covers the
// section-URL to listing-API mapping and the JSON to feed-item normalisation,
// then confirms the items serialise through scrape.js#buildAtom and parse back
// with image and excerpt intact.

import { test, expect } from '@playwright/test';

const GMA_URL = '/worker/src/gma.js';
const SCRAPE_URL = '/worker/src/scrape.js';
const PARSE_URL = '/worker/src/parse.js';

const FIXTURE = JSON.stringify({
  status: '200',
  data: [
    { id: '1', title: 'Real headline one', lead: 'Lead one text.', publish_timestamp: '2026-05-31 14:05:46',
      photo: { url: 'a.jpg' }, url: 'lifestyle/shopping/1/real-headline-one/story', status: '1' },
    { id: '2', title: 'Real headline two', lead: '', publish_timestamp: '2026-05-30 09:00:00',
      photo: { url: 'b.jpg' }, override_url: 'lifestyle/shopping/2/real-headline-two/story', url: 'x', status: '1' },
    { id: '3', title: 'Hidden row', lead: 'x', url: 'lifestyle/shopping/3/hidden/story', status: '0' },
    { id: '4', title: '', lead: 'no title', url: 'lifestyle/shopping/4/none/story', status: '1' },
  ],
});

test.describe('worker gma.js — listing API mapping', () => {
  test('maps lifestyle section URLs to the data.igma.tv listing endpoint', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (mu) => {
      const { gmaListingApi } = await import(mu);
      return {
        shopping: gmaListingApi('https://www.gmanetwork.com/lifestyle/shopping'),
        foodP3: gmaListingApi('https://www.gmanetwork.com/lifestyle/food', 3),
        slash: gmaListingApi('https://www.gmanetwork.com/lifestyle/health-fitness/'),
      };
    }, GMA_URL);
    expect(out.shopping).toBe('https://data.igma.tv/entertainment/lifestyle/listing/shopping/1.gz');
    expect(out.foodP3).toBe('https://data.igma.tv/entertainment/lifestyle/listing/food/3.gz');
    expect(out.slash).toBe('https://data.igma.tv/entertainment/lifestyle/listing/health-fitness/1.gz');
  });

  test('returns empty for non-lifestyle and non-GMA URLs', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (mu) => {
      const { gmaListingApi } = await import(mu);
      return [
        gmaListingApi('https://www.gmanetwork.com/news/'),
        gmaListingApi('https://example.com/lifestyle/shopping'),
        gmaListingApi('not a url'),
      ];
    }, GMA_URL);
    expect(out).toEqual(['', '', '']);
  });
});

test.describe('worker gma.js — JSON normalisation', () => {
  test('keeps active titled rows and fills image, excerpt, date', async ({ page }) => {
    await page.goto('/');
    const items = await page.evaluate(async ([mu, fixture]) => {
      const { gmaListingItems } = await import(mu);
      return gmaListingItems(fixture, { limit: 10 });
    }, [GMA_URL, FIXTURE]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Real headline one',
      link: 'https://www.gmanetwork.com/lifestyle/shopping/1/real-headline-one/story',
      image: 'https://aphrodite.gmanetwork.com/entertainment/articles/900_675_a.jpg',
      excerpt: 'Lead one text.',
    });
    expect(items[0].published).toBeGreaterThan(0);
    expect(items[1].link).toBe('https://www.gmanetwork.com/lifestyle/shopping/2/real-headline-two/story');
  });

  test('returns empty for malformed JSON', async ({ page }) => {
    await page.goto('/');
    const n = await page.evaluate(async (mu) => {
      const { gmaListingItems } = await import(mu);
      return gmaListingItems('not json{').length;
    }, GMA_URL);
    expect(n).toBe(0);
  });

  test('serialises through buildAtom and parses back with media + summary', async ({ page }) => {
    await page.goto('/');
    const entry = await page.evaluate(async ([gmu, smu, pmu, fixture]) => {
      const { gmaListingItems } = await import(gmu);
      const { buildAtom } = await import(smu);
      const { parseFeed } = await import(pmu);
      const items = gmaListingItems(fixture, { limit: 10 });
      const atom = buildAtom(items, { pageUrl: 'https://www.gmanetwork.com/lifestyle/shopping' });
      return parseFeed(atom, 'application/atom+xml').entries[0];
    }, [GMA_URL, SCRAPE_URL, PARSE_URL, FIXTURE]);
    expect(entry.image).toBe('https://aphrodite.gmanetwork.com/entertainment/articles/900_675_a.jpg');
    expect(entry.excerpt).toBe('Lead one text.');
  });
});
