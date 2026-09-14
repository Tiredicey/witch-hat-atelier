import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { loadFeedFromBrowserEngine } from '../js/feed-engine.js';

const target = 'https://news.google.com/rss?hl=en-PH&gl=PH&ceid=PH%3Aen';
const request = url => new Request('https://coda.test/fetch?url=' + encodeURIComponent(url));

test('Google automated-query block stays an error with an explicit reason', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>your network may be sending automated queries</html>', { status: 503, headers: { 'Content-Type': 'text/html' } });
    const response = await worker.fetch(request(target), { PROXY_ALLOW: '*' });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '300');
    const body = await response.json();
    assert.equal(body.code, 'google_news_blocked');
    assert.equal(body.upstreamStatus, 503);
    assert.match(body.error, /blocking automated requests/);
  } finally { globalThis.fetch = original; }
});

test('unrelated upstream errors are not mislabelled as a Google block', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>Maintenance</html>', {status:503, headers:{'Content-Type':'text/html'}});
    const response = await worker.fetch(request(target), {PROXY_ALLOW:'*'});
    assert.equal(response.status,503);
    assert.equal(await response.text(),'<html>Maintenance</html>');
    globalThis.fetch = async () => new Response('<html>automated queries</html>', {status:503, headers:{'Content-Type':'text/html'}});
    const other = await worker.fetch(request('https://example.com/feed'), {PROXY_ALLOW:'*'});
    assert.equal(other.headers.get('content-type'),'text/html');
  } finally { globalThis.fetch = original; }
});

test('feed engine reports the Google block while retaining unrelated real feed entries', async () => {
  const original = globalThis.fetch;
  const feeds = [{url:target},{url:'https://example.com/feed'}];
  let report;
  try {
    globalThis.fetch = async input => {
      const url = new URL(input, 'https://coda.test').searchParams.get('url');
      return url === target ? Response.json({code:'google_news_blocked'}, {status:503}) : new Response('<rss><channel><title>Test feed</title><item><title>Available story</title><link>https://example.com/story</link></item></channel></rss>');
    };
    const entries = await loadFeedFromBrowserEngine({adapter:{read:async()=>JSON.stringify({feeds})},onReport:r=>{report=r;}});
    assert.equal(entries.length,1);
    assert.equal(entries[0].title,'Available story');
    assert.equal(report.failed,1);
    assert.equal(report.failures[0].code,'google_news_blocked');
    assert.match(report.failures[0].message,/Google News is blocking/);
  } finally { globalThis.fetch = original; }
});
