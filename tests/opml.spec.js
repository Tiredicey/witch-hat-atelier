// opml.spec.js — parser + serializer round-trip for js/opml.js
import { test, expect } from '@playwright/test';

const MODULE_URL = '/js/opml.js';

const SAMPLE_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>My subscriptions</title>
    <dateCreated>Wed, 01 May 2026 09:00:00 GMT</dateCreated>
  </head>
  <body>
    <outline text="Standards">
      <outline text="Mark Nottingham" title="Mark Nottingham" type="rss"
               xmlUrl="https://www.mnot.net/blog/index.atom" htmlUrl="https://www.mnot.net/blog/"/>
      <outline text="JSON Feed" title="JSON Feed" type="rss"
               xmlUrl="https://www.jsonfeed.org/feed.json"/>
    </outline>
    <outline text="Tech" type="rss"
             xmlUrl="https://hnrss.org/newest" htmlUrl="https://news.ycombinator.com/"/>
  </body>
</opml>`;

test.describe('opml.js', () => {
  test('parses an OPML document with a folder and a root feed', async ({ page }) => {
    await page.goto('/');
    const parsed = await page.evaluate(async ({ moduleUrl, text }) => {
      const mod = await import(moduleUrl);
      return mod.parseOpml(text);
    }, { moduleUrl: MODULE_URL, text: SAMPLE_OPML });

    expect(parsed.title).toBe('My subscriptions');
    expect(parsed.feeds).toHaveLength(3);

    const titles = parsed.feeds.map(f => f.title);
    expect(titles).toContain('Mark Nottingham');
    expect(titles).toContain('JSON Feed');
    expect(titles).toContain('Tech');

    const mnot = parsed.feeds.find(f => f.title === 'Mark Nottingham');
    expect(mnot.url).toBe('https://www.mnot.net/blog/index.atom');
    expect(mnot.htmlUrl).toBe('https://www.mnot.net/blog/');
    expect(mnot.shelf).toBe('Standards');

    const root = parsed.feeds.find(f => f.title === 'Tech');
    expect(root.shelf).toBe('all');  // root-level feed → "all"
  });

  test('rejects malformed XML', async ({ page }) => {
    await page.goto('/');
    const err = await page.evaluate(async ({ moduleUrl }) => {
      const mod = await import(moduleUrl);
      try { mod.parseOpml('<opml><body><outline'); return null; }
      catch (e) { return e.message; }
    }, { moduleUrl: MODULE_URL });
    expect(err).toMatch(/malformed XML|not an OPML/);

    const err2 = await page.evaluate(async ({ moduleUrl }) => {
      const mod = await import(moduleUrl);
      try { mod.parseOpml('<html><body>no opml</body></html>'); return null; }
      catch (e) { return e.message; }
    }, { moduleUrl: MODULE_URL });
    expect(err2).toContain('not an OPML');
  });

  test('serialize → parse round-trip preserves urls and shelves', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ moduleUrl }) => {
      const mod = await import(moduleUrl);
      const subs = {
        title: "Round-trip test",
        feeds: [
          { id: "a", url: "https://a.example/feed", title: "Site A",       shelf: "Tech" },
          { id: "b", url: "https://b.example/feed", title: "Site B Quote\"s & <stuff>", shelf: "Tech" },
          { id: "c", url: "https://c.example/feed", title: "Site C",       shelf: "all" },
        ],
      };
      const opml = mod.serializeOpml(subs);
      const reparsed = mod.parseOpml(opml);
      return {
        opmlIncludesXmlDecl: opml.startsWith('<?xml'),
        titles: reparsed.feeds.map(f => f.title).sort(),
        urls:   reparsed.feeds.map(f => f.url).sort(),
        shelves: reparsed.feeds.reduce((m, f) => { m[f.title] = f.shelf; return m; }, {}),
      };
    }, { moduleUrl: MODULE_URL });

    expect(result.opmlIncludesXmlDecl).toBe(true);
    expect(result.urls).toEqual([
      'https://a.example/feed',
      'https://b.example/feed',
      'https://c.example/feed',
    ]);
    // Special chars survived the XML escape round-trip
    expect(result.titles).toContain('Site B Quote"s & <stuff>');
    // shelf="all" feeds emit at root → parsed back as shelf "all"
    expect(result.shelves['Site C']).toBe('all');
    // Folder feeds preserve their shelf name
    expect(result.shelves['Site A']).toBe('Tech');
  });

  test('subscriptionsFromOpml maps to the Worker FEEDS shape', async ({ page }) => {
    await page.goto('/');
    const subs = await page.evaluate(async ({ moduleUrl, text }) => {
      const mod = await import(moduleUrl);
      const parsed = mod.parseOpml(text);
      return mod.subscriptionsFromOpml(parsed);
    }, { moduleUrl: MODULE_URL, text: SAMPLE_OPML });

    expect(subs.version).toBe(1);
    expect(subs.feeds).toHaveLength(3);
    for (const f of subs.feeds) {
      expect(typeof f.id).toBe('string');
      expect(typeof f.url).toBe('string');
      expect(typeof f.shelf).toBe('string');
    }
  });
});


test.describe('OPML triage UI — Settings form (PR #15)', () => {
  const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My subscriptions</title></head>
  <body>
    <outline text="Standards">
      <outline text="Mark Nottingham" title="Mark Nottingham" type="rss"
               xmlUrl="https://www.mnot.net/blog/index.atom" htmlUrl="https://www.mnot.net/blog/"/>
      <outline text="JSON Feed" title="JSON Feed" type="rss"
               xmlUrl="https://www.jsonfeed.org/feed.json"/>
    </outline>
    <outline text="Tech">
      <outline text="Hacker News" title="Hacker News" type="rss"
               xmlUrl="https://hnrss.org/newest"/>
      <outline text="A dormant blog" title="A dormant blog" type="rss"
               xmlUrl="https://example.com/dormant.atom"/>
    </outline>
    <outline text="Loose feed" type="rss" xmlUrl="https://example.org/loose.xml"/>
  </body>
</opml>`;

  async function gotoSettings(page) {
    await page.locator('#enterSettingsBtn').scrollIntoViewIfNeeded();
    await page.locator('#enterSettingsBtn').click();
    await expect(page.locator('#settingsPage')).toBeVisible();
  }

  async function pickOpml(page, content) {
    await page.locator('#opml-import-file').setInputFiles({
      name: 'subscriptions.opml',
      mimeType: 'application/xml',
      buffer: Buffer.from(content, 'utf-8'),
    });
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    await gotoSettings(page);
  });

  test('parsing reveals the triage panel with every feed checked by default', async ({ page }) => {
    await pickOpml(page, SAMPLE);
    await expect(page.locator('#opml-import-status')).toHaveAttribute('data-status', 'ok');
    await expect(page.locator('#opml-triage')).toBeVisible();
    const checkboxes = page.locator('#opml-triage-list input[type="checkbox"][data-feed-index]');
    await expect(checkboxes).toHaveCount(5);
    expect(await checkboxes.evaluateAll(els => els.every(el => el.checked))).toBe(true);
    await expect(page.locator('#opml-triage-summary')).toHaveText('5 of 5 feed(s) selected');
    await expect(page.locator('#opml-commit-import')).toHaveText('Import 5 of 5');
  });

  test('unchecking a feed updates the commit button + summary', async ({ page }) => {
    await pickOpml(page, SAMPLE);
    await page.locator('#opml-triage-list input[type="checkbox"]').first().uncheck();
    await expect(page.locator('#opml-triage-summary')).toHaveText('4 of 5 feed(s) selected');
    await expect(page.locator('#opml-commit-import')).toHaveText('Import 4 of 5');
  });

  test('select none disables commit; select all re-enables', async ({ page }) => {
    await pickOpml(page, SAMPLE);
    await page.locator('#opml-select-none').click();
    await expect(page.locator('#opml-triage-summary')).toHaveText('0 of 5 feed(s) selected');
    await expect(page.locator('#opml-commit-import')).toBeDisabled();
    await page.locator('#opml-select-all').click();
    await expect(page.locator('#opml-triage-summary')).toHaveText('5 of 5 feed(s) selected');
    await expect(page.locator('#opml-commit-import')).toBeEnabled();
  });

  test('commit writes only checked feeds to coda/subs/subscriptions.json', async ({ page }) => {
    await pickOpml(page, SAMPLE);
    // Uncheck the "dormant" one.
    await page.locator('#opml-triage-list input[data-feed-index]').nth(3).uncheck();
    await expect(page.locator('#opml-commit-import')).toHaveText('Import 4 of 5');
    await page.locator('#opml-commit-import').click();
    await expect(page.locator('#opml-import-status')).toContainText('Imported 4 feed');
    await expect(page.locator('#opml-import-status')).toContainText('1 unchecked feed');
    await expect(page.locator('#opml-triage')).toBeHidden();

    const raw = await page.evaluate(() => localStorage.getItem('coda/subs/subscriptions.json'));
    const subs = JSON.parse(raw);
    expect(subs.kind || subs.version).toBeDefined();
    expect(subs.feeds).toHaveLength(4);
    const urls = subs.feeds.map(f => f.url);
    expect(urls).toContain('https://www.mnot.net/blog/index.atom');
    expect(urls).toContain('https://www.jsonfeed.org/feed.json');
    expect(urls).toContain('https://hnrss.org/newest');
    expect(urls).toContain('https://example.org/loose.xml');
    expect(urls).not.toContain('https://example.com/dormant.atom');
  });

  test('cancel hides triage without writing subs', async ({ page }) => {
    await pickOpml(page, SAMPLE);
    await expect(page.locator('#opml-triage')).toBeVisible();
    await page.locator('#opml-cancel-import').click();
    await expect(page.locator('#opml-triage')).toBeHidden();
    await expect(page.locator('#opml-import-status')).toContainText('cancelled');
    const raw = await page.evaluate(() => localStorage.getItem('coda/subs/subscriptions.json'));
    expect(raw).toBeNull();
  });

  test('malformed OPML produces a fail status and no triage panel', async ({ page }) => {
    await pickOpml(page, '<html><body>nope</body></html>');
    await expect(page.locator('#opml-import-status')).toHaveAttribute('data-status', 'fail');
    await expect(page.locator('#opml-triage')).toBeHidden();
  });

  test('empty OPML body produces a fail status', async ({ page }) => {
    await pickOpml(page, '<?xml version="1.0"?><opml version="2.0"><head></head><body></body></opml>');
    await expect(page.locator('#opml-import-status')).toHaveAttribute('data-status', 'fail');
    await expect(page.locator('#opml-import-status')).toContainText('No feeds found');
  });

  test('export with no subs in storage shows a fail hint', async ({ page }) => {
    // Export controls live inside a <details> drawer — open it first.
    await page.locator('.opml-export > summary').click();
    await page.locator('#opml-export-btn').click();
    await expect(page.locator('#opml-export-status')).toHaveAttribute('data-status', 'fail');
    await expect(page.locator('#opml-export-status')).toContainText('No subscriptions stored');
  });

  test('import then export round-trips the saved subscriptions', async ({ page }) => {
    await pickOpml(page, SAMPLE);
    await page.locator('#opml-commit-import').click();
    await expect(page.locator('#opml-import-status')).toContainText('Imported 5');

    await page.locator('.opml-export > summary').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#opml-export-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('coda-subscriptions.opml');
    await expect(page.locator('#opml-export-status')).toContainText('Exported 5 feed');
  });
});
