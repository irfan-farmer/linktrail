import { browser } from './browser.js';
import { evictOldest } from './journal.js';

export const LINKS_KEY = 'tab_journal_links';
export const LEGACY_KEY = 'tab_journal'; // pre-1.2 snapshot array, migrated on install/update

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
    console.warn('TabJournal: save failed, evicting oldest 10% and retrying:', err);
    evictOldest(links, Math.floor(Object.keys(links).length * 0.9));
    await browser.storage.local.set({ [LINKS_KEY]: links });
  }
}

// Every read-modify-write of the journal — snapshots, privacy scrubs, the
// legacy migration, and user-initiated deletes — runs through this queue in the
// background worker. No operation can interleave with another, so a delete can
// never be undone by a write that read the journal just before it.
let queue = Promise.resolve();

export function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch(err => console.error('TabJournal task failed:', err));
  return run;
}
