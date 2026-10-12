# Changelog

All notable changes to LinkTrail. Versions follow the extension's
`manifest.json` version.

## 1.4.0

### Fixed
- **Deleted links came back.** After "Delete all data", every tab that was still
  open was saved again on the next check, so the "old" links reappeared and were
  exported again. Tabs open at the time of a delete are now skipped until you
  navigate in them.
- **Pause leaked pages.** Pages opened while recording was paused were saved as
  soon as recording resumed. Tabs open when you resume are now skipped the same
  way, so nothing from the paused period is saved.
- **Saving settings could undo a pause.** The options page wrote back every field,
  including a stale "Recording" value, re-enabling recording that had been paused
  from the popup. It now saves only the fields you changed and updates itself
  live when settings change elsewhere.
- **Recording could stop silently.** If the periodic alarm was lost or replaced it
  was never recreated. The worker now checks it every time it starts and after
  every alarm.
- Running out of storage space now keeps evicting the oldest links until the save
  fits, instead of giving up after one attempt.

### Changed
- **Storage is bucketed.** Links are spread over 256 storage entries by a hash of
  their address, so each save rewrites only a small fraction of the history. At
  50,000 saved links a periodic check now takes about 10 ms of work instead of
  about 3.7 s, and disk writes drop accordingly. Data from 1.3 is migrated
  automatically on update.
- The build updates `dist/` in place instead of deleting it, and reminds you to
  reload an unpacked extension.

### Added
- The popup and settings page show the installed version.
- The popup says when it lists only part of the history ("Showing 50 of N").
- Keyboard support in the popup: results are buttons, Enter in the search box
  opens the top result, and arrow keys move through the list.
- An end-to-end test suite that runs the built extension in a real browser
  (recording, delete, pause, export, settings, quota, migration, performance at
  50,000 links), plus ESLint and a GitHub Actions CI pipeline.

## 1.3.0
- Renamed TabJournal to LinkTrail; data under the old storage keys is migrated.

## 1.2.0
- One record per link instead of full tab snapshots; private windows never
  recorded; deletes serialized with saves; settings validated; excluded sites and
  privacy settings applied to already-saved data.

## 1.1.0
- Fixed export under Manifest V3; serialized writes; search-and-reopen popup;
  options page; per-browser builds.
