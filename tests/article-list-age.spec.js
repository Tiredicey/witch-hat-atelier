// article-list-age.spec.js
// Live age labels: rows with a published timestamp render a freshly computed
// relative age (not a frozen string), and rows without one fall back to the
// static age field.

import { test, expect } from '@playwright/test';

test.describe('article list: live age', () => {
  test('published items get a live age + data-published; others keep static age', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const { ArticleList } = await import('/js/article-list.js');
      document.body.innerHTML = '<div id="list" class="list"><div id="rows" class="list__scroll"></div></div>';
      const now = Date.now();
      const items = [
        { id: 'live', source: 's', published: now - 2 * 3_600_000, age: 'STALE', read: false, title: 'Live', excerpt: 'x', body: ['x'] },
        { id: 'static', source: 's', age: 'imported', read: false, title: 'Static', excerpt: 'y', body: ['y'] },
      ];
      new ArticleList({
        listEl: document.getElementById('list'),
        rowsEl: document.getElementById('rows'),
        items,
        onSelect: () => {},
        onTrash: () => {},
      });
      const ageOf = (id) => document.querySelector(`.article-row[data-id="${id}"] .article-row__age`);
      const live = ageOf('live');
      const stat = ageOf('static');
      return {
        liveText: live.textContent,
        livePublished: live.dataset.published,
        staticText: stat.textContent,
        staticHasPublished: stat.hasAttribute('data-published'),
      };
    });
    expect(r.liveText).toBe('2h');
    expect(Number(r.livePublished)).toBeGreaterThan(0);
    expect(r.staticText).toBe('imported');
    expect(r.staticHasPublished).toBe(false);
  });
});
