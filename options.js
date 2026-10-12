import { DEFAULT_CONFIG, LIMITS, loadConfig, saveConfig } from './config.js';
import { normalizeDomains } from './privacy.js';
import { clearAllData, confirmTwice } from './ui.js';

const $ = id => document.getElementById(id);
const CHECKBOXES = ['captureEnabled', 'captureEvents', 'storeFullUrl', 'storeTitles'];
const NUMBERS = ['snapshotMinutes', 'eventDelayMs', 'maxLinks'];

let statusTimer = null;

function flash(message, ms = 2000) {
  $('status').textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('status').textContent = ''; }, ms);
}

// Raw form values; saveConfig() validates and clamps everything.
function readForm() {
  const form = {};
  for (const key of CHECKBOXES) form[key] = $(key).checked;
  for (const key of NUMBERS) form[key] = $(key).value;
  form.excludedDomains = $('excludedDomains').value.split('\n');
  return form;
}

function writeForm(config) {
  for (const key of CHECKBOXES) $(key).checked = config[key];
  for (const key of NUMBERS) $(key).value = config[key];
  $('excludedDomains').value = config.excludedDomains.join('\n');
}

async function init() {
  for (const key of NUMBERS) [$(key).min, $(key).max] = LIMITS[key];
  writeForm(await loadConfig());

  $('save').addEventListener('click', async () => {
    const form = readForm();
    const { invalid } = normalizeDomains(form.excludedDomains);
    writeForm(await saveConfig(form)); // show the values actually stored
    if (invalid.length) flash(`Saved. Ignored invalid entries: ${invalid.join(', ')}`, 6000);
    else flash('Saved.');
  });

  $('reset').addEventListener('click', async () => {
    writeForm(await saveConfig(DEFAULT_CONFIG));
    flash('Reset to defaults.');
  });

  confirmTwice($('clear'), async () => {
    await clearAllData();
    flash('All saved links deleted.');
  });
}

init();
