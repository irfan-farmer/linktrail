import { browser } from './browser.js';
import { loadJournal, clearJournal } from './storage.js';
import { loadConfig, saveConfig } from './config.js';

const info = document.getElementById('info');
const search = document.getElementById('search');
const results = document.getElementById('results');
const pause = document.getElementById('pause');

// Flatten every snapshot into a de-duplicated list of tabs, keyed by URL and
// keeping the most recent title/timestamp for each — a searchable index of
// every link you've had open.
function buildIndex(journal) {
  const byUrl = new Map();
  for (const entry of journal) {
    for (const windowId of Object.keys(entry.windows)) {
      for (const tab of entry.windows[windowId]) {
        if (!tab.url) continue;
        const existing = byUrl.get(tab.url);
        if (!existing || entry.ts > existing.ts) {
          byUrl.set(tab.url, { url: tab.url, title: tab.title || tab.url, ts: entry.ts });
        }
      }
    }
  }
  return [...byUrl.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

function render(index, query) {
  const q = query.trim().toLowerCase();
  const matches = q
    ? index.filter(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q))
    : index.slice(0, 50);

  results.innerHTML = '';
  if (!matches.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = index.length ? 'No matching tabs.' : 'No snapshots yet.';
    results.appendChild(li);
    return;
  }

  for (const tab of matches.slice(0, 200)) {
    const li = document.createElement('li');
    li.title = `${tab.url}\nLast seen: ${tab.ts}`;

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = tab.title;

    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = tab.url;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `last seen ${new Date(tab.ts).toLocaleString()}`;

    li.append(title, url, meta);
    li.addEventListener('click', () => browser.tabs.create({ url: tab.url }));
    results.appendChild(li);
  }
}

async function init() {
  const [journal, config] = await Promise.all([loadJournal(), loadConfig()]);
  const index = buildIndex(journal);

  pause.checked = config.captureEnabled;
  pause.addEventListener('change', () => saveConfig({ captureEnabled: pause.checked }));

  if (journal.length) {
    const last = journal[journal.length - 1];
    info.textContent =
      `${journal.length} snapshots · ${index.length} unique links · last ${new Date(last.ts).toLocaleString()}`;
  } else {
    info.textContent = 'No snapshots yet.';
  }

  render(index, '');
  search.addEventListener('input', () => render(index, search.value));
}

// Export runs in the popup (a normal DOM page) so URL.createObjectURL is
// available — unlike the MV3 service worker, where it is not.
document.getElementById('export').addEventListener('click', async () => {
  const journal = await loadJournal();
  const blob = new Blob([JSON.stringify(journal, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tabjournal-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById('settings').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm('Delete the entire tab journal from this device? This cannot be undone.')) return;
  await clearJournal();
  window.close();
});

init();
