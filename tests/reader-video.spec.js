// reader-video.spec.js
//
// Video parity in the reader (right) pane. Driven by importing the Reader
// class directly and rendering a video article into a detached DOM, so the
// test does not depend on the Worker-backed feed pipeline (the feed-seeded
// path needs /fetch + /discover, which the static dev server does not serve).
//
//   - selecting a video entry renders a click-to-load player in the reader
//   - clicking play swaps in a youtube-nocookie iframe + a close button
//   - clicking close restores the play poster (the gap the user reported)
//   - YouTube Shorts links are framed vertically and labelled
//   - parse.js flags a Shorts URL with { short: true }

import { test, expect } from '@playwright/test';

async function renderVideoArticle(page, video) {
  return page.evaluate(async (video) => {
    const { Reader } = await import('/js/reader.js');
    document.body.innerHTML = '<div class="reader-wrap"><div class="reader" id="reader"></div></div>';
    const wrapEl = document.querySelector('.reader-wrap');
    const readerEl = document.getElementById('reader');
    const reader = new Reader({ wrapEl, readerEl });
    reader.renderArticle({
      id: 'v1', title: 'Video post', source: 'Tube', age: '1h',
      read: false, body: ['Watch.'], video,
    });

    const read = () => {
      const holder = readerEl.querySelector('.reader__video');
      return {
        hasHolder: !!holder,
        short: holder ? holder.dataset.short || null : null,
        playText: holder?.querySelector('.reader__videoPlay')?.textContent || null,
        iframeSrc: holder?.querySelector('.reader__videoFrame')?.src || null,
        hasClose: !!holder?.querySelector('.reader__videoClose'),
        fallbackHref: readerEl.querySelector('.reader__videoFallback')?.getAttribute('href') || null,
      };
    };

    const initial = read();
    readerEl.querySelector('.reader__videoPlay').click();
    const playing = read();
    readerEl.querySelector('.reader__videoClose').click();
    const closed = read();
    return { initial, playing, closed };
  }, video);
}

test.describe('reader pane video', () => {
  test('YouTube entry renders a poster, then iframe + close, then restores on close', async ({ page }) => {
    await page.goto('/');
    const { initial, playing, closed } = await renderVideoArticle(
      page, { provider: 'youtube', id: 'dQw4w9WgXcQ' });

    expect(initial.hasHolder).toBe(true);
    expect(initial.playText).toContain('YouTube');
    expect(initial.iframeSrc).toBe(null);
    expect(initial.fallbackHref).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(playing.iframeSrc).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(playing.hasClose).toBe(true);

    expect(closed.iframeSrc).toBe(null);
    expect(closed.playText).toContain('YouTube');
  });

  test('YouTube Shorts link is framed vertically and labelled', async ({ page }) => {
    await page.goto('/');
    const { initial, playing } = await renderVideoArticle(
      page, { provider: 'youtube', id: 'abcdefghijk', short: true });

    expect(initial.short).toBe('true');
    expect(initial.playText).toContain('Short');
    expect(initial.fallbackHref).toBe('https://www.youtube.com/shorts/abcdefghijk');
    expect(playing.iframeSrc).toContain('youtube-nocookie.com/embed/abcdefghijk');
  });

  test('Vimeo entry renders the Vimeo player and fallback', async ({ page }) => {
    await page.goto('/');
    const { initial, playing } = await renderVideoArticle(
      page, { provider: 'vimeo', id: '123456789' });

    expect(initial.playText).toContain('Vimeo');
    expect(initial.fallbackHref).toBe('https://vimeo.com/123456789');
    expect(playing.iframeSrc).toContain('player.vimeo.com/video/123456789');
  });

  test('TikTok entry renders the TikTok player and a username watch link', async ({ page }) => {
    await page.goto('/');
    const { initial, playing } = await renderVideoArticle(
      page, { provider: 'tiktok', id: '6718335390845095173', user: 'scout2015' });

    expect(initial.playText).toContain('TikTok');
    expect(initial.iframeSrc).toBe(null);
    expect(initial.fallbackHref).toBe('https://www.tiktok.com/@scout2015/video/6718335390845095173');

    expect(playing.iframeSrc).toContain('tiktok.com/player/v1/6718335390845095173');
    expect(playing.hasClose).toBe(true);
  });

  test('TikTok detected without a username still builds a watch link', async ({ page }) => {
    await page.goto('/');
    const { initial } = await renderVideoArticle(
      page, { provider: 'tiktok', id: '6718335390845095173' });
    expect(initial.fallbackHref).toBe('https://www.tiktok.com/@/video/6718335390845095173');
  });

  test('parse.js detects a TikTok video URL with provider, id, and user', async ({ page }) => {
    await page.goto('/');
    const video = await page.evaluate(async () => {
      const { parseFeed } = await import('/worker/src/parse.js');
      const text = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>S</title>
  <entry>
    <title>TT</title>
    <link href="https://www.tiktok.com/@scout2015/video/6718335390845095173"/>
    <id>t1</id>
    <published>2026-05-01T00:00:00Z</published>
    <summary>Watch.</summary>
  </entry>
</feed>`;
      return parseFeed(text, 'application/atom+xml').entries[0].video;
    });
    expect(video).toEqual({ provider: 'tiktok', id: '6718335390845095173', user: 'scout2015' });
  });

  test('parse.js detects a Shorts URL with the short flag', async ({ page }) => {
    await page.goto('/');
    const video = await page.evaluate(async () => {
      const { parseFeed } = await import('/worker/src/parse.js');
      const text = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>S</title>
  <entry>
    <title>Short</title>
    <link href="https://www.youtube.com/shorts/abcdefghijk"/>
    <id>s1</id>
    <published>2026-05-01T00:00:00Z</published>
    <summary>Watch.</summary>
  </entry>
</feed>`;
      return parseFeed(text, 'application/atom+xml').entries[0].video;
    });
    expect(video).toEqual({ provider: 'youtube', id: 'abcdefghijk', short: true });
  });
});
