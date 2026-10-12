import { browser } from './browser.js';
import { loadConfig, saveConfig } from './config.js';
import { toSortedList } from './links.js';
import { isWebUrl } from './privacy.js';
import { readAllLinks } from './storage.js';
import { clearAllData, confirmTwice } from './ui.js';

const RECENT_LIMIT = 50;   // links listed before the user searches
const MATCH_LIMIT = 200;   // search results listed at most

const $ = id => document.getElementById(id);
const search = $('search');
const results = $('results');

let index = [];

function row(className, text) {
  const li = document.createElement('li');
  li.className = className;
  li.textContent = text;
  return li;
}

function open(url) {
  if (isWebUrl(url)) browser.tabs.create({ url });
}

function resultButton(link) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'result';
  button.title = link.url;
  button.dataset.url = link.url;

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = link.title || link.url;

  const url = document.createElement('span');
  url.className = 'url';
  url.textContent = link.url;

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `last seen ${new Date(link.lastSeen).toLocaleString()}`;

  button.append(title, url, meta);
  button.addEventListener('click', () => open(link.url));
  return button;
}

function matches() {
  const q = search.value.trim().toLowerCase();
  if (!q) return { list: index.slice(0, RECENT_LIMIT), total: index.length, searching: false };
  const found = index.filter(l => (l.title || '').toLowerCase().includes(q) || l.url.toLowerCase().includes(q));
  return { list: found.slice(0, MATCH_LIMIT), total: found.length, searching: true };
}

function render() {
  const { list, total, searching } = matches();
  results.replaceChildren();
  if (!list.length) {
    results.append(row('empty', index.length ? 'No matching links.' : 'Nothing saved yet.'));
    return;
  }
  for (const link of list) {
    const li = document.createElement('li');
    li.append(resultButton(link));
    results.append(li);
  }
  if (total > list.length) {
    results.append(row('more', searching
      ? `Showing ${list.length} of ${total} matches. Refine your search to narrow them down.`
      : `Showing ${list.length} of ${total} links. Search to find older ones.`));
  }
}

function showInfo() {
  $('info').textContent = index.length
    ? `${index.length} saved link${index.length === 1 ? '' : 's'} · last updated ${new Date(index[0].lastSeen).toLocaleString()}`
    : 'Nothing saved yet.';
}

// Keyboard: Enter in the search box opens the top result; arrow keys move
// between the search box and the results.
function onKeydown(event) {
  const buttons = [...results.querySelectorAll('.result')];
  const at = buttons.indexOf(document.activeElement);
  if (event.key === 'Enter' && event.target === search) {
    if (buttons[0]) open(buttons[0].dataset.url);
    event.preventDefault();
  } else if (event.key === 'ArrowDown') {
    (buttons[at + 1] ?? buttons[at] ?? null)?.focus();
    event.preventDefault();
  } else if (event.key === 'ArrowUp' && at >= 0) {
    (at === 0 ? search : buttons[at - 1]).focus();
    event.preventDefault();
  }
}

async function init() {
  $('version').textContent = `v${browser.runtime.getManifest().version}`;
  const [links, config] = await Promise.all([readAllLinks(), loadConfig()]);
  index = toSortedList(links);

  $('recording').checked = config.captureEnabled;
  $('recording').addEventListener('change', () => saveConfig({ captureEnabled: $('recording').checked }));

  showInfo();
  render();
  search.addEventListener('input', render);
  document.addEventListener('keydown', onKeydown);
}

// Export runs in the popup (a normal DOM page) because URL.createObjectURL is
// not available in the MV3 service worker.
$('export').addEventListener('click', async () => {
  const data = toSortedList(await readAllLinks()).map(l => ({
    url: l.url,
    title: l.title,
    firstSeen: new Date(l.firstSeen).toISOString(),
    lastSeen: new Date(l.lastSeen).toISOString()
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `linktrail-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('settings').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

confirmTwice($('clear'), async () => {
  await clearAllData();
  index = [];
  showInfo();
  render();
  $('notice').textContent =
    'All saved links deleted. Tabs you still have open won’t be saved again unless you navigate to a new page in them.';
});

init();
