// worker-proxy.spec.js
//
// Tests for the universal CORS proxy in worker/src/proxy.js and the
// GET /fetch route in worker/src/index.js. The pure-function tests
// (allowProxy) cover the gate logic without any network call. The route
// tests construct ad-hoc Request + env objects and assert the response
// status / headers. The upstream-fetch success path is exercised in
// production by the curl example in worker/README.md and not stubbed
// here — every test below relies only on validation / gate logic that
// runs before any outbound fetch.

import { test, expect } from '@playwright/test';

const PROXY_URL = '/worker/src/proxy.js';
const INDEX_URL = '/worker/src/index.js';

test.describe('worker proxy.js — allowProxy gate', () => {
  test('rejects non-http(s) schemes', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (url) => {
      const { allowProxy } = await import(url);
      return [
        allowProxy('ftp://example.com/feed', '*'),
        allowProxy('file:///etc/passwd', '*'),
        allowProxy('javascript:alert(1)', '*'),
      ];
    }, PROXY_URL);
    for (const r of out) {
      expect(r.ok).toBe(false);
    }
    expect(out[0].reason).toBe('scheme not http(s)');
  });

  test('rejects loopback and private IPv4 even with wildcard', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (url) => {
      const { allowProxy } = await import(url);
      return [
        allowProxy('http://localhost/feed', '*'),
        allowProxy('http://127.0.0.1:8080/feed', '*'),
        allowProxy('http://10.0.0.1/feed', '*'),
        allowProxy('http://172.16.5.10/feed', '*'),
        allowProxy('http://192.168.1.1/feed', '*'),
        allowProxy('http://169.254.169.254/latest/meta-data', '*'),
      ];
    }, PROXY_URL);
    for (const r of out) {
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('private host blocked');
    }
  });

  test('treats empty PROXY_ALLOW as proxy-disabled', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (url) => {
      const { allowProxy } = await import(url);
      return [
        allowProxy('https://example.com/feed', undefined),
        allowProxy('https://example.com/feed', ''),
        allowProxy('https://example.com/feed', '   '),
      ];
    }, PROXY_URL);
    for (const r of out) {
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('proxy disabled');
    }
  });

  test('wildcard allows arbitrary public http(s)', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (url) => {
      const { allowProxy } = await import(url);
      return [
        allowProxy('https://www.mnot.net/blog/index.atom', '*'),
        allowProxy('http://example.org/feed.xml', '*'),
      ];
    }, PROXY_URL);
    for (const r of out) expect(r.ok).toBe(true);
  });

  test('comma-separated prefix list gates by URL prefix match', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (url) => {
      const { allowProxy } = await import(url);
      const allow = 'https://www.mnot.net/, https://www.jsonfeed.org/';
      return {
        allowedA: allowProxy('https://www.mnot.net/blog/index.atom', allow),
        allowedB: allowProxy('https://www.jsonfeed.org/feed.json',    allow),
        denied:   allowProxy('https://evil.example/feed',             allow),
      };
    }, PROXY_URL);
    expect(out.allowedA.ok).toBe(true);
    expect(out.allowedB.ok).toBe(true);
    expect(out.denied.ok).toBe(false);
    expect(out.denied.reason).toBe('origin not in allowlist');
  });

  test('rejects malformed URLs', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (url) => {
      const { allowProxy } = await import(url);
      return allowProxy('not a url at all', '*');
    }, PROXY_URL);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid url');
  });
});

test.describe('worker /fetch route', () => {
  async function callFetch({ page, path, env, headers }) {
    return await page.evaluate(async ({ moduleUrl, path, env, headers }) => {
      const mod = await import(moduleUrl);
      const req = new Request(`https://worker.local${path}`, {
        method: 'GET',
        headers: headers || {},
      });
      const resp = await mod.default.fetch(req, env);
      const text = await resp.text();
      const out = {};
      resp.headers.forEach((v, k) => { out[k.toLowerCase()] = v; });
      return { status: resp.status, headers: out, body: text };
    }, { moduleUrl: INDEX_URL, path, env, headers });
  }

  test('OPTIONS preflight returns 204 with CORS headers', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async (moduleUrl) => {
      const mod = await import(moduleUrl);
      const req = new Request('https://worker.local/fetch?url=https://example.com', { method: 'OPTIONS' });
      const resp = await mod.default.fetch(req, {});
      const h = {};
      resp.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
      return { status: resp.status, headers: h };
    }, INDEX_URL);
    expect(out.status).toBe(204);
    expect(out.headers['access-control-allow-origin']).toBe('*');
    expect(out.headers['access-control-allow-methods']).toContain('GET');
  });

  test('missing url query → 400', async ({ page }) => {
    await page.goto('/');
    const out = await callFetch({ page, path: '/fetch', env: { PROXY_ALLOW: '*' } });
    expect(out.status).toBe(400);
    expect(out.body).toContain('missing url');
  });

  test('unset PROXY_ALLOW → 403 proxy disabled', async ({ page }) => {
    await page.goto('/');
    const out = await callFetch({
      page,
      path: '/fetch?url=' + encodeURIComponent('https://www.mnot.net/blog/index.atom'),
      env: {},
    });
    expect(out.status).toBe(403);
    expect(out.body).toContain('proxy disabled');
  });

  test('allowlist mismatch → 403 origin not in allowlist', async ({ page }) => {
    await page.goto('/');
    const out = await callFetch({
      page,
      path: '/fetch?url=' + encodeURIComponent('https://evil.example/feed'),
      env: { PROXY_ALLOW: 'https://www.mnot.net/' },
    });
    expect(out.status).toBe(403);
    expect(out.body).toContain('not in allowlist');
  });

  test('private-host target rejected even with wildcard', async ({ page }) => {
    await page.goto('/');
    const out = await callFetch({
      page,
      path: '/fetch?url=' + encodeURIComponent('http://127.0.0.1:8080/admin'),
      env: { PROXY_ALLOW: '*' },
    });
    expect(out.status).toBe(403);
    expect(out.body).toContain('private host blocked');
  });

  test('CORS headers present on the 403 response too', async ({ page }) => {
    await page.goto('/');
    const out = await callFetch({
      page,
      path: '/fetch?url=' + encodeURIComponent('http://127.0.0.1/feed'),
      env: { PROXY_ALLOW: '*' },
    });
    expect(out.status).toBe(403);
    expect(out.headers['access-control-allow-origin']).toBe('*');
  });
});
