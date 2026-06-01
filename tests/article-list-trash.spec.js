// article-list-trash.spec.js — trashing straight from a feed row.
//
// The per-row trash button must fire onTrash with the item id and must NOT
// open the row (no onSelect), so a reader can trash from the list on desktop
// or mobile without first opening the article.

import { test, expect } from '@playwright/test';

const ITEMS = [
  { id: 'a1', source: 'mnot', age: '1h', read: false, title: 'First', excerpt: 'one', body: ['one'] },
  { id: 'a2', source: 'w3c', age: '2h', read: false, title: 'Second', excerpt: 'two', body: ['two'] },
];

test.describe('article list: trash from a row', () => {
  test('the row trash button fires onTrash and does not open the row', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (items) => {
      const { ArticleList } = await import('/js/article-list.js');
      document.body.innerHTML = '<div id="list" class="list"><div id="rows" class="list__scroll"></div></div>';
      const selects = [];
      const trashes = [];
      const list = new ArticleList({
        listEl: document.getElementById('list'),
        rowsEl: document.getElementById('rows'),
        items,
        onSelect: (id) => selects.push(id),
        onTrash: (id) => trashes.push(id),
      });
      void list;
      const rows = document.querySelectorAll('#rows .article-row');
      const firstTrash = rows[0].querySelector('.article-row__trash');
      const hasButtonPerRow = Array.from(rows).every(r => !!r.querySelector('.article-row__trash'));

      firstTrash.click();                 // trash the first row
      const afterTrash = { selects: selects.slice(), trashes: trashes.slice() };

      rows[1].click();                    // opening the second row still works
      return { hasButtonPerRow, afterTrash, finalSelects: selects.slice() };
    }, ITEMS);

    expect(r.hasButtonPerRow).toBe(true);
    expect(r.afterTrash.trashes).toEqual(['a1']);
    expect(r.afterTrash.selects).toEqual([]);   // trash did not open the row
    expect(r.finalSelects).toEqual(['a2']);     // a normal row click still opens
  });
});
