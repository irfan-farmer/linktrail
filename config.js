// Centralized, overridable configuration (12-factor III: config in the
// environment). Defaults live here; users can override them from the options
// page, and overrides are persisted in chrome.storage.local under CONFIG_KEY.

export const CONFIG_KEY = 'tab_journal_config';

export const DEFAULT_CONFIG = {
  snapshotMinutes: 5,    // periodic snapshot interval
  maxEntries: 1500,      // journal cap before oldest entries are trimmed
  captureEvents: true,   // snapshot on tab create/remove/update (debounced)
  eventDebounceMs: 2000  // collapse bursts of tab events into one snapshot
};

export async function loadConfig() {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(result[CONFIG_KEY] || {}) };
}

export async function saveConfig(partial) {
  const current = await loadConfig();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}
