// Centralized, overridable configuration (12-factor III: config in the
// environment). Defaults live here; users override them from the options page,
// and overrides are persisted in storage under CONFIG_KEY.
//
// Every value passes through normalizeConfig() on both load and save, so a
// blank field, a typo, or a tampered storage value can never put the extension
// into a broken or data-destroying state.

import { browser } from './browser.js';
import { normalizeDomains } from './privacy.js';

export const CONFIG_KEY = 'tab_journal_config';

// [min, max] for numeric settings.
export const LIMITS = Object.freeze({
  snapshotMinutes: [1, 1440],
  eventDelayMs: [0, 20000], // stays well under the ~30s MV3 worker idle timeout
  maxLinks: [100, 50000]
});

export const DEFAULT_CONFIG = Object.freeze({
  // capture
  captureEnabled: true,  // master on/off switch (the popup "Recording" toggle)
  captureEvents: true,   // also record when a tab navigates, not just on the timer
  snapshotMinutes: 5,    // periodic heartbeat interval
  eventDelayMs: 2000,    // wait this long after tab activity, then record once

  // retention
  maxLinks: 5000,        // oldest-seen links are evicted past this cap

  // privacy
  storeFullUrl: false,   // false = keep origin+path only (strip query/fragment)
  storeTitles: true,     // false = never store page titles
  excludedDomains: []    // hosts never journaled (subdomains included)
});

function clampInt(value, [min, max], fallback) {
  if (value === '' || value === null || typeof value === 'boolean') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/** Coerce any input into a complete, valid config. Unknown keys are dropped. */
export function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_CONFIG;
  return {
    captureEnabled: bool(r.captureEnabled, d.captureEnabled),
    captureEvents: bool(r.captureEvents, d.captureEvents),
    snapshotMinutes: clampInt(r.snapshotMinutes, LIMITS.snapshotMinutes, d.snapshotMinutes),
    eventDelayMs: clampInt(r.eventDelayMs, LIMITS.eventDelayMs, d.eventDelayMs),
    maxLinks: clampInt(r.maxLinks, LIMITS.maxLinks, d.maxLinks),
    storeFullUrl: bool(r.storeFullUrl, d.storeFullUrl),
    storeTitles: bool(r.storeTitles, d.storeTitles),
    excludedDomains: Array.isArray(r.excludedDomains)
      ? normalizeDomains(r.excludedDomains).valid
      : []
  };
}

export async function loadConfig() {
  const result = await browser.storage.local.get(CONFIG_KEY);
  return normalizeConfig(result[CONFIG_KEY]);
}

export async function saveConfig(partial) {
  const next = normalizeConfig({ ...(await loadConfig()), ...partial });
  await browser.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}
