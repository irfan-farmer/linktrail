import { browser } from './browser.js';
import { CONFIG_KEY, DEFAULT_CONFIG, LIMITS, loadConfig, normalizeConfig, saveConfig } from './config.js';
import { normalizeDomains } from './privacy.js';
import { clearAllData, confirmTwice } from './ui.js';

const $ = id => document.getElementById(id);
const CHECKBOXES = ['captureEnabled', 'captureEvents', 'storeFullUrl', 'storeTitles'];
const NUMBERS = ['snapshotMinutes', 'eventDelayMs', 'maxLinks'];
const FIELDS = [...CHECKBOXES, ...NUMBERS, 'excludedDomains'];

// The stored config the form was last filled from. A field whose value differs
// from it has been edited by the user. Saving writes only edited fields, so a
// change made elsewhere meanwhile (e.g. pausing from the popup) isn't undone.
let shown = null;
let statusTimer = null;

function flash(message, ms = 2000) {
  $('status').textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('status').textContent = ''; }, ms);
}

function formValue(key) {
  return CHECKBOXES.includes(key) ? $(key).checked : $(key).value;
}

function displayValue(config, key) {
  if (CHECKBOXES.includes(key)) return config[key];
  if (key === 'excludedDomains') return config.excludedDomains.join('\n');
  return String(config[key]);
}

function setField(key, config) {
  const value = displayValue(config, key);
  if (CHECKBOXES.includes(key)) $(key).checked = value;
  else $(key).value = value;
}

const isEdited = key => formValue(key) !== displayValue(shown, key);

function fill(config) {
  for (const key of FIELDS) setField(key, config);
  shown = config;
}

function editedFields() {
  const patch = {};
  for (const key of FIELDS.filter(isEdited)) {
    patch[key] = key === 'excludedDomains' ? formValue(key).split('\n') : formValue(key);
  }
  return patch;
}

async function init() {
  $('version').textContent = `v${browser.runtime.getManifest().version}`;
  for (const key of NUMBERS) [$(key).min, $(key).max] = LIMITS[key];
  fill(await loadConfig());

  // Keep untouched fields in sync with changes made elsewhere.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[CONFIG_KEY]) return;
    const next = normalizeConfig(changes[CONFIG_KEY].newValue);
    for (const key of FIELDS) if (!isEdited(key)) setField(key, next);
    shown = next;
  });

  $('save').addEventListener('click', async () => {
    const patch = editedFields();
    const invalid = patch.excludedDomains ? normalizeDomains(patch.excludedDomains).invalid : [];
    fill(await saveConfig(patch)); // show the values actually stored
    if (invalid.length) flash(`Saved. Ignored invalid entries: ${invalid.join(', ')}`, 6000);
    else flash('Saved.');
  });

  $('reset').addEventListener('click', async () => {
    fill(await saveConfig(DEFAULT_CONFIG));
    flash('Reset to defaults.');
  });

  confirmTwice($('clear'), async () => {
    await clearAllData();
    flash('All saved links deleted. Tabs you still have open won’t be saved again unless you navigate to a new page in them.', 8000);
  });
}

init();
