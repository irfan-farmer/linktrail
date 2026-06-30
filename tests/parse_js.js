const fs = require('fs');
const path = require('path');
const { parse } = require('acorn');

const ROOT = path.resolve(__dirname, '..');
const files = [
  'browser.js',
  'privacy.js',
  'config.js',
  'storage.js',
  'background.js',
  'popup.js',
  'options.js'
];

let ok = true;

for (const file of files) {
  try {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
    console.log(`${file}: OK`);
  } catch (e) {
    console.error(`${file}: PARSE ERROR: ${e.message}`);
    ok = false;
  }
}

process.exit(ok ? 0 : 1);
