// feed-images.spec.js
//
// Pictures for feeds that previously showed none.
//   - the Facebook/Instagram scraper now captures the post's CDN image
//   - extractOgImage pulls og:image / twitter:image from article HTML
//   - the reader lazily fetches an og:image lead picture for feed items that
//     ship none (e.g. Al Jazeera's RSS), via /ogimage

import { test, expect } from '@playwright/test';

test.describe('feed images', () => {
  test('the Facebook scraper captures the post image from inline JSON', async ({ page }) => {
    await page.goto('/');
    const item = await page.evaluate(async () => {
      const { scrapeFeedItems } = await import('/worker/src/scrape.js');
      const html = `<!doctype html><html><body><script type="application/json">
        {"permalink":"/Kiano.Rntn/posts/pfbid02RbWnW5Nus9YzHCMockId",
         "message":"Sunset over the bay tonight, the colours were unreal",
         "image":"https://scontent.fmnl.fbcdn.net/v/t39.30808-6/abc_n.jpg?stp=dst-jpg&_nc_cat=1"}
      </script></body></html>`;
      const res = scrapeFeedItems(html, 'https://www.facebook.com/Kiano.Rntn');
      return res.items[0] || null;
    });
    expect(item).not.toBeNull();
    expect(item.link).toContain('/Kiano.Rntn/posts/pfbid02RbWnW5Nus9YzHCMockId');
    expect(item.image).toContain('fbcdn.net');
    expect(item.image).toContain('abc_n.jpg');
  });

  test('extractOgImage reads og:image, falls back to twitter:image, else empty', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async () => {
      const { extractOgImage } = await import('/worker/src/extract.js');
      return {
        og: extractOgImage('<head><meta property="og:image" content="https://ex.com/og.jpg"><title>x</title></head>'),
        tw: extractOgImage('<head><meta name="twitter:image" content="https://ex.com/tw.jpg"></head>'),
        none: extractOgImage('<head><title>no image here</title></head>'),
      };
    });
    expect(out.og).toBe('https://ex.com/og.jpg');
    expect(out.tw).toBe('https://ex.com/tw.jpg');
    expect(out.none).toBe('');
  });

  test('the reader lazily enriches an imageless item with its og:image', async ({ page }) => {
    await page.goto('/');
    const got = await page.evaluate(async () => {
      const { Reader } = await import('/js/reader.js');
      document.body.innerHTML = '<div class="reader-wrap"><div class="reader" id="reader"></div></div>';
      const calls = [];
      const reader = new Reader({
        wrapEl: document.querySelector('.reader-wrap'),
        readerEl: document.getElementById('reader'),
        fetchImpl: async (u) => {
          calls.push(u);
          return { ok: true, json: async () => ({ image: 'https://ex.com/lead.jpg' }) };
        },
      });
      reader.renderArticle({
        id: 'a1', title: 'No-image article', source: 'aljazeera.com', age: '1h',
        read: false, body: ['Body text.'], link: 'https://www.aljazeera.com/news/story',
      });
      for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 10));
        if (document.querySelector('#reader img.reader__image')) break;
      }
      const img = document.querySelector('#reader img.reader__image');
      return { calledOgimage: calls.some(u => u.includes('/ogimage?url=')), src: img ? img.getAttribute('src') : null };
    });
    expect(got.calledOgimage).toBe(true);
    expect(got.src).toBe('https://ex.com/lead.jpg');
  });

  test('the reader inserts nothing when no og:image is found', async ({ page }) => {
    await page.goto('/');
    const hasImg = await page.evaluate(async () => {
      const { Reader } = await import('/js/reader.js');
      document.body.innerHTML = '<div class="reader-wrap"><div class="reader" id="reader"></div></div>';
      const reader = new Reader({
        wrapEl: document.querySelector('.reader-wrap'),
        readerEl: document.getElementById('reader'),
        fetchImpl: async () => ({ ok: true, json: async () => ({ image: '' }) }),
      });
      reader.renderArticle({
        id: 'a2', title: 'Still no image', source: 'x', age: '1h',
        read: false, body: ['Body.'], link: 'https://www.aljazeera.com/news/two',
      });
      for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 10));
      return !!document.querySelector('#reader img.reader__image');
    });
    expect(hasImg).toBe(false);
  });
});
