export const STORAGE_KEY = 'tab_journal';

// Default cap; the effective value is read from config at runtime so it can be
// overridden from the options page (12-factor: config in the environment).
export const MAX_ENTRIES = 1500;

export async function loadJournal() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
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
export function appendEntry(entry, maxEntries = MAX_ENTRIES) {
  writeChain = writeChain.then(async () => {
    const journal = await loadJournal();
    journal.push(entry);
    while (journal.length > maxEntries) journal.shift();
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: journal });
    } catch (err) {
      // Most likely a quota error. Drop the oldest 10% and retry once so we
      // degrade gracefully instead of losing the new entry entirely.
      console.error('TabJournal save error, trimming and retrying:', err);
      journal.splice(0, Math.ceil(journal.length * 0.1) || 1);
      await chrome.storage.local.set({ [STORAGE_KEY]: journal });
    }
  }).catch(err => {
    console.error('TabJournal write error:', err);
  });
  return writeChain;
}

/**
 * Stable signature of a snapshot's tab state (ignores volatile fields like
 * `active`/`id`), used to skip writing snapshots identical to the previous one.
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
