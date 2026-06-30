import { browser } from './browser.js';
import { appendEntry, snapshotSignature } from './storage.js';
import { loadConfig, CONFIG_KEY } from './config.js';
import { sanitizeUrl, shouldCapture } from './privacy.js';

const ALARM_NAME = 'snapshot';

function timestamp() {
  return new Date().toISOString();
}

// Signature of the last persisted snapshot, used to skip duplicate writes.
let lastSignature = null;

async function snapshotTabs(reason = 'periodic') {
  try {
    const config = await loadConfig();

    // Master switch: when paused, TabJournal records nothing at all.
    if (!config.captureEnabled) return;

    const tabs = await browser.tabs.query({});
    const windows = {};

    for (const tab of tabs) {
      // Only journal real http/https pages, never excluded domains, never
      // browser-internal/extension/file pages.
      if (!shouldCapture(tab.url, config.excludedDomains)) continue;

      if (!windows[tab.windowId]) windows[tab.windowId] = [];
      windows[tab.windowId].push({
        index: tab.index,
        url: sanitizeUrl(tab.url, config.storeFullUrl),
        title: tab.title || null,
        pinned: tab.pinned
      });
    }

    // Skip event-driven snapshots that didn't change the tab set; always keep
    // periodic/lifecycle snapshots so the journal has regular heartbeats.
    const signature = snapshotSignature(windows);
    const isEventReason = reason.startsWith('tab-');
    if (isEventReason && signature === lastSignature) return;
    lastSignature = signature;

    const entry = { ts: timestamp(), reason, windows };
    await appendEntry(entry, config.maxEntries);
  } catch (err) {
    console.error('TabJournal snapshot error:', err);
  }
}

// --- alarms -----------------------------------------------------

async function ensureAlarm() {
  const { snapshotMinutes } = await loadConfig();
  await browser.alarms.create(ALARM_NAME, { periodInMinutes: snapshotMinutes });
}

browser.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  snapshotTabs('install');
});

browser.runtime.onStartup.addListener(() => {
  ensureAlarm();
  snapshotTabs('startup');
});

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) snapshotTabs('alarm');
});

// Re-create the alarm whenever the interval changes in the options page.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[CONFIG_KEY]) ensureAlarm();
});

// --- event capture (debounced) ----------------------------------

let eventTimer = null;
let pendingReason = null;

async function scheduleEventSnapshot(reason) {
  const { captureEnabled, captureEvents, eventDebounceMs } = await loadConfig();
  if (!captureEnabled || !captureEvents) return;

  pendingReason = reason;
  if (eventTimer) clearTimeout(eventTimer);
  eventTimer = setTimeout(() => {
    eventTimer = null;
    const r = pendingReason || reason;
    pendingReason = null;
    snapshotTabs(r);
  }, eventDebounceMs);
}

browser.tabs.onCreated.addListener(() => scheduleEventSnapshot('tab-created'));
browser.tabs.onRemoved.addListener(() => scheduleEventSnapshot('tab-removed'));
browser.tabs.onUpdated.addListener((_, changeInfo) => {
  if (changeInfo.url || changeInfo.title) scheduleEventSnapshot('tab-updated');
});
