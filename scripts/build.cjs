// Build/release step (12-factor V: strictly separate build and run).
// Emits clean, per-browser artifacts under dist/. Each target gets only the
// shippable assets — no source tooling, tests, or node_modules.
//
//   dist/chrome   — Chrome, Edge, Brave, Opera, Vivaldi (MV3 service worker)
//   dist/firefox  — Firefox (MV3 event-page background + gecko settings)
//
// The shared JavaScript is browser-agnostic (see browser.js); only the manifest
// differs between targets. Safari is produced from dist/chrome via Apple's
// `xcrun safari-web-extension-converter` (requires macOS + Xcode) — see README.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const ASSETS = [
  'browser.js',
  'privacy.js',
  'config.js',
  'storage.js',
  'background.js',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js'
];
const ICON_SIZES = [16, 32, 48, 128];

const baseManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// Firefox MV3 uses a non-persistent event-page background (module scripts), not
// a service worker, and requires a gecko id.
function firefoxManifest(m) {
  const fx = structuredClone(m);
  delete fx.background.service_worker;
  fx.background = { scripts: ['background.js'], type: 'module' };
  fx.browser_specific_settings = {
    gecko: { id: 'tabjournal@local', strict_min_version: '115.0' }
  };
  return fx;
}

const targets = {
  chrome: baseManifest,
  firefox: firefoxManifest(baseManifest)
};

function buildTarget(name, manifest) {
  const out = path.join(DIST, name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

  const copy = rel => {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) {
      console.error(`Missing asset: ${rel}`);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(out, rel));
  };

  ASSETS.forEach(copy);
  ICON_SIZES.forEach(n => copy(`icons/icon-${n}.png`));
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`  dist/${name}/  (${ASSETS.length + ICON_SIZES.length + 1} files)`);
}

fs.rmSync(DIST, { recursive: true, force: true });
console.log(`Building TabJournal v${baseManifest.version}:`);
for (const [name, manifest] of Object.entries(targets)) buildTarget(name, manifest);
console.log('Load a folder via the browser\'s "Load unpacked"/"Load temporary add-on", or zip it for the store.');
