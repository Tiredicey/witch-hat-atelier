// opml-freshness.spec.js — ROADMAP §8.1 / §2 wedge 2 (quality filter at import).
//
// Automatic dormant/dead-feed detection on OPML import. Drives the real
// Subscriptions import flow with an injected fetchImpl returning a fresh, a
// dormant, a dead, and an unreachable feed, then asserts the triage screen
// pre-unchecks the dormant and dead ones, badges each, leaves the unreachable
// one checked (safe default), and reports the summary.

import { test, expect } from '@playwright/test';

const OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Mixed</title></head><body>
  <outline text="Fresh blog" title="Fresh blog" type="rss" xmlUrl="https://fresh.example/feed"/>
  <outline text="Old blog" title="Old blog" type="rss" xmlUrl="https://dormant.example/feed"/>
  <outline text="Empty blog" title="Empty blog" type="rss" xmlUrl="https://dead.example/feed"/>
  <outline text="Down blog" title="Down blog" type="rss" xmlUrl="https://err.example/feed"/>
</body></opml>`;

function atom(published) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>F</title><id>urn:f</id>
    <updated>${published}</updated>
    <entry><title>Post</title><id>urn:e1</id><link href="https://x/1"/><published>${published}</published></entry>
  </feed>`;
}
const DEAD_ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Empty</title><id>urn:d</id><updated>2026-05-01T00:00:00Z</updated></feed>`;

test.describe('OPML import dead/dormant detection (§8.1)', () => {
  test('pre-unchecks dormant and dead feeds, keeps unreachable ones checked', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async ({ opml, freshAtom, dormantAtom, deadAtom }) => {
      const { Subscriptions } = await import('/js/subscriptions.js');
      document.body.innerHTML = `
        <input type="file" id="imp">
        <p id="st"></p>
        <div id="tri" hidden><ul id="tlist"></ul><p id="tsum"></p>
          <button id="all"></button><button id="none"></button>
          <button id="commit"></button><button id="cancel"></button></div>
        <button id="exp"></button><p id="exps"></p>`;

      const resp = (body) => ({ ok: true, headers: { get: () => 'application/atom+xml' }, text: async () => body });
      const fetchImpl = async (u) => {
        if (u.includes('fresh.example')) return resp(freshAtom);
        if (u.includes('dormant.example')) return resp(dormantAtom);
        if (u.includes('dead.example')) return resp(deadAtom);
        return { ok: false, headers: { get: () => '' }, text: async () => '' };
      };

      const subs = new Subscriptions({
        importInput: document.getElementById('imp'),
        statusEl: document.getElementById('st'),
        triageEl: document.getElementById('tri'),
        triageListEl: document.getElementById('tlist'),
        triageSummaryEl: document.getElementById('tsum'),
        selectAllBtn: document.getElementById('all'),
        selectNoneBtn: document.getElementById('none'),
        commitBtn: document.getElementById('commit'),
        cancelBtn: document.getElementById('cancel'),
        exportBtn: document.getElementById('exp'),
        exportStatusEl: document.getElementById('exps'),
        adapter: { read: async () => null, write: async () => {} },
        fetchImpl,
        fetchBase: '',
        now: () => Date.parse('2026-06-01T00:00:00Z'),
      });

      const input = document.getElementById('imp');
      const dt = new DataTransfer();
      dt.items.add(new File([opml], 'feeds.opml', { type: 'text/xml' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));

      for (let i = 0; i < 80; i++) {
        await new Promise(r => setTimeout(r, 10));
        if (/Freshness check done/.test(document.getElementById('st').textContent)) break;
      }

      const read = (host) => {
        for (const item of document.querySelectorAll('#tlist .opml-triage__item')) {
          const url = item.querySelector('.opml-triage__url')?.textContent || '';
          if (url.includes(host)) {
            return {
              checked: item.querySelector('input[type="checkbox"]').checked,
              badge: item.querySelector('.opml-triage__badge')?.textContent || '',
            };
          }
        }
        return null;
      };
      return {
        fresh: read('fresh.example'),
        dormant: read('dormant.example'),
        dead: read('dead.example'),
        err: read('err.example'),
        summary: document.getElementById('tsum').textContent,
        status: document.getElementById('st').textContent,
        commit: document.getElementById('commit').textContent,
      };
    }, { opml: OPML, freshAtom: atom('2026-05-20T00:00:00Z'), dormantAtom: atom('2023-01-01T00:00:00Z'), deadAtom: DEAD_ATOM });

    expect(out.fresh.checked).toBe(true);
    expect(out.fresh.badge).toBe('active');

    expect(out.dormant.checked).toBe(false);
    expect(out.dormant.badge).toContain('dormant');

    expect(out.dead.checked).toBe(false);
    expect(out.dead.badge).toContain('dead');

    expect(out.err.checked).toBe(true);
    expect(out.err.badge).toContain("couldn't check");

    expect(out.summary).toBe('2 of 4 feed(s) selected');
    expect(out.commit).toBe('Import 2 of 4');
    expect(out.status).toContain('unchecked 2 dormant or dead');
    expect(out.status).toContain("1 couldn't be checked");
  });
});
