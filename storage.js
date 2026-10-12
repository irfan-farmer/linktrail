import { browser } from './browser.js';
import { oldestBeyond } from './links.js';

// Saved links are spread over a fixed set of buckets ("links:0" … "links:255"),
// each a map of url -> record, chosen by a hash of the url. Recording a page
// rewrites only its bucket (a small fraction of the history), and loading
// everything for search reads 256 entries rather than one entry per link.
const BUCKET_COUNT = 256;
const BUCKET_PREFIX = 'links:';
const ALL_BUCKETS = Array.from({ length: BUCKET_COUNT }, (_, i) => BUCKET_PREFIX + i);
const META_KEY = 'linktrail_meta';   // { count } — saved-link count, for the cap
const STATE_KEY = 'linktrail_state'; // { wasEnabled, suppressed } — see links.js planSnapshot

// Keys from older versions. Migrated once on install/update, then removed.
export const LEGACY_KEYS = Object.freeze({
  snapshots: 'tab_journal',       // TabJournal 1.0–1.1: array of tab snapshots
  links: 'tab_journal_links',     // TabJournal 1.2: link map under one key
  config: 'tab_journal_config',   // TabJournal 1.0–1.2: settings
  linkMap: 'linktrail_links'      // LinkTrail 1.3: link map under one key
});

/** The storage key of the bucket holding `url` (32-bit FNV-1a hash). */
export function bucketOf(url) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return BUCKET_PREFIX + ((hash >>> 0) % BUCKET_COUNT);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' &&
    Number.isFinite(value.firstSeen) && Number.isFinite(value.lastSeen);
}

/** Read buckets as key -> (url -> record), dropping anything malformed. */
async function readBuckets(keys) {
  const raw = await browser.storage.local.get(keys);
  const buckets = {};
  for (const key of keys) {
    const bucket = {};
    const stored = raw[key];
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      for (const [url, record] of Object.entries(stored)) if (isRecord(record)) bucket[url] = record;
    }
    buckets[key] = bucket;
  }
  return buckets;
}

/** Persist buckets; empty ones are removed. */
async function writeBuckets(buckets) {
  const set = {};
  const remove = [];
  for (const [key, bucket] of Object.entries(buckets)) {
    if (Object.keys(bucket).length) set[key] = bucket;
    else remove.push(key);
  }
  if (remove.length) await browser.storage.local.remove(remove);
  if (Object.keys(set).length) await browser.storage.local.set(set);
}

const flatten = buckets => Object.assign({}, ...Object.values(buckets));

/** Every saved link as url -> record. For search, export, and privacy scrubs. */
export async function readAllLinks() {
  return flatten(await readBuckets(ALL_BUCKETS));
}

/** Saved records for just these urls. */
export async function readLinks(urls) {
  if (!urls.length) return {};
  const all = flatten(await readBuckets([...new Set(urls.map(bucketOf))]));
  const links = {};
  for (const url of urls) if (url in all) links[url] = all[url];
  return links;
}

async function setCount(count) {
  await browser.storage.local.set({ [META_KEY]: { count } });
}

/** Remove the least-recently-seen links beyond `max`, and record the true count. */
export async function enforceCap(max) {
  const buckets = await readBuckets(ALL_BUCKETS);
  const all = flatten(buckets);
  const evict = oldestBeyond(all, max);
  const touched = {};
  for (const url of evict) {
    const key = bucketOf(url);
    touched[key] ??= buckets[key];
    delete touched[key][url];
  }
  await writeBuckets(touched);
  await setCount(Object.keys(all).length - evict.length);
}

/**
 * Run a read-modify-write of buckets, recovering from a full storage quota by
 * evicting the oldest 10% of links and retrying (re-reading, so evicted links
 * are not written back).
 */
async function withQuotaRetry(write) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (err) {
      if (attempt === 5) throw err;
      console.warn('LinkTrail: save failed, evicting the oldest 10% of links and retrying:', err);
      const count = Object.keys(await readAllLinks()).length;
      await enforceCap(Math.floor(count * 0.9));
    }
  }
}

/**
 * Write new and updated records. `added` is how many are new links; when that
 * could push the total past `maxLinks`, the oldest-seen links are evicted.
 */
export async function saveLinks(records, added, maxLinks) {
  const urls = Object.keys(records);
  if (!urls.length) return;
  await withQuotaRetry(async () => {
    const buckets = await readBuckets([...new Set(urls.map(bucketOf))]);
    for (const url of urls) buckets[bucketOf(url)][url] = records[url];
    await writeBuckets(buckets);
  });
  if (!added) return;

  const { [META_KEY]: meta } = await browser.storage.local.get(META_KEY);
  const count = Number.isInteger(meta?.count) ? meta.count + added : null;
  if (count === null || count > maxLinks) await enforceCap(maxLinks);
  else await setCount(count);
}

/** Make the stored links exactly `next` (a full url -> record map), then apply the cap. */
export async function replaceLinks(next, maxLinks) {
  await withQuotaRetry(async () => {
    const current = await readBuckets(ALL_BUCKETS);
    const wanted = Object.fromEntries(ALL_BUCKETS.map(key => [key, {}]));
    for (const [url, record] of Object.entries(next)) wanted[bucketOf(url)][url] = record;
    const changed = {};
    for (const key of ALL_BUCKETS) {
      if (JSON.stringify(current[key]) !== JSON.stringify(wanted[key])) changed[key] = wanted[key];
    }
    await writeBuckets(changed);
  });
  await enforceCap(maxLinks);
}

/** Delete every saved link (all storage formats). Settings are kept. */
export async function clearLinks() {
  await browser.storage.local.remove([
    ...ALL_BUCKETS, LEGACY_KEYS.snapshots, LEGACY_KEYS.links, LEGACY_KEYS.linkMap
  ]);
  await setCount(0);
}

export async function readState() {
  const { [STATE_KEY]: state } = await browser.storage.local.get(STATE_KEY);
  return state && typeof state === 'object' ? state : {};
}

export async function writeState(state) {
  await browser.storage.local.set({ [STATE_KEY]: state });
}

// Every read-modify-write — snapshots, privacy scrubs, the legacy migration,
// and user-initiated deletes — runs through this queue in the background
// worker. No operation can interleave with another, so a delete can never be
// undone by a write that read the links just before it.
let queue = Promise.resolve();

export function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch(err => console.error('LinkTrail task failed:', err));
  return run;
}
