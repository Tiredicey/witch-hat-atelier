// add-feed.spec.js
//
// End-to-end tests for the Settings → Add a feed by URL panel.
// We mock /discover and /fetch so the suite is hermetic; the real Worker
// is covered by tests/worker-discover.spec.js + tests/worker-proxy.spec.js.

import { test, expect } from '@playwright/test';

const SUBS_KEY = 'coda/subs/subscriptions.json';
const BRIDGE_KEY = 'coda/bridge/base';

const ATOM_BODY = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <id>urn:example:atom</id>
  <updated>2026-05-15T12:00:00Z</updated>
  <entry>
    <id>urn:example:entry:1</id>
    <title>First post</title>
    <updated>2026-05-15T12:00:00Z</updated>
    <link href="https://example.com/post-1"/>
    <content type="text">hello</content>
  </entry>
</feed>`;

async function openSettings(page) {
  await page.goto('/');
  await page.locator('#enterSettingsBtn').click();
  await expect(page.locator('#settingsPage')).toBeVisible();
}

async function clearStorage(page) {
  await page.evaluate((keys) => {
    for (const k of keys) localStorage.removeItem(k);
  }, [SUBS_KEY, BRIDGE_KEY]);
}

test.describe('Add a feed by URL — direct resolver patterns', () => {
  test('YouTube channel URL → immediate candidate, no /discover call', async ({ page }) => {
    let discoverHits = 0;
    await page.route('**/discover?**', (route) => {
      discoverHits += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"candidates":[]}' });
    });

    await openSettings(page);
    await clearStorage(page);

    await page.locator('#add-feed-input').fill('https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ');
    await page.locator('#add-feed-resolve').click();

    const status = page.locator('#add-feed-status');
    await expect(status).toHaveAttribute('data-status', 'ok');
    await expect(status).toContainText('documented feed URL pattern');

    const candidates = page.locator('#add-feed-candidates .add-feed__candidate');
    await expect(candidates).toHaveCount(1);
    await expect(candidates.first().locator('.add-feed__url'))
      .toHaveText('https://www.youtube.com/feeds/videos.xml?channel_id=UCBJycsmduvYEL83R_U4JriQ');

    expect(discoverHits).toBe(0);
  });

  test('Adding a resolved feed writes to subscriptions.json on the local adapter', async ({ page }) => {
    await openSettings(page);
    await clearStorage(page);

    await page.locator('#add-feed-input').fill('https://www.reddit.com/r/rss');
    await page.locator('#add-feed-shelf').fill('Reddit');
    await page.locator('#add-feed-resolve').click();

    const addBtn = page.locator('#add-feed-candidates .add-feed__add').first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    await expect(page.locator('#add-feed-status')).toContainText('Added');

    const subs = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), SUBS_KEY);
    expect(subs).not.toBeNull();
    expect(Array.isArray(subs.feeds)).toBe(true);
    expect(subs.feeds).toHaveLength(1);
    expect(subs.feeds[0]).toMatchObject({
      url: 'https://www.reddit.com/r/rss/.rss',
      shelf: 'Reddit',
    });
    expect(subs.feeds[0].id).toBeTruthy();
  });

  test('Adding the same feed twice is a no-op (deduped on URL)', async ({ page }) => {
    await openSettings(page);
    await clearStorage(page);

    await page.locator('#add-feed-input').fill('https://github.com/Tiredicey/witch-hat-atelier');
    await page.locator('#add-feed-resolve').click();
    await page.locator('#add-feed-candidates .add-feed__add').first().click();
    await expect(page.locator('#add-feed-status')).toContainText('Added');

    await page.locator('#add-feed-input').fill('https://github.com/Tiredicey/witch-hat-atelier');
    await page.locator('#add-feed-resolve').click();
    await page.locator('#add-feed-candidates .add-feed__add').first().click();
    await expect(page.locator('#add-feed-status')).toContainText('Already in subscriptions');

    const subs = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), SUBS_KEY);
    expect(subs.feeds).toHaveLength(1);
  });
});

test.describe('Add a feed by URL — /discover fallback', () => {
  test('Arbitrary URL hits /discover and renders candidates', async ({ page }) => {
    await page.route('**/discover?**', (route, request) => {
      const u = new URL(request.url());
      const target = u.searchParams.get('url');
      if (target === 'https://www.spot.ph/') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            candidates: [
              { url: 'https://www.spot.ph/feed/', type: 'rss', title: 'spot.ph' },
            ],
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"candidates":[]}' });
    });

    await openSettings(page);
    await clearStorage(page);

    await page.locator('#add-feed-input').fill('https://www.spot.ph/');
    await page.locator('#add-feed-resolve').click();

    const candidates = page.locator('#add-feed-candidates .add-feed__candidate');
    await expect(candidates).toHaveCount(1);
    await expect(candidates.first().locator('.add-feed__url'))
      .toHaveText('https://www.spot.ph/feed/');
  });

  test('Direct feed URL (Atom returned by server) renders as a candidate without HTML link-scan', async ({ page }) => {
    const target = 'https://rss-bridge-sop0.onrender.com/?action=display&u=spotdotph&bridge=FacebookBridge&format=Atom';
    await page.route('**/discover?**', (route, request) => {
      const u = new URL(request.url());
      if (u.searchParams.get('url') === target) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            candidates: [{ url: target, type: 'atom', title: '' }],
            probed: false,
            direct: true,
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"candidates":[]}' });
    });

    await openSettings(page);
    await clearStorage(page);

    await page.locator('#add-feed-input').fill(target);
    await page.locator('#add-feed-resolve').click();

    const candidates = page.locator('#add-feed-candidates .add-feed__candidate');
    await expect(candidates).toHaveCount(1);
    await expect(candidates.first().locator('.add-feed__url')).toHaveText(target);
  });

  test('Empty /discover response shows an honest "no feeds found" message', async ({ page }) => {
    await page.route('**/discover?**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"candidates":[],"probed":true}' }));

    await openSettings(page);
    await clearStorage(page);

    await page.locator('#add-feed-input').fill('https://example.com/');
    await page.locator('#add-feed-resolve').click();

    const status = page.locator('#add-feed-status');
    await expect(status).toHaveAttribute('data-status', 'fail');
    await expect(status).toContainText('no feed content');
    await expect(page.locator('#add-feed-candidates')).toBeHidden();
  });

  test('Upstream 4xx surfaces a bot-block diagnostic, not a generic empty message', async ({ page }) => {
    await page.route('**/discover?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [], probed: false, sourceStatus: 403 }),
      }));

    await openSettings(page);
    await clearStorage(page);

    await page.locator('#add-feed-input').fill('https://www.spot.ph/');
    await page.locator('#add-feed-resolve').click();

    const status = page.locator('#add-feed-status');
    await expect(status).toHaveAttribute('data-status', 'fail');
    await expect(status).toContainText('HTTP 403');
    await expect(status).toContainText('blocked');
  });

  test('Gate-blocked /discover surfaces a PROXY_ALLOW diagnostic', async ({ page }) => {
    await page.route('**/discover?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [], probed: false, gateBlocked: true, gateReason: 'origin not in allowlist' }),
      }));

    await openSettings(page);
    await clearStorage(page);

    await page.locator('#add-feed-input').fill('https://example.com/');
    await page.locator('#add-feed-resolve').click();

    const status = page.locator('#add-feed-status');
    await expect(status).toHaveAttribute('data-status', 'fail');
    await expect(status).toContainText('PROXY_ALLOW');
    await expect(status).toContainText('origin not in allowlist');
  });

  test('Verify button fetches the feed and reports parsed entry count', async ({ page }) => {
    await page.route('**/discover?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [{ url: 'https://example.com/feed.xml', type: 'atom', title: 'Example' }],
        }),
      }));
    await page.route('**/fetch?**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/atom+xml', body: ATOM_BODY }));

    await openSettings(page);
    await clearStorage(page);

    await page.locator('#add-feed-input').fill('https://example.com/');
    await page.locator('#add-feed-resolve').click();
    await page.locator('#add-feed-candidates .add-feed__verify').first().click();

    const verifyOut = page.locator('#add-feed-candidates .add-feed__verify-out').first();
    await expect(verifyOut).toHaveAttribute('data-status', 'ok');
    await expect(verifyOut).toContainText('Parsed 1 entrie');
  });
});

test.describe('Add a feed by URL — refused platforms', () => {
  test('facebook URL is refused with explanation and no /discover call', async ({ page }) => {
    let discoverHits = 0;
    await page.route('**/discover?**', (route) => {
      discoverHits += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"candidates":[]}' });
    });

    await openSettings(page);
    await clearStorage(page);

    await page.locator('#add-feed-input').fill('https://www.facebook.com/cosmopolitanphilippines');
    await page.locator('#add-feed-resolve').click();

    const refused = page.locator('#add-feed-refused');
    await expect(refused).toBeVisible();
    await expect(refused.locator('.add-feed__refused-head')).toContainText('Facebook');
    await expect(refused.locator('.add-feed__refused-reason')).toContainText('2018');
    const alts = refused.locator('.add-feed__refused-alts li');
    await expect(alts).toHaveCount(4);
    await expect(alts.nth(0)).toContainText('Bluesky');
    await expect(alts.nth(1)).toContainText('/feed');
    await expect(alts.nth(2)).toContainText('YouTube');
    await expect(alts.nth(3)).toContainText('FacebookBridge');
    expect(discoverHits).toBe(0);
  });

  test('saved bridge URL surfaces a candidate URL the user can adopt', async ({ page }) => {
    await openSettings(page);
    await clearStorage(page);

    await page.locator('.add-feed__bridge > summary').click();
    await page.locator('#add-feed-bridge').fill('https://rsshub.example.com');
    await page.locator('#add-feed-bridge-save').click();
    await expect(page.locator('#add-feed-bridge-status')).toHaveAttribute('data-status', 'ok');

    await page.locator('#add-feed-input').fill('https://www.facebook.com/cosmopolitanphilippines');
    await page.locator('#add-feed-resolve').click();

    const refused = page.locator('#add-feed-refused');
    await expect(refused.locator('.add-feed__refused-bridge'))
      .toContainText('rsshub.example.com/facebook/page/cosmopolitanphilippines');
    await expect(refused.locator('.add-feed__use-bridge')).toBeVisible();
  });

  test('refused with no bridge configured surfaces an inline Configure CTA that opens and focuses the bridge input', async ({ page }) => {
    await openSettings(page);
    await clearStorage(page);

    await page.locator('#add-feed-input').fill('https://www.facebook.com/cosmopolitanphilippines');
    await page.locator('#add-feed-resolve').click();

    const refused = page.locator('#add-feed-refused');
    const configureBtn = refused.locator('.add-feed__configure-bridge');
    await expect(configureBtn).toBeVisible();
    await expect(refused.locator('.add-feed__use-bridge')).toHaveCount(0);

    await expect(page.locator('#add-feed-bridge-details')).not.toHaveAttribute('open', /.*/);
    await configureBtn.click();
    await expect(page.locator('#add-feed-bridge-details')).toHaveAttribute('open', /.*/);
    await expect(page.locator('#add-feed-bridge')).toBeFocused();
  });
});

test.describe('Add a feed by URL \u2014 bridge config UX', () => {
  test('saving a bridge URL shows a configured badge in the summary; clearing hides it', async ({ page }) => {
    await openSettings(page);
    await clearStorage(page);

    const badge = page.locator('#add-feed-bridge-badge');
    await expect(badge).toBeHidden();

    await page.locator('.add-feed__bridge > summary').click();
    await page.locator('#add-feed-bridge').fill('https://rsshub.example.com');
    await page.locator('#add-feed-bridge-save').click();
    await expect(page.locator('#add-feed-bridge-status')).toHaveAttribute('data-status', 'ok');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('data-configured', 'true');
    await expect(badge).toContainText('configured');

    await page.locator('#add-feed-bridge-clear').click();
    await expect(page.locator('#add-feed-bridge-status')).toContainText('Bridge URL cleared');
    await expect(badge).toBeHidden();
    await expect(page.locator('#add-feed-bridge')).toHaveValue('');
    const stored = await page.evaluate((k) => localStorage.getItem(k), BRIDGE_KEY);
    expect(stored).toBeNull();
  });

  test('configured badge survives reload (hydrated from localStorage on next visit)', async ({ page }) => {
    await openSettings(page);
    await clearStorage(page);

    await page.evaluate((args) => {
      localStorage.setItem(args.key, args.value);
    }, { key: BRIDGE_KEY, value: 'https://rsshub.example.com' });

    await page.reload();
    await page.locator('#enterSettingsBtn').click();
    await expect(page.locator('#settingsPage')).toBeVisible();

    const badge = page.locator('#add-feed-bridge-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('data-configured', 'true');
    await expect(page.locator('#add-feed-bridge')).toHaveValue('https://rsshub.example.com');
  });
});

test.describe('Add a feed by URL — input validation', () => {
  test('Empty input shows "Paste a URL first"', async ({ page }) => {
    await openSettings(page);
    await clearStorage(page);
    await page.locator('#add-feed-resolve').click();
    await expect(page.locator('#add-feed-status')).toContainText('Paste a URL first');
  });

  test('Garbage URL reports invalid', async ({ page }) => {
    await openSettings(page);
    await clearStorage(page);
    await page.locator('#add-feed-input').fill(':::nope:::');
    await page.locator('#add-feed-resolve').click();
    const status = page.locator('#add-feed-status');
    await expect(status).toHaveAttribute('data-status', 'fail');
  });
});
