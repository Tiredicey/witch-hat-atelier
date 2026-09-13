const header = document.createElement('header');
header.className = 'atelier-header';
header.id = 'atelierHeader';
header.innerHTML = `<a class="atelier-brand" href="#reader" aria-label="CODA reading desk"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21"/><path d="M10 33Q24 39 38 33L30 28 25 10 21 18 17 29Z M17 29Q24 33 30 28 M21 18 27 21"/><circle cx="24" cy="25" r="2"/></svg><span>CODA<small>the reading atelier</small></span></a><p class="atelier-motto">Gather a thought. Give it room.</p><button id="readingPrefsBtn" type="button" aria-haspopup="dialog" aria-label="Reading comfort">Reading comfort <span aria-hidden="true">Aa</span></button>`;
document.body.prepend(header);
const dialog = document.createElement('dialog');
dialog.className = 'reading-dialog';
dialog.id = 'readingPrefsDialog';
dialog.setAttribute('aria-labelledby', 'readingPrefsTitle');
dialog.innerHTML = `<form method="dialog"><button class="dialog-close" aria-label="Close reading comfort">Close</button></form><p class="smallcaps">Make yourself comfortable</p><h2 id="readingPrefsTitle">Your page, your pace.</h2><label class="preference-field" for="readingTheme">Page appearance<select id="readingTheme"><option value="auto">Follow device</option><option value="light">Parchment</option><option value="dark">Midnight ink</option></select></label><label class="preference-field" for="readingSize">Article text size<select id="readingSize"><option value="standard">Standard</option><option value="large">Large</option><option value="larger">Extra large</option></select></label><label class="preference-check"><input type="checkbox" id="readingMotion"> Reduce decorative motion</label><p class="preference-note">Your device’s reduced-motion setting takes priority. Preferences apply to this browser only.</p><p id="readingPrefsStatus" class="preference-note" role="status"></p><details class="atelier-about"><summary>About this atelier</summary><p>Original linework and a parchment-and-ink palette inspired by Witch Hat Atelier. This independent project is not an official manga service.</p><h3>Partnerships for the goals</h3><p>UN Sustainable Development Goal 17 includes knowledge sharing and partnerships. Read <a href="https://sdgs.un.org/goals/goal17#targets_and_indicators" target="_blank" rel="noopener noreferrer">targets 17.6 and 17.16 on the UN website</a>.</p><p>Use OPML export in Settings to share subscriptions. This project claims no UN affiliation, certification, or measured SDG impact.</p><a href="https://github.com/Tiredicey/witch-hat-atelier" target="_blank" rel="noopener noreferrer">View source or report an issue ↗</a></details>`;
document.body.append(dialog);
const theme = dialog.querySelector('#readingTheme');
const size = dialog.querySelector('#readingSize');
const motion = dialog.querySelector('#readingMotion');
let saved = {};
try { saved = JSON.parse(localStorage.getItem('coda/reading-comfort') || '{}') || {}; } catch {}
theme.value = ['auto', 'light', 'dark'].includes(saved.theme) ? saved.theme : 'auto';
size.value = ['standard', 'large', 'larger'].includes(saved.size) ? saved.size : 'standard';
motion.checked = saved.reduceMotion === true;
const apply = () => {
  document.documentElement.dataset.theme = theme.value;
  document.documentElement.dataset.readingSize = size.value;
  document.documentElement.dataset.motion = motion.checked ? 'reduce' : 'auto';
};
apply();
dialog.addEventListener('change', () => {
  apply();
  try {
    localStorage.setItem('coda/reading-comfort', JSON.stringify({ theme: theme.value, size: size.value, reduceMotion: motion.checked }));
    dialog.querySelector('#readingPrefsStatus').textContent = 'Preferences saved to this browser.';
  } catch { dialog.querySelector('#readingPrefsStatus').textContent = 'Applied for this visit. Your browser blocked saving preferences.'; }
});
document.getElementById('readingPrefsBtn').addEventListener('click', () => dialog.showModal());
