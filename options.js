import { DEFAULT_CONFIG, loadConfig, saveConfig } from './config.js';
import { clearJournal } from './storage.js';

const status = document.getElementById('status');

function readForm() {
  return {
    captureEnabled: document.getElementById('captureEnabled').checked,
    captureEvents: document.getElementById('captureEvents').checked,
    snapshotMinutes: Number(document.getElementById('snapshotMinutes').value),
    eventDebounceMs: Number(document.getElementById('eventDebounceMs').value),
    maxEntries: Number(document.getElementById('maxEntries').value),
    storeFullUrl: document.getElementById('storeFullUrl').checked,
    excludedDomains: document.getElementById('excludedDomains').value
      .split('\n').map(s => s.trim()).filter(Boolean)
  };
}

function writeForm(config) {
  document.getElementById('captureEnabled').checked = config.captureEnabled;
  document.getElementById('captureEvents').checked = config.captureEvents;
  document.getElementById('snapshotMinutes').value = config.snapshotMinutes;
  document.getElementById('eventDebounceMs').value = config.eventDebounceMs;
  document.getElementById('maxEntries').value = config.maxEntries;
  document.getElementById('storeFullUrl').checked = config.storeFullUrl;
  document.getElementById('excludedDomains').value = config.excludedDomains.join('\n');
}

function flash(message) {
  status.textContent = message;
  setTimeout(() => { status.textContent = ''; }, 1500);
}

async function init() {
  writeForm(await loadConfig());

  document.getElementById('save').addEventListener('click', async () => {
    await saveConfig(readForm());
    flash('Saved.');
  });

  document.getElementById('reset').addEventListener('click', async () => {
    writeForm(await saveConfig({ ...DEFAULT_CONFIG }));
    flash('Reset to defaults.');
  });

  document.getElementById('clear').addEventListener('click', async () => {
    if (!confirm('Permanently delete all journal data from this device?')) return;
    await clearJournal();
    flash('All journal data deleted.');
  });
}

init();
