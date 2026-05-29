// preview.spec.js
//
// Inline-preview rendering inside the article list (density="preview"):
//   - image renders with lazy loading
//   - audio enclosure renders an <audio> player
//   - YouTube/Vimeo link renders a click-to-load placeholder that becomes
//     an iframe on click
//   - text-only items render the body excerpt
//
// Setup: seed localStorage with a subscriptions.json + intercept /fetch to
// return a synthetic Atom feed whose entries cover the four cases.

import { test, expect } from '@playwright/test';

const FEED_URL = 'https://example.test/preview-feed.xml';

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Preview Sample</title>
  <link href="https://example.test/"/>
  <updated>2026-05-01T00:00:00Z</updated>
  <id>https://example.test/</id>
  <entry>
    <title>Picture post</title>
    <link href="https://example.test/pic"/>
    <id>https://example.test/pic</id>
    <published>2026-05-01T00:00:00Z</published>
    <summary>An entry with an inline image.</summary>
    <content type="html">&lt;p&gt;Body para one.&lt;/p&gt;&lt;p&gt;Body para two.&lt;/p&gt;&lt;img src="https://cdn.example.test/pic.png" alt="x"/&gt;</content>
  </entry>
  <entry>
    <title>Audio post</title>
    <link href="https://example.test/audio"/>
    <link rel="enclosure" href="https://cdn.example.test/episode.mp3" type="audio/mpeg" length="50000"/>
    <id>https://example.test/audio</id>
    <published>2026-05-01T00:00:00Z</published>
    <summary>An episode.</summary>
  </entry>
  <entry>
    <title>Video post</title>
    <link href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
    <id>https://example.test/video</id>
    <published>2026-05-01T00:00:00Z</published>
    <summary>Watch.</summary>
  </entry>
  <entry>
    <title>Text only</title>
    <link href="https://example.test/text"/>
    <id>https://example.test/text</id>
    <published>2026-05-01T00:00:00Z</published>
    <summary>Just words, nothing visual.</summary>
    <content type="html">&lt;p&gt;Long body for the preview pane: paragraph one says something.&lt;/p&gt;&lt;p&gt;Paragraph two continues the thought.&lt;/p&gt;</content>
  </entry>
</feed>`;

test.describe('article preview pane (density=preview)', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.route(`**/fetch?url=*`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
        body: ATOM,
      });
    });
    await page.goto('/');
    await page.evaluate((feedUrl) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('coda/subs/subscriptions.json', JSON.stringify({
        version: 1,
        feeds: [{ url: feedUrl, shelf: 'all', title: 'Preview Sample' }],
      }));
    }, FEED_URL);
    await page.reload();
    await expect(page.locator('.article-row').first()).toBeVisible({ timeout: 6000 });
  });

  test('Preview density button toggles the preview pane on every row', async ({ page }) => {
    const previewBtn = page.locator('.list__density button[data-density="preview"]');
    await expect(previewBtn).toBeVisible();

    const firstPreview = page.locator('.article-row .article-row__preview').first();
    await expect(firstPreview).toBeHidden();

    await previewBtn.click();
    await expect(firstPreview).toBeVisible();
    await expect(previewBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('image entry renders <img> with lazy loading and the cdn url', async ({ page }) => {
    await page.locator('.list__density button[data-density="preview"]').click();
    const img = page.locator('.article-row', { hasText: 'Picture post' })
      .locator('img.article-row__image');
    await expect(img).toBeAttached();
    await expect(img).toHaveAttribute('src', 'https://cdn.example.test/pic.png');
    await expect(img).toHaveAttribute('loading', 'lazy');
  });

  test('audio enclosure renders <audio controls preload="none">', async ({ page }) => {
    await page.locator('.list__density button[data-density="preview"]').click();
    const audio = page.locator('.article-row', { hasText: 'Audio post' })
      .locator('audio.article-row__audio');
    await expect(audio).toBeAttached();
    await expect(audio).toHaveAttribute('src', 'https://cdn.example.test/episode.mp3');
    await expect(audio).toHaveAttribute('preload', 'none');
  });

  test('YouTube entry renders a click-to-load button that swaps in an iframe', async ({ page }) => {
    await page.locator('.list__density button[data-density="preview"]').click();
    const row = page.locator('.article-row', { hasText: 'Video post' });
    const playBtn = row.locator('button.article-row__videoPlay');
    await expect(playBtn).toBeVisible();
    await expect(playBtn).toContainText('YouTube');

    const fallback = row.locator('a.article-row__videoFallback');
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await expect(fallback).toHaveAttribute('target', '_blank');

    await expect(row.locator('iframe')).toHaveCount(0);

    await playBtn.click();

    const iframe = row.locator('iframe.article-row__videoFrame');
    await expect(iframe).toBeAttached();
    const src = await iframe.getAttribute('src');
    expect(src).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');

    await expect(fallback).toBeVisible();
  });

  test('text-only entry renders the body excerpt', async ({ page }) => {
    await page.locator('.list__density button[data-density="preview"]').click();
    const row = page.locator('.article-row', { hasText: 'Text only' });
    const txt = row.locator('.article-row__previewText');
    await expect(txt).toBeVisible();
    await expect(txt).toContainText('paragraph one says something');
  });
});
