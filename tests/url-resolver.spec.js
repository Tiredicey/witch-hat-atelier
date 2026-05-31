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

  test('substack publication → {subdomain}.substack.com/feed', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://noahpinion.substack.com/');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://noahpinion.substack.com/feed');
    expect(r.source).toBe('substack');
  });

  test('substack.com root falls through to /discover (no publication subdomain)', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://substack.com/');
    expect(r.kind).toBe('discover');
  });

  test('bluesky DNS-style handle resolves to bsky.app/profile/<handle>/rss', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://bsky.app/profile/jay.bsky.team');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://bsky.app/profile/jay.bsky.team/rss');
    expect(r.source).toBe('bluesky');
  });

  test('bluesky custom-domain handle (no .bsky.social) resolves directly', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://bsky.app/profile/bsky.app');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://bsky.app/profile/bsky.app/rss');
  });

  test('bluesky DID handle resolves to /rss', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://bsky.app/profile/did:plc:abcdef1234');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://bsky.app/profile/did:plc:abcdef1234/rss');
  });

  test('bluesky root falls through to /discover (no profile path)', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://bsky.app/');
    expect(r.kind).toBe('discover');
  });

  test('medium @user → medium.com/feed/@user', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://medium.com/@daveberndtson');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://medium.com/feed/@daveberndtson');
    expect(r.source).toBe('medium-user');
  });

  test('medium publication → medium.com/feed/{slug}', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://medium.com/better-programming');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://medium.com/feed/better-programming');
    expect(r.source).toBe('medium-publication');
  });

  test('tumblr blog → {subdomain}.tumblr.com/rss', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://staff.tumblr.com/');
    expect(r.kind).toBe('feed');
    expect(r.feedUrl).toBe('https://staff.tumblr.com/rss');
    expect(r.source).toBe('tumblr');
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

test.describe('url-resolver — expanded no-RSS host coverage', () => {
  const hosts = [
    ['https://web.facebook.com/nasa', 'Facebook'],
    ['https://business.facebook.com/nasa', 'Facebook'],
    ['https://l.facebook.com/l.php', 'Facebook'],
    ['https://fb.watch/abc123/', 'Facebook'],
    ['https://instagr.am/natgeo', 'Instagram'],
    ['https://vm.tiktok.com/ZMabc/', 'TikTok'],
    ['https://vt.tiktok.com/ZMabc/', 'TikTok'],
    ['https://mobile.twitter.com/jack', 'X (Twitter)'],
  ];
  for (const [url, platform] of hosts) {
    test(`${url} is refused as ${platform}`, async ({ page }) => {
      await page.goto('/');
      const r = await resolveIn(page, url);
      expect(r.kind).toBe('refused');
      expect(r.platform).toBe(platform);
    });
  }

  test('web.facebook.com/@handle does NOT misfire the Mastodon @user pattern', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://web.facebook.com/@cocacola');
    expect(r.kind).toBe('refused');
    expect(r.platform).toBe('Facebook');
  });
});

test.describe('url-resolver — bridge route shapes (documented routes only)', () => {
  const bridge = { bridgeBase: 'https://rsshub.example.com' };

  test('facebook vanity page → /facebook/page/{slug}', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://business.facebook.com/nasa', bridge);
    expect(r.bridgeHint.candidateUrl).toBe('https://rsshub.example.com/facebook/page/nasa');
  });

  test('facebook profile.php?id= → no candidate, points at the bridge docs', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.facebook.com/profile.php?id=100064', bridge);
    expect(r.bridgeHint.configured).toBe(true);
    expect(r.bridgeHint.candidateUrl).toBeUndefined();
    expect(r.bridgeHint.message).toMatch(/documented route/i);
  });

  test('facebook /groups/ → no candidate (not a page)', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.facebook.com/groups/123456', bridge);
    expect(r.bridgeHint.candidateUrl).toBeUndefined();
  });

  test('fb.watch share link → no candidate (not a page slug)', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://fb.watch/abc123/', bridge);
    expect(r.bridgeHint.candidateUrl).toBeUndefined();
  });

  test('instagram user → /instagram/user/{handle}', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://instagr.am/natgeo', bridge);
    expect(r.bridgeHint.candidateUrl).toBe('https://rsshub.example.com/instagram/user/natgeo');
  });

  test('instagram /p/ post → no candidate (not a profile)', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.instagram.com/p/Cabc123/', bridge);
    expect(r.bridgeHint.candidateUrl).toBeUndefined();
  });

  test('x /status/ tweet → no candidate (not a user timeline)', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://x.com/jack/status/20', bridge);
    expect(r.bridgeHint.candidateUrl).toBeUndefined();
  });

  test('x handle → /twitter/user/{handle}', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://x.com/jack', bridge);
    expect(r.bridgeHint.candidateUrl).toBe('https://rsshub.example.com/twitter/user/jack');
  });

  test('tiktok @handle → /tiktok/user/@{handle}', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.tiktok.com/@charlidamelio', bridge);
    expect(r.bridgeHint.candidateUrl).toBe('https://rsshub.example.com/tiktok/user/@charlidamelio');
  });

  test('tiktok bare share host → no candidate (no @handle in path)', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://vm.tiktok.com/ZMabc/', bridge);
    expect(r.bridgeHint.candidateUrl).toBeUndefined();
  });
});

test.describe('url-resolver — RSS-Bridge backend (bridgeKind: rss-bridge)', () => {
  const rb = { bridgeBase: 'https://rss-bridge-sop0.onrender.com', bridgeKind: 'rss-bridge' };

  test('facebook user page → FacebookBridge User context with u=', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.facebook.com/docalvinfrancisco', rb);
    expect(r.kind).toBe('refused');
    expect(r.bridgeHint.kind).toBe('rss-bridge');
    expect(r.bridgeHint.candidateUrl).toBe(
      'https://rss-bridge-sop0.onrender.com/?action=display&bridge=FacebookBridge&context=User&u=docalvinfrancisco&format=Atom'
    );
  });

  test('facebook /groups/{id} → FacebookBridge Group context with g=', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.facebook.com/groups/123456', rb);
    expect(r.bridgeHint.candidateUrl).toContain('bridge=FacebookBridge');
    expect(r.bridgeHint.candidateUrl).toContain('context=Group');
    expect(r.bridgeHint.candidateUrl).toContain('g=123456');
  });

  test('facebook profile.php?id= → no candidate on RSS-Bridge either', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.facebook.com/profile.php?id=100064', rb);
    expect(r.bridgeHint.candidateUrl).toBeUndefined();
    expect(r.bridgeHint.message).toMatch(/no documented/i);
  });

  test('instagram user → InstagramBridge Username context', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://instagr.am/natgeo', rb);
    expect(r.bridgeHint.candidateUrl).toContain('bridge=InstagramBridge');
    expect(r.bridgeHint.candidateUrl).toContain('u=natgeo');
  });

  test('x handle → TwitterBridge By username context', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://x.com/jack', rb);
    expect(r.bridgeHint.candidateUrl).toContain('bridge=TwitterBridge');
    expect(r.bridgeHint.candidateUrl).toContain('u=jack');
  });

  test('tiktok @handle → TikTokBridge By user context with username=', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.tiktok.com/@charlidamelio', rb);
    expect(r.bridgeHint.candidateUrl).toContain('bridge=TikTokBridge');
    expect(r.bridgeHint.candidateUrl).toContain('username=charlidamelio');
  });

  test('default kind (no bridgeKind) keeps RSSHub path routes', async ({ page }) => {
    await page.goto('/');
    const r = await resolveIn(page, 'https://www.facebook.com/nasa', {
      bridgeBase: 'https://my-rsshub.example.com',
    });
    expect(r.bridgeHint.candidateUrl).toBe('https://my-rsshub.example.com/facebook/page/nasa');
  });
});
