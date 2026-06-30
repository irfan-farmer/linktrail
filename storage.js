import { browser } from './browser.js';

export const STORAGE_KEY = 'tab_journal';

export async function loadJournal() {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
}

/** Delete the entire journal (user-initiated "clear all data"). */
export async function clearJournal() {
  await browser.storage.local.remove(STORAGE_KEY);
}

// All journal mutations funnel through this promise chain so concurrent tab
// events can't read-modify-write over each other and silently drop entries.
let writeChain = Promise.resolve();

/**
 * Atomically append one entry to the journal, trim to `maxEntries`, and persist.
 * Returns a promise that resolves once this write (and everything queued before
 * it) has completed. Errors are caught so a single failed write can't break the
 * chain for subsequent appends.
 */
export function appendEntry(entry, maxEntries) {
  writeChain = writeChain.then(async () => {
    const journal = await loadJournal();
    journal.push(entry);
    while (journal.length > maxEntries) journal.shift();
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: journal });
    } catch (err) {
      // Most likely a quota error. Drop the oldest 10% and retry once so we
      // degrade gracefully instead of losing the new entry entirely.
      console.error('TabJournal save error, trimming and retrying:', err);
      journal.splice(0, Math.ceil(journal.length * 0.1) || 1);
      await browser.storage.local.set({ [STORAGE_KEY]: journal });
    }
  }).catch(err => {
    console.error('TabJournal write error:', err);
  });
  return writeChain;
}

/**
 * Stable signature of a snapshot's tab state (ignores volatile fields), used to
 * skip writing snapshots identical to the previous one.
 */
export function snapshotSignature(windows) {
  const parts = [];
  for (const id of Object.keys(windows).sort()) {
    for (const t of windows[id]) {
      parts.push(`${id}|${t.index}|${t.url || ''}|${t.pinned ? 1 : 0}`);
    }
  }
  return parts.join('\n');
}
