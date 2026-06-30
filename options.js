import { DEFAULT_CONFIG, loadConfig, saveConfig } from './config.js';

const fields = ['snapshotMinutes', 'maxEntries', 'captureEvents', 'eventDebounceMs'];
const status = document.getElementById('status');

function readForm() {
  return {
    snapshotMinutes: Number(document.getElementById('snapshotMinutes').value),
    maxEntries: Number(document.getElementById('maxEntries').value),
    captureEvents: document.getElementById('captureEvents').checked,
    eventDebounceMs: Number(document.getElementById('eventDebounceMs').value)
  };
}

function writeForm(config) {
  for (const key of fields) {
    const el = document.getElementById(key);
    if (el.type === 'checkbox') el.checked = config[key];
    else el.value = config[key];
  }
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
}

init();
