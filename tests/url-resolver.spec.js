// url-resolver.spec.js
//
// Pure browser-side unit tests for js/url-resolver.js. Same pattern as
// worker-discover.spec.js: dynamic-import the module against the static
// dev server, no outbound fetches.

import { test, expect } from '@playwright/test';

const MODULE_URL = '/js/url-resolver.js';

async function resolveIn(page, raw, opts) {
  return page.evaluate(async ({ mu, raw, opts }) => {
    const { resolve } = await import(mu);
    return resolve(raw, opts || {});
  }, { mu: MODULE_URL, raw, opts });
}

test.describe('url-resolver — direct feed patterns', () => {
  test('youtube channel-by-ID resolves to feeds/videos.xml?channel_id', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ');
    expect(r.kind).toBe('feed');
    expect(r.source).toBe('youtube-channel');
    expect(r.feedUrl).toBe('https://www.youtube.com/feeds/videos.xml?channel_id=UCBJycsmduvYEL83R_U4JriQ');
  });

  test('youtube playlist resolves to feeds/videos.xml?playlist_id', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    expect(r.kind).toBe('feed');
    expect(r.source).toBe('youtube-playlist');
    expect(r.feedUrl).toContain('playlist_id=PL');
  });

  test('youtube @handle falls through to discover (channel_id not derivable client-side)', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.youtube.com/@MrBeast');
    expect(r.kind).toBe('discover');
  });

  test('reddit subreddit → /r/{name}/.rss', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.reddit.com/r/rss');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://www.reddit.com/r/rss/.rss');
    expect(r.source).toBe('reddit-subreddit');
  });

  test('mastodon profile on any instance → /@user.rss', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://mastodon.social/@Gargron');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://mastodon.social/@Gargron.rss');
    expect(r.source).toBe('mastodon-profile');
  });

  test('github repo → releases.atom', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://github.com/Tiredicey/witch-hat-atelier');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://github.com/Tiredicey/witch-hat-atelier/releases.atom');
    expect(r.source).toBe('github-releases');
  });
});

test.describe('url-resolver — refused platforms', () => {
  for (const host of ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com']) {
    test(`${host} is refused with an explanation`, async ({ page }) => {
      await page.goto('/');
      const r = await resolveIn(page, `https://${host}/zuck`);
      expect(r.kind).toBe('refused');
      expect(r.platform).toBe('Facebook');
      expect(r.reason).toMatch(/2018/);
    });
  }

  test('x.com is refused as X (Twitter)', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://x.com/jack');
    expect(r.kind).toBe('refused');
    expect(r.platform).toBe('X (Twitter)');
    expect(r.reason).toMatch(/2013/);
  });

  test('instagram is refused', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.instagram.com/instagram');
    expect(r.kind).toBe('refused');
    expect(r.platform).toBe('Instagram');
  });

  test('tiktok is refused', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.tiktok.com/@charlidamelio');
    expect(r.kind).toBe('refused');
    expect(r.platform).toBe('TikTok');
  });

  test('refused without bridge URL → bridge hint is configured:false, no candidate URL', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.facebook.com/cosmopolitanphilippines');
    expect(r.bridgeHint.configured).toBe(false);
    expect(r.bridgeHint.candidateUrl).toBeUndefined();
  });

  test('refused WITH bridge URL → bridge hint surfaces a candidate URL on the bridge base', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.facebook.com/cosmopolitanphilippines', {
      bridgeBase: 'https://rsshub.example.com',
    });
    expect(r.bridgeHint.configured).toBe(true);
    expect(r.bridgeHint.candidateUrl).toBe('https://rsshub.example.com/facebook/page/cosmopolitanphilippines');
  });
});

test.describe('url-resolver — discover fallback', () => {
  test('arbitrary site URL returns kind:discover with the original URL', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.spot.ph/');
    expect(r.kind).toBe('discover');
    expect(r.pageUrl).toBe('https://www.spot.ph/');
  });

  test('cosmo.ph article URL also falls through to discover', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.cosmo.ph/lifestyle/');
    expect(r.kind).toBe('discover');
  });

  test('host without scheme is upgraded to https before parsing', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'www.mnot.net/blog/');
    expect(r.kind).toBe('discover');
    expect(r.pageUrl).toBe('https://www.mnot.net/blog/');
  });
});

test.describe('url-resolver — invalid input', () => {
  test('empty string is invalid', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, '');
    expect(r.kind).toBe('invalid');
  });

  test('garbage is invalid', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, ':::not a url:::');
    expect(r.kind).toBe('invalid');
  });

  test('ftp:// is rejected as unsupported protocol', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'ftp://example.com/feed');
    expect(r.kind).toBe('invalid');
    expect(r.reason).toMatch(/protocol/i);
  });
});
