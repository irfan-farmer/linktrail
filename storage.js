import { browser } from './browser.js';
import { evictOldest } from './links.js';

export const LINKS_KEY = 'linktrail_links';

// Keys written before the rename from TabJournal. Migrated once on
// install/update (see background.js), then removed.
export const LEGACY_KEYS = Object.freeze({
  snapshots: 'tab_journal',     // 1.0–1.1: array of full tab snapshots
  links: 'tab_journal_links',   // 1.2: link map, same shape as LINKS_KEY
  config: 'tab_journal_config'  // 1.0–1.2: settings
});

export async function readLinks() {
  const { [LINKS_KEY]: links } = await browser.storage.local.get(LINKS_KEY);
  return links && typeof links === 'object' && !Array.isArray(links) ? links : {};
}

/** Persist `links`, capped at `maxLinks` (least-recently-seen evicted first). */
export async function writeLinks(links, maxLinks) {
  evictOldest(links, maxLinks);
  try {
    await browser.storage.local.set({ [LINKS_KEY]: links });
  } catch (err) {
    // Almost certainly the storage quota: evict the oldest 10% and retry once.
    console.warn('LinkTrail: save failed, evicting oldest 10% and retrying:', err);
    evictOldest(links, Math.floor(Object.keys(links).length * 0.9));
    await browser.storage.local.set({ [LINKS_KEY]: links });
  }
}

// Every read-modify-write of saved links — snapshots, privacy scrubs, the
// legacy migration, and user-initiated deletes — runs through this queue in the
// background worker. No operation can interleave with another, so a delete can
// never be undone by a write that read the links just before it.
let queue = Promise.resolve();

export function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch(err => console.error('LinkTrail task failed:', err));
  return run;
}
