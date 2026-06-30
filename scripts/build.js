// Build/release step (12-factor V: strictly separate build and run).
// Copies only the shippable extension assets into dist/, producing a clean,
// reproducible artifact that excludes source tooling, tests, and node_modules.
// The dist/ folder is what you load as an unpacked extension or zip for the
// Chrome Web Store.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const ASSETS = [
  'manifest.json',
  'background.js',
  'storage.js',
  'config.js',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js'
];

const ICON_SIZES = [16, 32, 48, 128];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });

const copy = rel => {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) {
    console.error(`Missing asset: ${rel}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(DIST, rel));
};

ASSETS.forEach(copy);
ICON_SIZES.forEach(n => copy(`icons/icon-${n}.png`));

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const fileCount = ASSETS.length + ICON_SIZES.length;
console.log(`Built TabJournal v${version} -> dist/ (${fileCount} files)`);
console.log('Load dist/ via chrome://extensions "Load unpacked", or zip it for the Web Store.');
