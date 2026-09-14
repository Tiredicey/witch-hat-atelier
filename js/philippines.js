import { PHILIPPINES_SOURCES as sources, SEARCH_TYPES, exploreUrl, safeSourceUrl } from './philippines-sources.js';

const dialog = document.createElement('dialog');
dialog.id = 'philippinesDialog';
dialog.className = 'ph-dialog';
dialog.setAttribute('aria-labelledby', 'phTitle');
dialog.innerHTML = `<form method="dialog" class="ph-close"><button aria-label="Close Philippines discovery">Close ×</button></form><header><p class="smallcaps">Eureka / Philippines / Built-in discovery</p><h1 id="phTitle" tabindex="-1">A window into the Philippines.</h1><p>Search interest and local stories. Ready without adding a feed.</p></header>
<section class="ph-tools" aria-label="Google Trends tools"><details id="phExplore"><summary>Explore searches</summary><p>Philippines · All categories. Open Google for top and rising queries, comparison charts and full category filters. These charts are not reproduced here.</p><form id="phExploreForm" action="https://trends.google.com/trends/explore" target="_blank" rel="noopener noreferrer"><input type="hidden" name="geo" value="PH"><label>Search term (optional)<input id="phTerm" name="q" type="search" maxlength="200"></label><label>Search type<select id="phType" name="gprop"></select></label><label>Time range<select id="phPeriod" name="date"><option value="now 1-d">Past day</option><option value="now 7-d">Past 7 days</option><option value="today 1-m">Past month</option><option value="today 12-m" selected>Past year</option><option value="today 5-y">Past 5 years</option></select></label><button type="submit">Open Google Trends ↗</button></form><nav id="phSearchLinks" class="ph-links" aria-label="All Google search types"></nav><a id="phQueries" target="_blank" rel="noopener noreferrer">Top &amp; rising queries on Google ↗</a></details>
<details id="phYear"><summary>Year in Search</summary><p>Annual lists are separate from today’s search interest. Browse overall trends, news and other categories on Google. Availability depends on the year and region.</p><label>Archive year<select id="phYearSelect"></select></label><div class="ph-links"><a id="phYearPH" target="_blank" rel="noopener noreferrer">Philippines archive ↗</a><a id="phYearGlobal" target="_blank" rel="noopener noreferrer">Global archive ↗</a></div></details></section>
<div class="ph-toolbar"><label>Find in loaded headlines<input id="phFilter" type="search" maxlength="200" placeholder="Filter these results"></label><button id="phRefresh" type="button">Refresh sources</button><button id="phExport" type="button" disabled>Export CSV</button></div><p class="ph-note">Source-linked discovery, not fact-checking. Search interest does not prove a claim. Publisher headlines may include opinion or satire. Check original dates and primary sources before acting.</p><div class="ph-columns"></div><footer class="ph-note">Headlines link to their publishers. No articles are invented or copied in full. Times use Asia/Manila (PHT). Sources may be cached for five minutes; retrieval times are separate from publication dates.</footer>`;
document.body.append(dialog);
const el = id => document.getElementById(id);
const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
const link = (text, url) => { const n = node('a', text); n.href = url; n.target = '_blank'; n.rel = 'noopener noreferrer'; return n; };
const formatter = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
const dated = value => value && Number.isFinite(new Date(value).getTime()) ? `${formatter.format(new Date(value))} PHT` : 'Date not supplied';
const panels = sources.slice(0, 2).map((source, i) => {
  const key = i ? 'Stories' : 'Trends';
  const section = document.createElement('section');
  section.id = `ph${key}`;
  section.setAttribute('aria-labelledby', `ph${key}Title`);
  section.innerHTML = `<p class="smallcaps">${i ? '02 / 8List.ph' : '01 / Google Trends'}</p><h2 id="ph${key}Title">${i ? 'From the local reading pile' : 'What’s drawing attention'}</h2><a id="ph${key}Source" target="_blank" rel="noopener noreferrer"></a>${i ? '<label>Choose a section<select id="phCategory"></select></label><p id="phHealth" hidden>These headlines are not medical advice. Confirm health decisions with a qualified clinician and current Philippine Department of Health guidance.</p>' : '<p>Google’s public Philippines RSS selection, in source order. Approximate traffic comes from Google, not a complete ranking or a popularity score.</p>'}<p id="ph${key}Status" role="status"></p><button id="ph${key}Retry" type="button" hidden>Retry ${source.publisher}</button><ol id="ph${key}List" class="ph-results" aria-label="${source.publisher} headlines"></ol>`;
  dialog.querySelector('.ph-columns').append(section);
  el(`ph${key}Source`).href = source.url;
  el(`ph${key}Source`).textContent = `Open ${source.publisher} ↗`;
  return { source, list: el(`ph${key}List`), status: el(`ph${key}Status`), retry: el(`ph${key}Retry`) };
});
const matches = item => item.title.toLocaleLowerCase().includes(el('phFilter').value.trim().toLocaleLowerCase());
function sync() { el('phRefresh').disabled = panels.some(p => p.loading); el('phExport').disabled = !panels.some(p => p.data?.items.some(matches)); }
function render(p) {
  p.list.replaceChildren();
  if (!p.data) { sync(); return; }
  const items = p.data.items.filter(matches);
  if (!items.length) p.list.append(node('li', 'No loaded headlines match. Try a different phrase.'));
  for (const item of items) {
    const row = document.createElement('li');
    const title = document.createElement('h3'); title.append(link(item.title, item.url));
    row.append(title, node('p', item.published ? `${p.source.kind === 'rss' ? 'RSS item dated' : 'Published'} ${dated(item.published)}` : 'Publication date not supplied'));
    if (p.source.kind === 'rss') {
      row.append(node('p', item.traffic ? `${item.traffic} · approximate traffic reported by Google` : 'Approximate traffic not supplied'));
      if (item.related?.length) {
        const details = document.createElement('details'); details.append(node('summary', `Related coverage (${item.related.length})`));
        const list = document.createElement('ul');
        for (const news of item.related) { const li = document.createElement('li'); li.append(link(news.title, news.url), node('span', news.publisher ? ` · ${news.publisher}` : '')); list.append(li); }
        details.append(list); row.append(details);
      }
    }
    p.list.append(row);
  }
  sync();
}
async function load(p) {
  p.controller?.abort();
  const controller = new AbortController(); p.controller = controller; p.loading = true; p.retry.hidden = true;
  p.status.textContent = `Fetching ${p.source.publisher}…`; p.status.removeAttribute('data-error'); p.list.setAttribute('aria-busy', 'true'); sync();
  const source = p.source;
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(`/philippines?source=${source.id}`, { signal: controller.signal });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Unavailable source');
    const data = await response.json();
    if (data.source?.id !== source.id || !Array.isArray(data.items) || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error('Invalid response');
    const items = data.items.filter(i => i && typeof i.title === 'string' && safeSourceUrl(i.url, source.kind === 'listing' ? 'https://8list.ph' : 'https://trends.google.com')).map(i => ({ ...i, related: Array.isArray(i.related) ? i.related.filter(n => n && typeof n.title === 'string' && safeSourceUrl(n.url)) : [] }));
    if (!items.length) throw new Error('Empty response');
    if (p.controller !== controller) return;
    p.data = { source, fetchedAt: data.fetchedAt, items };
    p.status.textContent = `${items.length} ${source.kind === 'rss' ? 'trends from Google RSS' : 'headlines extracted from the publisher’s listing'}. Retrieved ${dated(data.fetchedAt)}.`;
    if (Date.now() - Date.parse(data.fetchedAt) > 600000) p.status.textContent += ' Older response; check the original source for current information.';
    render(p);
  } catch {
    if (p.controller !== controller) return;
    p.status.dataset.error = 'true'; p.status.textContent = `Could not load ${source.publisher}. Retry or open the original source above.${p.data ? ` Previous results retained, retrieved ${dated(p.data.fetchedAt)}; they may be outdated.` : ' No results have been substituted.'}`; p.retry.hidden = false;
  } finally { clearTimeout(timer); if (p.controller === controller) { p.loading = false; p.list.setAttribute('aria-busy', 'false'); sync(); } }
}
let opened = false;
function open() { dialog.showModal(); el('phTitle').focus(); if (!opened) { opened = true; panels.forEach(load); } }
for (const [id, parent] of [['enterPhilippinesBtn', document.querySelector('.rail__brand')], ['dmzPhilippinesBtn', document.querySelector('.dmz__title')], ['welcomePhilippinesBtn', el('welcomeHnBtn')]]) {
  if (!parent) continue;
  const button = node('button', 'Eureka · Philippines'); button.id = id; button.type = 'button';
  if (id === 'enterPhilippinesBtn') { button.className = 'shelf'; button.innerHTML = '<svg class="sigil" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15 7-2 6-6 4 3-7Z"/></svg><span class="shelf__label">Eureka · Philippines</span>'; }
  parent.after(button); button.addEventListener('click', open);
}
el('phRefresh').addEventListener('click', () => panels.forEach(load));
panels.forEach(p => p.retry.addEventListener('click', () => load(p)));
el('phFilter').addEventListener('input', () => panels.forEach(render));
el('phFilter').addEventListener('keydown', e => { if (e.key === 'Escape' && el('phFilter').value) { e.preventDefault(); e.stopPropagation(); el('phFilter').value = ''; panels.forEach(render); } });
sources.filter(s => s.kind === 'listing').forEach(s => el('phCategory').add(new Option(s.label, s.id)));
el('phCategory').addEventListener('change', () => { const p = panels[1]; p.source = sources.find(s => s.id === el('phCategory').value); p.data = null; render(p); el('phStoriesSource').href = p.source.url; el('phStoriesSource').textContent = `Open ${p.source.label} on 8List ↗`; el('phHealth').hidden = p.source.id !== 'health'; load(p); });
SEARCH_TYPES.forEach(t => el('phType').add(new Option(t.label, t.value)));
function updateExplore() { const input = { term: el('phTerm').value, type: el('phType').value, date: el('phPeriod').value }; el('phQueries').href = exploreUrl(input); el('phSearchLinks').replaceChildren(...SEARCH_TYPES.map(t => link(`${t.label} ↗`, exploreUrl({ ...input, type: t.value })))); }
el('phExploreForm').addEventListener('input', updateExplore); updateExplore();
for (let y = new Date().getUTCFullYear() - 1; y >= 2020; y--) el('phYearSelect').add(new Option(String(y), String(y)));
function updateYear() { const y = el('phYearSelect').value; el('phYearPH').href = `https://trends.withgoogle.com/year-in-search/${y}/ph/`; el('phYearGlobal').href = `https://trends.withgoogle.com/year-in-search/${y}/`; }
el('phYearSelect').addEventListener('change', updateYear); updateYear();
el('phExport').addEventListener('click', () => {
  const rows = [['Publisher', 'Section', 'Headline', 'URL', 'Publication time (UTC)', 'Approximate traffic', 'Retrieved (UTC)']];
  for (const p of panels) for (const i of p.data?.items.filter(matches) || []) rows.push([p.source.publisher, p.source.label, i.title, i.url, i.published && Number.isFinite(new Date(i.published).getTime()) ? new Date(i.published).toISOString() : '', i.traffic || '', p.data.fetchedAt]);
  const csv = '\uFEFF' + rows.map(row => row.map(v => { const raw = String(v); const safe = /^\s*[=+@\-]/.test(raw) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw; return `"${safe.replace(/"/g, '""')}"`; }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'coda-philippines.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
