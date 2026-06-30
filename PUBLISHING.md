# Publishing TabJournal

How to ship TabJournal to users and push updates. The build is already
per-browser: `npm run build` produces `dist/chrome` and `dist/firefox`.

## 0. Before every release

```bash
npm test          # parse check + redaction tests must pass
npm run build     # regenerates dist/chrome and dist/firefox
```

Bump the version in **both** files (store uploads are rejected unless the
version is strictly higher than the live one):

- `manifest.json` → `"version"`
- `package.json` → `"version"`

Versions are dot-separated integers, e.g. `1.1.0` → `1.2.0` (features) or
`1.1.1` (fixes).

## 1. Zip the build

Stores want a zip whose **`manifest.json` sits at the root** (zip the folder's
*contents*, not the folder itself).

- **Windows (PowerShell):**
  ```powershell
  Compress-Archive -Path dist/chrome/* -DestinationPath tabjournal-chrome.zip -Force
  Compress-Archive -Path dist/firefox/* -DestinationPath tabjournal-firefox.zip -Force
  ```
- **macOS / Linux:**
  ```bash
  (cd dist/chrome && zip -r ../../tabjournal-chrome.zip .)
  (cd dist/firefox && zip -r ../../tabjournal-firefox.zip .)
  ```

## 2. First-time submission per store

| Store | Cost | What to upload | Notes |
|---|---|---|---|
| **Chrome Web Store** | $5 one-time dev fee | `tabjournal-chrome.zip` | Also installable by Edge/Brave/Opera/Vivaldi users. |
| **Microsoft Edge Add-ons** | free | `tabjournal-chrome.zip` | Same package as Chrome. |
| **Firefox Add-ons (AMO)** | free | `tabjournal-firefox.zip` | **Blocked until the gecko id is set — see TODO below.** |
| **Safari** | $99/yr Apple Developer | convert first | `xcrun safari-web-extension-converter dist/chrome` (macOS + Xcode), then ship via App Store. Optional. |

Recommended first launch: **Chrome Web Store + Edge Add-ons** (covers most
users for ~$5). Add Firefox once you have a real add-on id, and Safari only on
demand.

### Listing essentials (all stores)
- Name, summary, and full description (reuse `README.md`).
- At least one screenshot of the popup.
- **Privacy disclosure:** declare **"does not collect user data."** It's true
  (everything is local — see `PRIVACY.md`) and it's a real trust/ranking
  advantage. Link `PRIVACY.md` as the privacy policy.
- Justify each permission (`tabs`, `storage`, `alarms`) — `PRIVACY.md` has the
  table ready to paste.

## 3. Shipping an update later

The store model is **bump version → upload → browsers auto-update everyone**.
Users never reinstall.

1. Make changes, `npm test`, `npm run build`.
2. Bump the version (step 0).
3. Zip (step 1) and upload the new package to each store; submit for review.
4. Installed copies auto-update within a few hours. No user action needed.

### Gotchas
- **Adding a new permission disables the extension until the user re-approves
  it.** Minimize/batch permission additions.
- **Migrations:** users keep their existing `storage.local` across updates. If a
  release changes the journal's shape, read old data and upgrade it in code —
  never assume a clean slate.
- Each store reviews independently, so live versions can briefly differ across
  stores. That's normal.

## TODO before publishing to Firefox

The Firefox build pins a placeholder add-on id in
`scripts/build.cjs` → `browser_specific_settings.gecko.id` (currently
`tabjournal@local`). **This id is permanent once published to AMO**, so set a
real one you own *before* the first Firefox submission, e.g.
`tabjournal@yourdomain.com` (a domain-style string; you don't need a live
website, but use something you control). Update it in `scripts/build.cjs`,
rebuild, and verify `dist/firefox/manifest.json`.

The Chrome/Edge path needs none of this and can ship today.
