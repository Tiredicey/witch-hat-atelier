// copilot-surface.spec.js — ROADMAP §18.3 (the summoned, whole-day copilot).
//
// Unit-tests CopilotSurface with a fake intel/reader and an injected fetch,
// so the grounded Q&A is deterministic without Settings or the network.
// Verifies:
//   - with no article open, the copilot grounds in the unread digest and
//     answers (covers the whole day's unread, not just the open article)
//   - the conversation history survives a change in unread count during the
//     day (the bug: scope id keyed on unread.length wiped history mid-day)

import { test, expect } from '@playwright/test';

async function setup(page) {
  return page.evaluate(async () => {
    const { CopilotSurface } = await import('/js/intelligence/copilot-surface.js');
    const { GROQ_PROVIDER } = await import('/js/intelligence/groq.js');
    const { ackDisclosure } = await import('/js/intelligence/index.js');

    document.body.innerHTML = `
      <div id="copilot" hidden>
        <span id="scope"></span>
        <form id="form"><input id="input"><button id="send" type="submit">Send</button></form>
        <div id="disc" hidden><span id="discText"></span><button id="confirm"></button><button id="cancel"></button></div>
        <button id="toggle"></button>
        <div id="log" hidden></div>
      </div>`;

    const all = [
      { id: 'u1', title: 'Atom 1.1 draft lands', source: 'mnot', body: ['A new draft.'] },
      { id: 'u2', title: 'WebSub adoption rises', source: 'w3c', body: ['More hubs.'] },
      { id: 'u3', title: 'OPML import tips', source: 'coda', body: ['Triage dead feeds.'] },
    ];
    let unreadCount = 3;

    const sent = [];
    let n = 0;
    const fetchImpl = async (url, init) => {
      sent.push(JSON.parse(init.body));
      n += 1;
      return {
        ok: true, status: 200,
        json: async () => ({ model: 'llama-3.3-70b-versatile', choices: [{ message: { role: 'assistant', content: `ANSWER ${n}` } }] }),
        text: async () => '',
      };
    };

    const intel = {
      isEnabled: () => true,
      isSurfaceEnabled: () => true,
      getProviderKey: () => 'gsk_test',
      subscribe: () => {},
    };

    const copilot = new CopilotSurface({
      intelligence: intel,
      reader: { currentArticle: null },
      providers: [GROQ_PROVIDER],
      getUnread: () => all.slice(0, unreadCount),
      getShelf: () => 'standards',
      fetchImpl,
      wrapEl: document.getElementById('copilot'),
      scopeEl: document.getElementById('scope'),
      formEl: document.getElementById('form'),
      inputEl: document.getElementById('input'),
      sendBtn: document.getElementById('send'),
      statusEl: document.createElement('span'),
      logEl: document.getElementById('log'),
      toggleBtn: document.getElementById('toggle'),
      disclosureEl: document.getElementById('disc'),
      disclosureTextEl: document.getElementById('discText'),
      confirmBtn: document.getElementById('confirm'),
      cancelBtn: document.getElementById('cancel'),
    });
    ackDisclosure(GROQ_PROVIDER.hostname);
    copilot.open();

    const ask = async (q) => {
      document.getElementById('input').value = q;
      document.getElementById('form').dispatchEvent(new Event('submit', { cancelable: true }));
      for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 10));
        if (sent.length && document.querySelectorAll('#log .copilot__a').length >= sent.length) break;
      }
    };

    const scopeLabel = document.getElementById('scope').textContent;
    await ask('What is new today?');
    unreadCount = 2; // the reader marks one item read during the day
    await ask('Summarise the first one.');

    const answers = Array.from(document.querySelectorAll('#log .copilot__a')).map(p => p.textContent);
    return { scopeLabel, sent, answers };
  });
}

test.describe('copilot whole-day Q&A (§18.3)', () => {
  test('grounds in the unread digest and keeps history across an unread-count change', async ({ page }) => {
    await page.goto('/');
    const { scopeLabel, sent, answers } = await setup(page);

    // Grounded in the unread digest, not a single open article.
    expect(scopeLabel).toContain('unread');
    expect(answers).toEqual(['ANSWER 1', 'ANSWER 2']);

    // First request carries the unread digest as the grounding block.
    const firstUserBlock = sent[0].messages.map(m => m.content).join('\n');
    expect(firstUserBlock).toContain('Atom 1.1 draft lands');
    expect(firstUserBlock).toContain('What is new today?');

    // Second request (after unread count changed 3 -> 2) still carries the
    // first turn: history was NOT wiped. With the old count-keyed scope id it
    // would have reset.
    const secondMessages = sent[1].messages;
    const joined = secondMessages.map(m => `${m.role}:${m.content}`).join('\n');
    expect(joined).toContain('What is new today?');
    expect(joined).toContain('ANSWER 1');
    expect(joined).toContain('Summarise the first one.');
  });

  test('the general toggle overrides an open article to ground in the unread feed', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const { CopilotSurface } = await import('/js/intelligence/copilot-surface.js');
      const { GROQ_PROVIDER } = await import('/js/intelligence/groq.js');
      const { ackDisclosure } = await import('/js/intelligence/index.js');
      document.body.innerHTML = `<div id="c" hidden><span id="scope"></span>
        <input type="checkbox" id="gen">
        <form id="f"><input id="i"><button id="s" type="submit">x</button></form>
        <div id="d" hidden><span id="dt"></span><button id="ok"></button><button id="no"></button></div>
        <button id="t"></button><div id="l" hidden></div></div>`;
      const sent = [];
      const fetchImpl = async (u, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ model: 'm', choices: [{ message: { content: 'A' } }] }), text: async () => '' }; };
      const intel = { isEnabled: () => true, isSurfaceEnabled: () => true, getProviderKey: () => 'k', subscribe: () => {} };
      const cop = new CopilotSurface({
        intelligence: intel,
        reader: { currentArticle: { id: 'art1', title: 'Open piece', source: 'src', body: ['Article body only.'] } },
        providers: [GROQ_PROVIDER],
        getUnread: () => [{ id: 'u1', title: 'Unread A', source: 'mnot', body: ['x'] }, { id: 'u2', title: 'Unread B', source: 'w3c', body: ['y'] }],
        getShelf: () => 'all', fetchImpl,
        wrapEl: document.getElementById('c'), scopeEl: document.getElementById('scope'), scopeToggleEl: document.getElementById('gen'),
        formEl: document.getElementById('f'), inputEl: document.getElementById('i'), sendBtn: document.getElementById('s'),
        statusEl: document.createElement('span'), logEl: document.getElementById('l'), toggleBtn: document.getElementById('t'),
        disclosureEl: document.getElementById('d'), disclosureTextEl: document.getElementById('dt'),
        confirmBtn: document.getElementById('ok'), cancelBtn: document.getElementById('no'),
      });
      ackDisclosure(GROQ_PROVIDER.hostname);
      cop.open();
      const labelArticle = document.getElementById('scope').textContent;
      document.getElementById('gen').checked = true;
      document.getElementById('gen').dispatchEvent(new Event('change'));
      const labelGeneral = document.getElementById('scope').textContent;
      document.getElementById('i').value = 'brief me';
      document.getElementById('f').dispatchEvent(new Event('submit', { cancelable: true }));
      for (let k = 0; k < 50; k++) { await new Promise(r => setTimeout(r, 10)); if (sent.length) break; }
      const body = sent[0].messages.map(m => m.content).join('\n');
      return { labelArticle, labelGeneral, body };
    });
    expect(r.labelArticle).toContain('this article');
    expect(r.labelGeneral).toContain('unread');
    expect(r.body).toContain('Unread A');
    expect(r.body).not.toContain('Article body only.');
  });

  test('the unread digest covers far more than 20 items, bounded by a budget', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const { CopilotSurface } = await import('/js/intelligence/copilot-surface.js');
      const { GROQ_PROVIDER } = await import('/js/intelligence/groq.js');
      const { ackDisclosure } = await import('/js/intelligence/index.js');
      document.body.innerHTML = `<div id="c2" hidden><span id="scope2"></span>
        <form id="f2"><input id="i2"><button id="s2" type="submit">x</button></form>
        <div id="d2" hidden><span id="dt2"></span><button id="ok2"></button><button id="no2"></button></div>
        <button id="t2"></button><div id="l2" hidden></div></div>`;
      const big = [];
      for (let n = 1; n <= 500; n++) big.push({ id: 'b' + n, title: 'Headline number ' + n + ' about the world today', source: 'src' + (n % 5), body: ['A reasonably long excerpt describing item ' + n + ' with enough words to consume budget space in the digest here.'] });
      const sent = [];
      const fetchImpl = async (u, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ model: 'm', choices: [{ message: { content: 'A' } }] }), text: async () => '' }; };
      const intel = { isEnabled: () => true, isSurfaceEnabled: () => true, getProviderKey: () => 'k', subscribe: () => {} };
      const cop = new CopilotSurface({
        intelligence: intel, reader: { currentArticle: null }, providers: [GROQ_PROVIDER],
        getUnread: () => big, getShelf: () => 'all', fetchImpl,
        wrapEl: document.getElementById('c2'), scopeEl: document.getElementById('scope2'),
        formEl: document.getElementById('f2'), inputEl: document.getElementById('i2'), sendBtn: document.getElementById('s2'),
        statusEl: document.createElement('span'), logEl: document.getElementById('l2'), toggleBtn: document.getElementById('t2'),
        disclosureEl: document.getElementById('d2'), disclosureTextEl: document.getElementById('dt2'),
        confirmBtn: document.getElementById('ok2'), cancelBtn: document.getElementById('no2'),
      });
      ackDisclosure(GROQ_PROVIDER.hostname);
      cop.open();
      document.getElementById('i2').value = 'overview';
      document.getElementById('f2').dispatchEvent(new Event('submit', { cancelable: true }));
      for (let k = 0; k < 50; k++) { await new Promise(r => setTimeout(r, 10)); if (sent.length) break; }
      const digest = sent[0].messages.map(m => m.content).join('\n');
      return { numbered: (digest.match(/^\d+\. /gm) || []).length, hasMore: /more unread not shown/.test(digest), label: document.getElementById('scope2').textContent };
    });
    expect(r.numbered).toBeGreaterThan(20);
    expect(r.hasMore).toBe(true);
    expect(r.label).toContain('of 500 unread');
  });

  test('fillQuestion places dictated text in the input for manual send (never auto-sends)', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const { CopilotSurface } = await import('/js/intelligence/copilot-surface.js');
      const { GROQ_PROVIDER } = await import('/js/intelligence/groq.js');
      document.body.innerHTML = `<div id="c3" hidden><span id="scope3"></span>
        <form id="f3"><input id="i3"><button id="s3" type="submit">x</button></form>
        <div id="d3" hidden><span id="dt3"></span><button id="ok3"></button><button id="no3"></button></div>
        <button id="t3"></button><div id="l3" hidden></div></div>`;
      let sends = 0;
      const fetchImpl = async () => { sends += 1; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'A' } }] }), text: async () => '' }; };
      const intel = { isEnabled: () => true, isSurfaceEnabled: () => true, getProviderKey: () => 'k', subscribe: () => {} };
      const cop = new CopilotSurface({
        intelligence: intel, reader: { currentArticle: null }, providers: [GROQ_PROVIDER],
        getUnread: () => [{ id: 'u', title: 'U', source: 's', body: ['x'] }], getShelf: () => 'all', fetchImpl,
        wrapEl: document.getElementById('c3'), scopeEl: document.getElementById('scope3'),
        formEl: document.getElementById('f3'), inputEl: document.getElementById('i3'), sendBtn: document.getElementById('s3'),
        statusEl: document.createElement('span'), logEl: document.getElementById('l3'), toggleBtn: document.getElementById('t3'),
        disclosureEl: document.getElementById('d3'), disclosureTextEl: document.getElementById('dt3'),
        confirmBtn: document.getElementById('ok3'), cancelBtn: document.getElementById('no3'),
      });
      const ret = cop.fillQuestion('what happened in the world today');
      await new Promise(r => setTimeout(r, 30));
      return { ret, value: document.getElementById('i3').value, open: !document.getElementById('c3').hidden, sends };
    });
    expect(r.ret).toBe(true);
    expect(r.value).toBe('what happened in the world today');
    expect(r.open).toBe(true);
    expect(r.sends).toBe(0);
  });
});
