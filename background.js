import { browser } from './browser.js';
import { CONFIG_KEY, loadConfig, normalizeConfig } from './config.js';
import {
  capture, mergeLinks, migrateSnapshots, planSnapshot, recordPages,
  remapSuppressed, scrubLinks, suppressAll
} from './links.js';
import {
  LEGACY_KEYS, clearLinks, enqueue, readAllLinks, readLinks, readState,
  replaceLinks, saveLinks, writeState
} from './storage.js';

const ALARM_NAME = 'snapshot';

// Every task runs inside the write queue and reads config there, so it always
// sees settings at least as fresh as any task queued before it. Failures are
// already logged by the queue.
const queued = task => enqueue(task).catch(() => {});

async function updateState(next, previous) {
  if (JSON.stringify(next) !== JSON.stringify(previous)) await writeState(next);
}

/**
 * Record the open tabs. A heartbeat always persists (it refreshes lastSeen);
 * an activity-triggered snapshot persists only when a new link appeared or a
 * title changed, so busy browsing doesn't cause needless writes.
 */
function snapshot({ heartbeat }) {
  return queued(async () => {
    const [config, state, tabs] = await Promise.all([loadConfig(), readState(), browser.tabs.query({})]);
    const plan = planSnapshot(tabs, state, config.captureEnabled);
    await updateState(plan.state, state);

    const pages = capture(plan.tabs, config);
    if (!pages.size) return;
    const existing = await readLinks([...pages.keys()]);
    const { records, added, changed } = recordPages(existing, pages, Date.now(), config);
    if (changed || heartbeat) await saveLinks(records, added, config.maxLinks);
  });
}

/** Re-apply current privacy settings to everything already stored. */
function scrub() {
  return queued(async () => {
    const config = await loadConfig();
    const { links, changed } = scrubLinks(await readAllLinks(), config);
    if (changed) await replaceLinks(links, config.maxLinks);
  });
}

/**
 * One-time upgrade of data saved by older versions: settings are carried over
 * first (so exclusions apply to the migrated links), then every older link
 * format is merged in and redacted with the current privacy settings, and the
 * old keys are removed.
 */
function migrateLegacy() {
  return queued(async () => {
    const legacyKeys = Object.values(LEGACY_KEYS);
    const old = await browser.storage.local.get(legacyKeys);
    if (!legacyKeys.some(key => key in old)) return;

    if (old[LEGACY_KEYS.config]) {
      const { [CONFIG_KEY]: current } = await browser.storage.local.get(CONFIG_KEY);
      if (!current) {
        await browser.storage.local.set({ [CONFIG_KEY]: normalizeConfig(old[LEGACY_KEYS.config]) });
      }
    }

    const config = await loadConfig();
    let merged = mergeLinks(await readAllLinks(), old[LEGACY_KEYS.linkMap]);
    merged = mergeLinks(merged, old[LEGACY_KEYS.links]);
    merged = migrateSnapshots(old[LEGACY_KEYS.snapshots], merged);
    await replaceLinks(scrubLinks(merged, config).links, config.maxLinks);
    await browser.storage.local.remove(legacyKeys);
  });
}

/** Delete every saved link. Pages still open are not re-saved until visited again. */
function clearAll() {
  return enqueue(async () => {
    const [state, tabs] = await Promise.all([readState(), browser.tabs.query({})]);
    await writeState({ ...state, suppressed: suppressAll(tabs) });
    await clearLinks();
  });
}

/** Tab ids change across browser restarts; carry suppressions over. */
function remapAfterRestart() {
  return queued(async () => {
    const [state, tabs] = await Promise.all([readState(), browser.tabs.query({})]);
    await updateState(remapSuppressed(state, tabs), state);
  });
}

/** Create the periodic alarm if it is missing or has the wrong interval. */
async function ensureAlarm() {
  try {
    const { snapshotMinutes } = await loadConfig();
    const existing = await browser.alarms.get(ALARM_NAME);
    if (existing?.periodInMinutes !== snapshotMinutes) {
      await browser.alarms.create(ALARM_NAME, { periodInMinutes: snapshotMinutes });
    }
  } catch (err) {
    console.error('LinkTrail: could not schedule snapshots:', err);
  }
}

// --- lifecycle --------------------------------------------------

// The worker starts on demand and is stopped when idle; re-check the alarm on
// every start so a lost or replaced alarm can never silently stop recording.
ensureAlarm();

browser.runtime.onInstalled.addListener(() => {
  migrateLegacy();
  scrub();
  snapshot({ heartbeat: true });
});

browser.runtime.onStartup.addListener(() => {
  remapAfterRestart();
  snapshot({ heartbeat: true });
});

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== ALARM_NAME) return;
  snapshot({ heartbeat: true });
  ensureAlarm(); // re-arm if this was a one-shot replacement
});

// Settings changed (options page or popup): apply the interval, purge stored
// data the new privacy settings no longer allow, and take a snapshot so a
// resume is handled (open tabs suppressed) before anything else is recorded.
const PRIVACY_FIELDS = ['storeFullUrl', 'storeTitles', 'excludedDomains'];

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[CONFIG_KEY]) return;
  const before = normalizeConfig(changes[CONFIG_KEY].oldValue);
  const after = normalizeConfig(changes[CONFIG_KEY].newValue);
  ensureAlarm();
  if (PRIVACY_FIELDS.some(f => JSON.stringify(before[f]) !== JSON.stringify(after[f]))) scrub();
  if (before.captureEnabled !== after.captureEnabled) snapshot({ heartbeat: false });
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
  clearAll().then(
    () => sendResponse({ ok: true }),
    err => sendResponse({ ok: false, error: String(err) })
  );
  return true; // keep the channel open for the async response
});
