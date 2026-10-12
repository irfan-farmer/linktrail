import { browser } from './browser.js';
import { CONFIG_KEY, loadConfig } from './config.js';
import { LEGACY_KEY, LINKS_KEY, enqueue, readLinks, writeLinks } from './storage.js';
import { migrateSnapshots, recordTabs, scrubLinks } from './journal.js';

const ALARM_NAME = 'snapshot';

// Each task runs inside the write queue and reads config there, so it always
// sees settings at least as fresh as any scrub queued before it. Failures are
// already logged by the queue.
const queued = task => enqueue(task).catch(() => {});

/**
 * Record the open tabs. A heartbeat always persists (it refreshes lastSeen);
 * an activity-triggered snapshot persists only when a new link appeared or a
 * title changed, so busy browsing doesn't cause needless writes.
 */
function snapshot({ heartbeat }) {
  return queued(async () => {
    const config = await loadConfig();
    if (!config.captureEnabled) return;
    const [links, tabs] = await Promise.all([readLinks(), browser.tabs.query({})]);
    const changed = recordTabs(links, tabs, config, Date.now());
    if (changed || heartbeat) await writeLinks(links, config.maxLinks);
  });
}

/** Re-apply current privacy settings to everything already stored. */
function scrub() {
  return queued(async () => {
    const config = await loadConfig();
    const { links, changed } = scrubLinks(await readLinks(), config);
    if (changed) await writeLinks(links, config.maxLinks);
  });
}

/** One-time upgrade of the pre-1.2 snapshot journal into the link map. */
function migrateLegacy() {
  return queued(async () => {
    const { [LEGACY_KEY]: legacy } = await browser.storage.local.get(LEGACY_KEY);
    if (!legacy) return;
    const config = await loadConfig();
    const { links } = scrubLinks(migrateSnapshots(legacy, await readLinks()), config);
    await writeLinks(links, config.maxLinks);
    await browser.storage.local.remove(LEGACY_KEY);
  });
}

async function ensureAlarm() {
  const { snapshotMinutes } = await loadConfig();
  const existing = await browser.alarms.get(ALARM_NAME);
  if (existing?.periodInMinutes !== snapshotMinutes) {
    await browser.alarms.create(ALARM_NAME, { periodInMinutes: snapshotMinutes });
  }
}

// --- lifecycle --------------------------------------------------

browser.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  migrateLegacy();
  scrub();
  snapshot({ heartbeat: true });
});

browser.runtime.onStartup.addListener(() => {
  ensureAlarm();
  snapshot({ heartbeat: true });
});

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) snapshot({ heartbeat: true });
});

// Settings changed (options page or popup): apply the interval, and purge any
// stored data the new privacy settings no longer allow.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[CONFIG_KEY]) return;
  ensureAlarm();
  scrub();
});

// --- tab activity (throttled) -------------------------------------

// Throttle, not debounce: the first event schedules one snapshot and later
// events ride along with it, so a page that updates constantly can't postpone
// capture indefinitely.
let eventTimer = null;

async function onTabActivity() {
  if (eventTimer) return;
  const { captureEnabled, captureEvents, eventDelayMs } = await loadConfig();
  if (!captureEnabled || !captureEvents || eventTimer) return;
  eventTimer = setTimeout(() => {
    eventTimer = null;
    snapshot({ heartbeat: false });
  }, eventDelayMs);
}

browser.tabs.onUpdated.addListener((_, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') onTabActivity();
});

// --- messages -----------------------------------------------------

// The only command: delete everything. It goes through the same queue as all
// writes, so it can't race a snapshot that's mid-flight.
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== browser.runtime.id || message?.type !== 'clear') return false;
  enqueue(() => browser.storage.local.remove([LINKS_KEY, LEGACY_KEY])).then(
    () => sendResponse({ ok: true }),
    err => sendResponse({ ok: false, error: String(err) })
  );
  return true; // keep the channel open for the async response
});
