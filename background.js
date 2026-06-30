import { appendEntry, snapshotSignature } from './storage.js';
import { loadConfig, CONFIG_KEY } from './config.js';

const ALARM_NAME = 'snapshot';

function timestamp() {
  return new Date().toISOString();
}

// Signature of the last persisted snapshot, used to skip duplicate writes.
let lastSignature = null;

async function snapshotTabs(reason = 'periodic') {
  try {
    const config = await loadConfig();
    const tabs = await chrome.tabs.query({});
    const windows = {};

    for (const tab of tabs) {
      if (!windows[tab.windowId]) windows[tab.windowId] = [];
      windows[tab.windowId].push({
        index: tab.index,
        url: tab.url || null,
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
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: snapshotMinutes });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  snapshotTabs('install');
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  snapshotTabs('startup');
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) snapshotTabs('alarm');
});

// Re-create the alarm whenever the interval changes in the options page.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[CONFIG_KEY]) ensureAlarm();
});

// --- event capture (debounced) ----------------------------------

let eventTimer = null;
let pendingReason = null;

async function scheduleEventSnapshot(reason) {
  const { captureEvents, eventDebounceMs } = await loadConfig();
  if (!captureEvents) return;

  pendingReason = reason;
  if (eventTimer) clearTimeout(eventTimer);
  eventTimer = setTimeout(() => {
    eventTimer = null;
    const r = pendingReason || reason;
    pendingReason = null;
    snapshotTabs(r);
  }, eventDebounceMs);
}

chrome.tabs.onCreated.addListener(() => scheduleEventSnapshot('tab-created'));
chrome.tabs.onRemoved.addListener(() => scheduleEventSnapshot('tab-removed'));
chrome.tabs.onUpdated.addListener((_, changeInfo) => {
  if (changeInfo.url || changeInfo.title) scheduleEventSnapshot('tab-updated');
});
