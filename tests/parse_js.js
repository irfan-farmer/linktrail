const fs = require('fs');
const path = require('path');
const esprima = require('esprima');

const ROOT = path.resolve(__dirname, '..');
const files = [
  'background.js',
  'popup.js',
  'storage.js',
  'config.js',
  'options.js'
];

let ok = true;

for (const f of files) {
  try {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    esprima.parseModule(code, { tolerant: false });
    console.log(`${f}: OK`);
  } catch (e) {
    console.error(`${f}: PARSE ERROR: ${e.message}`);
    ok = false;
  }
}

process.exit(ok ? 0 : 1);
