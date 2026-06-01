// worker-fbconnect.spec.js
//
// Unit tests for worker/src/fbconnect.js, run in the browser via dynamic
// import against the static dev server (matches the worker-scrape pattern).
// Only the no-network branches are exercised: not-configured handling, the
// OAuth dialog redirect shape, and the callback/feed input guards. The
// happy-path token exchange and Graph call hit the network and are out of
// scope here.

import { test, expect } from '@playwright/test';

const MODULE_URL = '/worker/src/fbconnect.js';
const CONFIGURED = { FB_APP_ID: '123', FB_APP_SECRET: 'sekret', FB_REDIRECT_URI: 'https://app.example/fb/callback' };

async function call(page, fnName, urlStr, env) {
  await page.goto('/');
  return page.evaluate(async ([mu, fn, u, e]) => {
    const mod = await import(mu);
    const res = await mod[fn]({}, new URL(u), e);
    return {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      location: res.headers.get('location') || '',
      body: await res.text(),
    };
  }, [MODULE_URL, fnName, urlStr, env]);
}

test.describe('fbconnect worker handlers — no-network branches', () => {
  test('/fb/login not configured talks back to the opener instead of raw JSON', async ({ page }) => {
    const r = await call(page, 'handleFbLogin', 'https://app.example/fb/login', {});
    expect(r.contentType).toContain('text/html');
    expect(r.body).toContain('coda-fb');
    expect(r.body).toContain('"ok":false');
    expect(r.body).toContain('not set up');
    expect(r.body).toContain('window.close');
  });

  test('/fb/login configured redirects to the Facebook OAuth dialog with state and scope', async ({ page }) => {
    const r = await call(page, 'handleFbLogin', 'https://app.example/fb/login', CONFIGURED);
    expect(r.status).toBe(302);
    const loc = new URL(r.location);
    expect(loc.hostname).toBe('www.facebook.com');
    expect(loc.pathname).toContain('/dialog/oauth');
    expect(loc.searchParams.get('client_id')).toBe('123');
    expect(loc.searchParams.get('redirect_uri')).toBe('https://app.example/fb/callback');
    expect(loc.searchParams.get('response_type')).toBe('code');
    expect(loc.searchParams.get('scope')).toContain('user_posts');
    expect((loc.searchParams.get('state') || '').split('.').length).toBe(2);
  });

  test('/fb/callback rejects a tampered state without exchanging the code', async ({ page }) => {
    const r = await call(page, 'handleFbCallback', 'https://app.example/fb/callback?code=abc&state=forged', CONFIGURED);
    expect(r.contentType).toContain('text/html');
    expect(r.body).toContain('"ok":false');
    expect(r.body).toContain('State check failed');
  });

  test('/fb/callback with no code reports a missing code', async ({ page }) => {
    const r = await call(page, 'handleFbCallback', 'https://app.example/fb/callback?state=x', CONFIGURED);
    expect(r.body).toContain('Missing authorization code');
  });

  test('/fb/feed not configured returns JSON not_configured (fetched, not a popup)', async ({ page }) => {
    const r = await call(page, 'handleFbFeed', 'https://app.example/fb/feed?kind=posts&token=t', {});
    expect(r.contentType).toContain('application/json');
    expect(JSON.parse(r.body).error).toBe('not_configured');
  });

  test('/fb/feed configured guards missing token and unknown kind', async ({ page }) => {
    const noToken = await call(page, 'handleFbFeed', 'https://app.example/fb/feed?kind=posts', CONFIGURED);
    expect(noToken.status).toBe(400);
    expect(JSON.parse(noToken.body).error).toBe('missing token');

    const badKind = await call(page, 'handleFbFeed', 'https://app.example/fb/feed?kind=weird&token=t', CONFIGURED);
    expect(badKind.status).toBe(400);
    expect(JSON.parse(badKind.body).error).toBe('unknown kind');
  });

  test('/fb/feed names the missing permission when Graph denies posts', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async ([mu, u, e]) => {
      const realFetch = window.fetch;
      window.fetch = async (input) => {
        const s = String(input);
        if (s.includes('/me/permissions')) {
          return new Response(JSON.stringify({ data: [
            { permission: 'public_profile', status: 'granted' },
            { permission: 'user_posts', status: 'declined' },
          ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ error: { message: '(#200) Permissions error', code: 200 } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } });
      };
      try {
        const mod = await import(mu);
        const res = await mod.handleFbFeed({}, new URL(u), e);
        return { status: res.status, body: await res.text() };
      } finally {
        window.fetch = realFetch;
      }
    }, [MODULE_URL, 'https://app.example/fb/feed?kind=posts&token=T', CONFIGURED]);
    expect(r.status).toBe(502);
    const err = JSON.parse(r.body).error;
    expect(err).toContain('user_posts');
    expect(err).toContain('Disconnect');
  });
});
