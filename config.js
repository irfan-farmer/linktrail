// Centralized, overridable configuration (12-factor III: config in the
// environment). Defaults live here; users can override them from the options
// page, and overrides are persisted in storage under CONFIG_KEY.

import { browser } from './browser.js';

export const CONFIG_KEY = 'tab_journal_config';

export const DEFAULT_CONFIG = {
  // --- capture ---
  captureEnabled: true,  // master on/off switch (the popup "Pause" toggle)
  captureEvents: true,   // also snapshot on tab create/remove/update (debounced)
  snapshotMinutes: 5,    // periodic snapshot interval
  eventDebounceMs: 2000, // collapse bursts of tab events into one snapshot

  // --- retention ---
  maxEntries: 1500,      // journal cap before oldest entries are trimmed

  // --- privacy ---
  storeFullUrl: false,   // false = store origin+path only (strip query/fragment)
  excludedDomains: []    // hosts to never journal (subdomains included)
};

export async function loadConfig() {
  const result = await browser.storage.local.get(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(result[CONFIG_KEY] || {}) };
}

export async function saveConfig(partial) {
  const current = await loadConfig();
  const next = { ...current, ...partial };
  await browser.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}
