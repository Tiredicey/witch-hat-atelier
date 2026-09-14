import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePhilippines, parseTrends, parse8List } from '../worker/src/philippines.js';
import { PHILIPPINES_SOURCES, SEARCH_TYPES, exploreUrl } from '../js/philippines-sources.js';

const rss = `<rss><channel><item><title>Test &amp; query</title><link>https://trends.google.com/trending/rss?geo=PH</link><pubDate>Mon, 14 Sep 2026 08:50:00 -0700</pubDate><ht:approx_traffic>500+</ht:approx_traffic><ht:news_item><ht:news_item_title>Test coverage</ht:news_item_title><ht:news_item_url>https://example.com/story</ht:news_item_url><ht:news_item_source>Test publisher</ht:news_item_source></ht:news_item></item><item><title>Another query</title></item></channel></rss>`;
const article = `<article><h2 class="entry-title"><a href="https://8list.ph/test-story/">A test article headline</a></h2><time class="updated" datetime="2026-09-14T10:00:00+08:00"></time><time class="entry-date published" datetime="2025-09-03T16:27:59+08:00"></time></article>`;
const request = (query = '') => new Request(`https://coda.test/philippines${query}`);

test('keeps distinct RSS queries, source traffic, dates, and related sources', () => {
  const items = parseTrends(rss);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Test & query');
  assert.notEqual(items[0].id, items[1].id);
  assert.equal(items[0].traffic, '500+');
  assert.equal(items[1].traffic, null);
  assert.equal(items[1].published, null);
  assert.equal(items[0].published, Date.parse('2026-09-14T15:50:00Z'));
  assert.equal(new URL(items[0].url).searchParams.get('q'), 'Test & query');
  assert.equal(items[0].related[0].url, 'https://example.com/story');
});

test('rejects unsafe news links and does not invent empty RSS results', () => {
  assert.equal(parseTrends(rss.replace('https://example.com/story', 'javascript:alert(1)'))[0].related.length, 0);
  assert.deepEqual(parseTrends('<rss><channel/></rss>'), []);
  assert.throws(() => parseTrends('<html>Blocked</html>'));
});

test('extracts listing articles only, deduplicates, preserves original publication date', () => {
  const items = parse8List(`${article}<main><!--${article}-->${article}${article}</main>${article}`, PHILIPPINES_SOURCES[1]);
  assert.equal(items.length, 1);
  assert.equal(items[0].published, Date.parse('2025-09-03T08:27:59Z'));
  assert.equal(items[0].url, 'https://8list.ph/test-story/');
  assert.equal(parse8List(`<main>${article.replace(/<time[^>]*><\/time>/g, '')}</main>`, PHILIPPINES_SOURCES[1])[0].published, null);
  assert.throws(() => parse8List('<html>Unavailable</html>', PHILIPPINES_SOURCES[1]));
});

test('catalog contains every requested section and all search properties use PH', () => {
  assert.deepEqual(PHILIPPINES_SOURCES.map(s => s.id), ['trends', '8list', 'weird', 'health', 'learning', 'movies', 'music', 'style', 'beauty', 'tech']);
  for (const type of SEARCH_TYPES) {
    const url = new URL(exploreUrl({ term: 'a & b', type: type.value, date: 'now 7-d' }));
    assert.equal(url.searchParams.get('geo'), 'PH');
    assert.equal(url.searchParams.get('q'), 'a & b');
    assert.equal(url.searchParams.get('gprop') || '', type.value);
    assert.equal(url.searchParams.get('date'), 'now 7-d');
  }
});

test('fixed-source endpoint rejects arbitrary targets and non-GET requests without fetching', async () => {
  let called = false;
  const options = { fetcher: async () => { called = true; throw new Error('should not fetch'); } };
  for (const q of ['?source=unknown', '?url=https://localhost/', '?source=trends&url=https://evil.test', '?source=trends&source=tech']) assert.equal((await handlePhilippines(request(q), options)).status, 400);
  assert.equal((await handlePhilippines(new Request(request(), { method: 'POST' }), options)).status, 405);
  assert.equal(called, false);
});

test('fetches only catalog URL, blocks redirects, and returns provenance', async () => {
  const result = await handlePhilippines(request(), { fetcher: async (url, options) => {
    assert.equal(url, 'https://trends.google.com/trending/rss?geo=PH');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Cookie, undefined);
    return new Response(rss);
  }});
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'public, max-age=300');
  const data = await result.json();
  assert.equal(data.source.id, 'trends');
  assert.ok(Date.parse(data.fetchedAt));
  assert.equal(data.items.length, 2);
});

test('upstream failure, invalid markup, empty source and excess size are errors not data', async () => {
  for (const response of [new Response('blocked', { status: 429 }), new Response('<html>Consent</html>'), new Response('<rss/>'), new Response('x'.repeat(1_000_001)), new Response('small', { headers: { 'content-length': '1000001' } })]) {
    const result = await handlePhilippines(request(), { fetcher: async () => response });
    assert.equal(result.status, 502);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal((await result.json()).items, undefined);
  }
});

test('cache hits retain original retrieval time and do not fetch again', async () => {
  const cached = Response.json({ fetchedAt: '2026-09-14T00:00:00Z', items: [] });
  const result = await handlePhilippines(request(), { cache: { match: async () => cached }, fetcher: () => { throw new Error('cache bypassed'); } });
  assert.equal(result, cached);
  assert.equal((await result.json()).fetchedAt, '2026-09-14T00:00:00Z');
});
