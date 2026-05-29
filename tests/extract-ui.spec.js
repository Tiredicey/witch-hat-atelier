// extract-ui.spec.js
//
// Exercises the Reader-pane "Read clean" toggle against a mocked /extract
// route. The Worker extractor is covered by tests/worker-extract.spec.js;
// this spec asserts the UI plumbing in js/reader.js + index.html.
//
// SAMPLE articles do not carry a `link` field, so the toggle is hidden in
// the default boot. To exercise the toggle deterministically we instantiate
// a Reader inside the loaded page via page.evaluate, against an isolated
// DOM fixture. That matches the unit-import pattern used by opml.spec.js.

import { test, expect } from '@playwright/test';

const READER_MODULE = '/js/reader.js';
const CLEAN_HTML = '<!doctype html><html><head><title>Clean</title></head>' +
                   '<body><h1 id="clean-marker">Clean copy of the article</h1>' +
                   '<p>One short paragraph.</p></body></html>';

const EXTRACT_RE = /\/extract\?/;

async function mockExtract(page, body, status = 200, contentType = 'text/html') {
  await page.route(EXTRACT_RE, (route) => {
    route.fulfill({ status, contentType, body });
  });
}

test.describe('Reader → /extract Read-clean toggle', () => {
  test('shows the toggle only when the article has an http(s) link', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium',
      'reader-wrap is display:none in mobile list view; extract toggle is desktop-only here');
    await page.goto('/');
    await page.evaluate(async (modUrl) => {
      const { Reader } = await import(modUrl);
      const host = document.createElement('div');
      host.id = 'extract-test-host';
      host.innerHTML = `
        <main class="reader-wrap" id="rw"><div class="reader__actions"></div>
          <div class="reader__extract" id="rx" hidden>
            <button id="rxBtn" aria-pressed="false">Read clean</button>
            <p id="rxStatus"></p>
          </div>
          <div class="reader" id="r"></div>
        </main>`;
      document.body.appendChild(host);
      const r = new Reader({
        wrapEl: host.querySelector('#rw'),
        readerEl: host.querySelector('#r'),
        extractWrapEl: host.querySelector('#rx'),
        extractBtn: host.querySelector('#rxBtn'),
        extractStatusEl: host.querySelector('#rxStatus'),
      });
      r.renderArticle({ id: 'x', title: 'No link here', source: 'sample', age: '1h', read: false, body: ['p1'] });
      window.__rr = r;
    }, READER_MODULE);
    await expect(page.locator('#rx')).toBeHidden();

    await page.evaluate(() => {
      window.__rr.renderArticle({
        id: 'y', title: 'Has link', source: 'sample', age: '1h', read: false,
        body: ['original paragraph'], link: 'https://example.com/article',
      });
    });
    await expect(page.locator('#rx')).toBeVisible();
  });

  test('toggles to clean copy and back, mounts iframe with sandbox', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium',
      'reader-wrap is display:none in mobile list view; extract toggle is desktop-only here');
    await mockExtract(page, CLEAN_HTML);
    await page.goto('/');
    await page.evaluate(async (modUrl) => {
      const { Reader } = await import(modUrl);
      const host = document.createElement('div');
      host.id = 'extract-test-host';
      host.innerHTML = `
        <main class="reader-wrap" id="rw"><div class="reader__actions"></div>
          <div class="reader__extract" id="rx" hidden>
            <button id="rxBtn" aria-pressed="false">Read clean</button>
            <p id="rxStatus"></p>
          </div>
          <div class="reader" id="r"></div>
        </main>`;
      document.body.appendChild(host);
      const r = new Reader({
        wrapEl: host.querySelector('#rw'),
        readerEl: host.querySelector('#r'),
        extractWrapEl: host.querySelector('#rx'),
        extractBtn: host.querySelector('#rxBtn'),
        extractStatusEl: host.querySelector('#rxStatus'),
      });
      r.renderArticle({
        id: 'y', title: 'Has link', source: 'sample', age: '1h', read: false,
        body: ['original paragraph'], link: 'https://example.com/article',
      });
      window.__rr = r;
    }, READER_MODULE);

    await page.locator('#rxBtn').click();

    const frame = page.locator('#r iframe.reader__extract-frame');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
    const srcdoc = await frame.getAttribute('srcdoc');
    expect(srcdoc || '').toContain('Clean copy of the article');
    await expect(page.locator('#rxBtn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#rxBtn')).toHaveText('Read original');

    await page.locator('#rxBtn').click();
    await expect(page.locator('#r iframe.reader__extract-frame')).toHaveCount(0);
    await expect(page.locator('#rxBtn')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#rxBtn')).toHaveText('Read clean');
  });

  test('upstream failure surfaces a fail status without mounting iframe', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium',
      'reader-wrap is display:none in mobile list view; extract toggle is desktop-only here');
    await mockExtract(page, '{"error":"upstream"}', 502, 'application/json');
    await page.goto('/');
    await page.evaluate(async (modUrl) => {
      const { Reader } = await import(modUrl);
      const host = document.createElement('div');
      host.id = 'extract-test-host';
      host.innerHTML = `
        <main class="reader-wrap" id="rw"><div class="reader__actions"></div>
          <div class="reader__extract" id="rx" hidden>
            <button id="rxBtn" aria-pressed="false">Read clean</button>
            <p id="rxStatus"></p>
          </div>
          <div class="reader" id="r"></div>
        </main>`;
      document.body.appendChild(host);
      const r = new Reader({
        wrapEl: host.querySelector('#rw'),
        readerEl: host.querySelector('#r'),
        extractWrapEl: host.querySelector('#rx'),
        extractBtn: host.querySelector('#rxBtn'),
        extractStatusEl: host.querySelector('#rxStatus'),
      });
      r.renderArticle({
        id: 'y', title: 'Has link', source: 'sample', age: '1h', read: false,
        body: ['original'], link: 'https://example.com/article',
      });
      window.__rr = r;
    }, READER_MODULE);

    await page.locator('#rxBtn').click();
    await expect(page.locator('#rxStatus')).toHaveText(/Extract failed \(HTTP 502\)/);
    await expect(page.locator('#rxStatus')).toHaveAttribute('data-status', 'fail');
    await expect(page.locator('#r iframe.reader__extract-frame')).toHaveCount(0);
    await expect(page.locator('#rxBtn')).toHaveAttribute('aria-pressed', 'false');
  });
});
