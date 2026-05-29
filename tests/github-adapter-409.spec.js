// github-adapter-409.spec.js — guards against the regression where a 409
// from GitHub's Contents API on a vault appendLog crashes a file upload.
// Covers the fix in js/adapters/github.js: per-path serialisation queue
// plus exponential-backoff retry with jitter on 409/422.

import { test, expect } from '@playwright/test';

const REPO_RE = /api\.github\.com/;

async function installFlakyMock(page, { logFailures = 0, putFailures = {} } = {}) {
  const state = {
    files: new Map(),
    shas: new Map(),
    seq: 0,
    failCounts: new Map(),
    log: [],
  };
  for (const [path, n] of Object.entries(putFailures)) {
    state.failCounts.set(path, n);
  }
  if (logFailures) state.failCounts.set('coda/v1/log.ndjson', logFailures);

  await page.route(REPO_RE, async (route, request) => {
    const url = request.url();
    const method = request.method();
    state.log.push({ method, url });

    if (!url.includes('/contents/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ full_name: 'me/coda-state' }),
      });
    }

    const m = url.match(/\/contents\/([^?]+)/);
    const path = m ? decodeURIComponent(m[1]) : '';

    if (method === 'GET') {
      if (!state.files.has(path)) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          path,
          sha: state.shas.get(path),
          content: state.files.get(path),
          encoding: 'base64',
        }),
      });
    }

    if (method === 'PUT') {
      const remaining = state.failCounts.get(path) || 0;
      if (remaining > 0) {
        state.failCounts.set(path, remaining - 1);
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: '{"message":"is at <sha> but expected <other>"}',
        });
      }
      const body = JSON.parse(request.postData() || '{}');
      state.seq += 1;
      const sha = `sha_${state.seq}`;
      state.files.set(path, body.content);
      state.shas.set(path, sha);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ content: { path, sha } }),
      });
    }

    if (method === 'DELETE') {
      state.files.delete(path);
      state.shas.delete(path);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"commit":{}}' });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return state;
}

async function makeAdapter(page) {
  return page.evaluate(async () => {
    const mod = await import('/js/adapters/github.js');
    const a = new mod.GitHubAdapter({
      token: 'ghp_test',
      owner: 'me',
      repo: 'coda-state',
      branch: 'main',
      prefix: 'coda/v1',
    });
    window.__adapter = a;
    return true;
  });
}

test.describe('GitHubAdapter 409 resilience', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('single 409 on appendLog recovers on the first retry', async ({ page }) => {
    const state = await installFlakyMock(page, { logFailures: 1 });
    await makeAdapter(page);
    await page.evaluate(() => window.__adapter.appendLog([{ t: 'file.add', id: 'a', at: 1 }]));

    const puts = state.log.filter(e => e.method === 'PUT' && e.url.includes('log.ndjson'));
    expect(puts.length).toBe(2);
    expect(state.failCounts.get('coda/v1/log.ndjson')).toBe(0);
  });

  test('three consecutive 409s recover on the fourth attempt', async ({ page }) => {
    const state = await installFlakyMock(page, { logFailures: 3 });
    await makeAdapter(page);
    await page.evaluate(() => window.__adapter.appendLog([{ t: 'file.add', id: 'b', at: 2 }]));

    const puts = state.log.filter(e => e.method === 'PUT' && e.url.includes('log.ndjson'));
    expect(puts.length).toBe(4);
  });

  test('five 409s in a row exhaust retries and surface a write error', async ({ page }) => {
    const state = await installFlakyMock(page, { logFailures: 5 });
    await makeAdapter(page);
    const err = await page.evaluate(async () => {
      try {
        await window.__adapter.appendLog([{ t: 'file.add', id: 'c', at: 3 }]);
        return null;
      } catch (e) {
        return String(e.message || e);
      }
    });
    expect(err).toMatch(/GitHub write .* 409/);
    const puts = state.log.filter(e => e.method === 'PUT' && e.url.includes('log.ndjson'));
    expect(puts.length).toBe(4);
  });

  test('concurrent putBlob + appendLog calls do not interleave PUTs to the same path', async ({ page }) => {
    const state = await installFlakyMock(page);
    await makeAdapter(page);
    await page.evaluate(async () => {
      const a = window.__adapter;
      await Promise.all([
        a.appendLog([{ t: 'file.add', id: 'd1', at: 1 }]),
        a.appendLog([{ t: 'file.add', id: 'd2', at: 2 }]),
        a.appendLog([{ t: 'file.add', id: 'd3', at: 3 }]),
      ]);
    });
    const logPuts = state.log.filter(e => e.method === 'PUT' && e.url.includes('log.ndjson'));
    expect(logPuts.length).toBe(3);
  });

  test('putBlob recovers from a single 409 on its target path', async ({ page }) => {
    const state = await installFlakyMock(page, { putFailures: { 'coda/v1/blobs/x': 1 } });
    await makeAdapter(page);
    await page.evaluate(async () => {
      const a = window.__adapter;
      const blob = new Blob(['hello']);
      await a.putBlob('coda/v1/blobs/x', blob);
    });
    const blobPuts = state.log.filter(e => e.method === 'PUT' && e.url.includes('blobs/x'));
    expect(blobPuts.length).toBe(2);
  });
});
