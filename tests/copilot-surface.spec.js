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
});
