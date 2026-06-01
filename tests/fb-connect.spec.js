// fb-connect.spec.js
//
// Tests the Settings → "Connect Facebook with sign-in" surface (ROADMAP §19).
// The OAuth popup and the Graph API are never hit: /fb/feed is mocked and the
// connected state is seeded directly, so the suite is hermetic. The Worker's
// own OAuth/Graph logic is covered separately at the handler level.

import { test, expect } from '@playwright/test';

const TOKEN_KEY = 'coda/social/fb-token';
const SUBS_KEY = 'coda/subs/subscriptions.json';

const FB_ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>My Facebook posts</title>
  <id>urn:coda:fb</id>
  <updated>2026-06-01T00:00:00Z</updated>
  <entry><id>u:1</id><title>Coffee on the balcony</title><updated>2026-06-01T00:00:00Z</updated><link href="https://www.facebook.com/p/1"/></entry>
  <entry><id>u:2</id><title>Repo hit 100 stars</title><updated>2026-05-31T00:00:00Z</updated><link href="https://www.facebook.com/p/2"/></entry>
  <entry><id>u:3</id><title>Weekend hike photos</title><updated>2026-05-30T00:00:00Z</updated><link href="https://www.facebook.com/p/3"/></entry>
</feed>`;

async function seedConnected(page) {
  await page.goto('/');
  await page.evaluate(({ key }) => {
    localStorage.setItem(key, JSON.stringify({ token: 'TEST_USER_TOKEN', expiresAt: Date.now() + 3600_000 }));
  }, { key: TOKEN_KEY });
  await page.reload();
}

async function openConnect(page) {
  await page.locator('#enterSettingsBtn').click();
  await expect(page.locator('#settingsPage')).toBeVisible();
  await page.locator('summary', { hasText: 'Connect Facebook with sign-in' }).click();
}

test.describe('Facebook connect — compliant OAuth surface', () => {
  test('discloses the token destination before any /fb/feed call, then previews', async ({ page }) => {
    let feedHits = 0;
    await page.route('**/fb/feed?**', (route) => {
      feedHits += 1;
      return route.fulfill({ status: 200, contentType: 'application/atom+xml', body: FB_ATOM });
    });

    await seedConnected(page);
    await openConnect(page);

    await expect(page.locator('#fb-connect-btn')).toBeHidden();
    await expect(page.locator('#fb-preview-btn')).toBeVisible();

    await page.locator('#fb-preview-btn').click();
    await expect(page.locator('#fb-connect-preview')).toContainText('sends your Facebook access token');
    await expect(page.locator('#fb-preview-continue')).toBeVisible();
    expect(feedHits).toBe(0);

    await page.locator('#fb-preview-continue').click();
    await expect(page.locator('#fb-connect-preview')).toContainText('3 posts found');
    await expect(page.locator('#fb-connect-preview li')).toHaveCount(3);
    await expect(page.locator('#fb-connect-preview')).toContainText('Coffee on the balcony');
    expect(feedHits).toBe(1);
  });

  test('Add to subscriptions appends the same-origin /fb/feed endpoint', async ({ page }) => {
    await page.route('**/fb/feed?**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/atom+xml', body: FB_ATOM }));

    await seedConnected(page);
    await openConnect(page);
    await page.locator('#fb-preview-btn').click();
    await page.locator('#fb-preview-continue').click();
    await page.locator('#fb-preview-add').click();

    await expect(page.locator('#fb-connect-status')).toContainText('Added');
    const subs = await page.evaluate((key) => localStorage.getItem(key), SUBS_KEY);
    expect(subs).toBeTruthy();
    const parsed = JSON.parse(subs);
    const fb = parsed.feeds.find((f) => f.url.includes('/fb/feed') && f.url.includes('kind=posts'));
    expect(fb).toBeTruthy();
    expect(fb.title).toBe('My Facebook posts');
  });

  test('Disconnect deletes the token (kill switch)', async ({ page }) => {
    await seedConnected(page);
    await openConnect(page);

    await expect(page.locator('#fb-disconnect-btn')).toBeVisible();
    await page.locator('#fb-disconnect-btn').click();

    await expect(page.locator('#fb-connect-status')).toContainText('Disconnected');
    await expect(page.locator('#fb-connect-btn')).toBeVisible();
    await expect(page.locator('#fb-preview-btn')).toBeHidden();
    const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
    expect(token).toBeNull();
  });

  test('a coda-fb postMessage connects without touching the OAuth popup', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((key) => localStorage.removeItem(key), TOKEN_KEY);
    await page.reload();
    await openConnect(page);

    await expect(page.locator('#fb-connect-btn')).toBeVisible();
    await page.evaluate(() => {
      window.postMessage({ source: 'coda-fb', ok: true, token: 'FROM_POPUP', expiresIn: 3600 }, '*');
    });

    await expect(page.locator('#fb-connect-status')).toContainText('Connected');
    await expect(page.locator('#fb-preview-btn')).toBeVisible();
    const token = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).token, TOKEN_KEY);
    expect(token).toBe('FROM_POPUP');
  });

  test('states the friends-feed limit honestly in the panel', async ({ page }) => {
    await page.goto('/');
    await openConnect(page);
    const block = page.locator('details.add-feed__social', { hasText: 'Connect Facebook with sign-in' });
    await expect(block).toContainText('not');
    await expect(block).toContainText("friends");
    await expect(block).toContainText('home timeline');
  });
});
