# TabJournal

TabJournal is a Chrome (MV3) extension that periodically snapshots all open tabs and stores a timestamped history (a "journal") in `chrome.storage.local`. It also snapshots on tab events (create/remove/update), provides a **searchable popup to find and reopen any tab you've ever had open**, and an export button to download the journal as JSON.

## Files

- `manifest.json` — MV3 manifest and permissions
- `background.js` — service worker: takes snapshots (debounced, de-duplicated) and reacts to tab/alarm events
- `storage.js` — storage helpers with a serialized write queue (`appendEntry`) and `loadJournal`
- `config.js` — overridable configuration with defaults
- `popup.html` / `popup.js` — popup UI: search/reopen past tabs + export
- `options.html` / `options.js` — settings page (interval, max entries, event capture, debounce)
- `scripts/build.js` — build step that emits a clean `dist/` artifact
- `tests/parse_js.js` — syntax check for all source modules

## Install (development)

1. `npm install`
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → choose this folder (or run `npm run build` and load `dist/`).

## Usage

- Snapshots run every 5 minutes (configurable) and on tab events.
- Click the toolbar icon to **search past tabs** by title/URL and click a result to reopen it.
- Click **Export** to download the full journal as JSON.
- Right-click the extension → **Options** to change the interval, journal cap, and event capture.

## Configuration

Defaults live in `config.js` and can be overridden from the Options page; overrides persist in `chrome.storage.local`:

| Setting | Default | Meaning |
|---|---|---|
| `snapshotMinutes` | 5 | periodic snapshot interval |
| `maxEntries` | 1500 | journal cap before oldest entries are trimmed |
| `captureEvents` | true | snapshot on tab create/remove/update |
| `eventDebounceMs` | 2000 | collapse bursts of tab events into one snapshot |

## Scripts

- `npm test` — parse-check all source modules
- `npm run build` — produce `dist/` (the shippable artifact; zip it for the Web Store)

## Notes

- The journal is stored under the `tab_journal` key; config under `tab_journal_config`.
- Writes are serialized through a queue so concurrent tab events can't drop entries.
- Permissions required: `tabs`, `storage`, `alarms`. (Export uses an in-page download, so `downloads` is not needed.)

## License

MIT
