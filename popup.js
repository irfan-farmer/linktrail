import { browser } from './browser.js';
import { loadConfig, saveConfig } from './config.js';
import { toSortedList } from './links.js';
import { isWebUrl } from './privacy.js';
import { readLinks } from './storage.js';
import { clearAllData, confirmTwice } from './ui.js';

const info = document.getElementById('info');
const search = document.getElementById('search');
const results = document.getElementById('results');
const recording = document.getElementById('recording');

let index = [];

function emptyRow(text) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}

function render() {
  const q = search.value.trim().toLowerCase();
  const matches = q
    ? index.filter(l => (l.title || '').toLowerCase().includes(q) || l.url.toLowerCase().includes(q))
    : index.slice(0, 50);

  results.replaceChildren();
  if (!matches.length) {
    results.append(emptyRow(index.length ? 'No matching links.' : 'Nothing saved yet.'));
    return;
  }

  for (const link of matches.slice(0, 200)) {
    const li = document.createElement('li');
    li.title = link.url;

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = link.title || link.url;

    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = link.url;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `last seen ${new Date(link.lastSeen).toLocaleString()}`;

    li.append(title, url, meta);
    li.addEventListener('click', () => {
      if (isWebUrl(link.url)) browser.tabs.create({ url: link.url });
    });
    results.append(li);
  }
}

function showInfo() {
  info.textContent = index.length
    ? `${index.length} saved links · last updated ${new Date(index[0].lastSeen).toLocaleString()}`
    : 'Nothing saved yet.';
}

async function init() {
  const [links, config] = await Promise.all([readLinks(), loadConfig()]);
  index = toSortedList(links);

  recording.checked = config.captureEnabled;
  recording.addEventListener('change', () => saveConfig({ captureEnabled: recording.checked }));

  showInfo();
  render();
  search.addEventListener('input', render);
}

// Export runs in the popup (a normal DOM page) because URL.createObjectURL is
// not available in the MV3 service worker.
document.getElementById('export').addEventListener('click', async () => {
  const data = toSortedList(await readLinks()).map(l => ({
    url: l.url,
    title: l.title,
    firstSeen: new Date(l.firstSeen).toISOString(),
    lastSeen: new Date(l.lastSeen).toISOString()
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `linktrail-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById('settings').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

confirmTwice(document.getElementById('clear'), async () => {
  await clearAllData();
  index = [];
  showInfo();
  render();
});

init();
