import { PHILIPPINES_SOURCES, exploreUrl, safeSourceUrl } from '../../js/philippines-sources.js';
import { scrapeFeedItems } from './scrape.js';

function text(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (entity[0] !== '#') return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[entity.toLowerCase()] || match;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/\s+/g, ' ').trim();
}

function field(block, tag) {
  return text(block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '');
}

export function parseTrends(xml) {
  if (!/<rss\b/i.test(xml)) throw new Error('Unreadable RSS');
  const items = [];
  const seen = new Set();
  for (const [block] of xml.matchAll(/<item\b[^>]*>[\s\S]*?<\/item>/gi)) {
    const title = field(block, 'title');
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const related = [];
    for (const [news] of block.matchAll(/<ht:news_item\b[^>]*>[\s\S]*?<\/ht:news_item>/gi)) {
      const url = safeSourceUrl(field(news, 'ht:news_item_url'));
      const headline = field(news, 'ht:news_item_title');
      if (url && headline) related.push({ title: headline, url, publisher: field(news, 'ht:news_item_source') });
    }
    items.push({ id: title, title, url: exploreUrl({ term: title }), published: Date.parse(field(block, 'pubDate')) || null,
      traffic: field(block, 'ht:approx_traffic') || null, related: related.slice(0, 5) });
    if (items.length === 40) break;
  }
  return items;
}

export function parse8List(html, source) {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const main = cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!main) throw new Error('Unreadable listing');
  const items = [];
  const seen = new Set();
  for (const [article] of main.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)) {
    const heading = article.match(/<h[2-4]\b[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>[\s\S]*?<\/h[2-4]>/i)?.[0];
    if (!heading) continue;
    const item = scrapeFeedItems(heading, source.url, { minItems: 1, limit: 1 }).items[0];
    const url = safeSourceUrl(item?.link, 'https://8list.ph');
    if (!item || !url || seen.has(url)) continue;
    seen.add(url);
    const date = [...article.matchAll(/<time\b([^>]*)>/gi)].find(([, attrs]) => /\bpublished\b/.test(attrs))?.[1];
    const published = Date.parse(date?.match(/\bdatetime=["']([^"']+)["']/i)?.[1] || '') || null;
    items.push({ id: url, title: item.title, url, published });
    if (items.length === 24) break;
  }
  return items;
}

async function fetchSource(source, fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher(source.upstream, {
      signal: controller.signal, redirect: 'error',
      headers: { Accept: source.kind === 'rss' ? 'application/rss+xml, text/xml' : 'text/html', 'User-Agent': 'CODA/0.1 (+https://github.com/Tiredicey/witch-hat-atelier)' },
    });
    if (!response.ok || !response.body) throw new Error('Upstream unavailable');
    if (Number(response.headers.get('content-length')) > 1_000_000) throw new Error('Response too large');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let body = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_000_000) { await reader.cancel(); throw new Error('Response too large'); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    return source.kind === 'rss' ? parseTrends(body) : parse8List(body, source);
  } finally { clearTimeout(timer); }
}

export async function handlePhilippines(request, { fetcher = fetch, cache = globalThis.caches?.default, waitUntil } = {}) {
  const json = (data, status = 200) => Response.json(data, {
    status, headers: { 'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  const url = new URL(request.url);
  const id = url.searchParams.get('source') || 'trends';
  const source = PHILIPPINES_SOURCES.find(item => item.id === id);
  if (!source || [...url.searchParams.keys()].some(key => key !== 'source') || url.searchParams.getAll('source').length > 1) return json({ error: 'Choose a built-in Philippines source.' }, 400);
  const cacheUrl = new URL('/philippines', url.origin);
  cacheUrl.searchParams.set('source', id);
  const key = new Request(cacheUrl);
  try {
    const hit = await cache?.match(key);
    if (hit) return hit;
  } catch {}
  try {
    const items = await fetchSource(source, fetcher);
    if (!items.length) return json({ error: 'No readable items returned by the source. Open the original page or retry later.', source: source.url }, 502);
    const result = json({ source: { id, label: source.label, publisher: source.publisher, url: source.url, upstream: source.upstream, kind: source.kind }, fetchedAt: new Date().toISOString(), items });
    if (cache && waitUntil) waitUntil(cache.put(key, result.clone()).catch(() => {}));
    return result;
  } catch (error) {
    return json({ error: error.name === 'AbortError' ? 'The source did not respond within 12 seconds.' : 'Could not retrieve this source. It may be unavailable or its format may have changed.', source: source.url }, 502);
  }
}
