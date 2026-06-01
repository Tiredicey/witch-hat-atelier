// reader-media.spec.js
//
// Picture and enclosure parity in the reader (right) pane, plus the client
// media detectors. Imports the Reader class and renders into a detached DOM,
// matching reader-video.spec.js (no Worker dependency).
//
//   - a.image renders a lead <img class="reader__image"> when there is no video
//   - an image entry that is also a video does NOT double up: video wins
//   - an image/* enclosure renders an <img>
//   - a video/* enclosure renders a native <video controls>
//   - an audio/* enclosure still renders <audio> (parity)
//   - detectVideo() and looksLikeImage() classify imported links

import { test, expect } from '@playwright/test';

async function render(page, article) {
  return page.evaluate(async (article) => {
    const { Reader } = await import('/js/reader.js');
    document.body.innerHTML = '<div class="reader-wrap"><div class="reader" id="reader"></div></div>';
    const wrapEl = document.querySelector('.reader-wrap');
    const readerEl = document.getElementById('reader');
    const reader = new Reader({ wrapEl, readerEl });
    reader.renderArticle(Object.assign({
      id: 'a1', title: 'Post', source: 'Src', age: '1h', read: false, body: ['Body.'],
    }, article));
    const img = readerEl.querySelector('img.reader__image');
    const vid = readerEl.querySelector('video.reader__enclosureVideo');
    const aud = readerEl.querySelector('audio.reader__audio');
    return {
      imgSrc: img ? img.getAttribute('src') : null,
      imgReferrer: img ? img.referrerPolicy : null,
      hasVideoPlayer: !!readerEl.querySelector('.reader__video'),
      encVideoSrc: vid ? vid.getAttribute('src') : null,
      encVideoControls: vid ? vid.controls : null,
      audioSrc: aud ? aud.getAttribute('src') : null,
    };
  }, article);
}

test.describe('reader pane media', () => {
  test('a.image renders a lead picture when there is no video', async ({ page }) => {
    await page.goto('/');
    const r = await render(page, { image: 'https://cdn.example.com/lead.jpg' });
    expect(r.imgSrc).toBe('https://cdn.example.com/lead.jpg');
    expect(r.imgReferrer).toBe('no-referrer');
  });

  test('a video entry suppresses the still image (video wins, no double media)', async ({ page }) => {
    await page.goto('/');
    const r = await render(page, {
      image: 'https://cdn.example.com/thumb.jpg',
      video: { provider: 'youtube', id: 'dQw4w9WgXcQ' },
    });
    expect(r.imgSrc).toBe(null);
    expect(r.hasVideoPlayer).toBe(true);
  });

  test('an image/* enclosure renders an <img>', async ({ page }) => {
    await page.goto('/');
    const r = await render(page, { enclosure: { url: 'https://cdn.example.com/p.png', type: 'image/png' } });
    expect(r.imgSrc).toBe('https://cdn.example.com/p.png');
  });

  test('a video/* enclosure renders a native <video controls>', async ({ page }) => {
    await page.goto('/');
    const r = await render(page, { enclosure: { url: 'https://cdn.example.com/clip.mp4', type: 'video/mp4' } });
    expect(r.encVideoSrc).toBe('https://cdn.example.com/clip.mp4');
    expect(r.encVideoControls).toBe(true);
  });

  test('an audio/* enclosure still renders <audio> (parity)', async ({ page }) => {
    await page.goto('/');
    const r = await render(page, { enclosure: { url: 'https://cdn.example.com/ep.mp3', type: 'audio/mpeg' } });
    expect(r.audioSrc).toBe('https://cdn.example.com/ep.mp3');
  });

  test('detectVideo classifies imported links; looksLikeImage spots image URLs', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async () => {
      const { detectVideo, looksLikeImage } = await import('/js/video-embed.js');
      return {
        yt: detectVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
        short: detectVideo('https://www.youtube.com/shorts/abcdefghijk'),
        vimeo: detectVideo('https://vimeo.com/123456789'),
        tiktok: detectVideo('https://www.tiktok.com/@scout2015/video/6718335390845095173'),
        article: detectVideo('https://www.aljazeera.com/news/story'),
        imgJpg: looksLikeImage('https://cdn.example.com/a.JPG?v=2'),
        imgNot: looksLikeImage('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      };
    });
    expect(out.yt).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(out.short).toEqual({ provider: 'youtube', id: 'abcdefghijk', short: true });
    expect(out.vimeo).toEqual({ provider: 'vimeo', id: '123456789' });
    expect(out.tiktok).toEqual({ provider: 'tiktok', id: '6718335390845095173', user: 'scout2015' });
    expect(out.article).toBe(null);
    expect(out.imgJpg).toBe(true);
    expect(out.imgNot).toBe(false);
  });
});
