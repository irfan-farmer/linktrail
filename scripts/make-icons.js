// Generates the extension's PNG icons (no external deps — uses Node's zlib).
// A teal rounded square with a white notebook spine and three entry lines,
// evoking a journal. Run with `npm run icons`; output goes to icons/.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICONS_DIR = path.resolve(__dirname, '..', 'icons');
const SIZES = [16, 32, 48, 128];
const BG = [15, 157, 140];   // teal
const FG = [255, 255, 255];  // white

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Inside a rounded square of side n with corner radius r?
function inRoundedSquare(x, y, n, r) {
  const cx = Math.min(Math.max(x, r), n - r);
  const cy = Math.min(Math.max(y, r), n - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

function pixel(x, y, n) {
  const r = 0.18 * n;
  if (!inRoundedSquare(x + 0.5, y + 0.5, n, r)) return [0, 0, 0, 0];

  const u = (x + 0.5) / n;
  const v = (y + 0.5) / n;

  const spine = u > 0.16 && u < 0.27 && v > 0.18 && v < 0.82;
  const lineU = u > 0.34 && u < 0.82;
  const line =
    lineU && ((v > 0.28 && v < 0.36) || (v > 0.46 && v < 0.54) || (v > 0.64 && v < 0.72));

  return spine || line ? [...FG, 255] : [...BG, 255];
}

function makePng(n) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA

  const raw = Buffer.alloc(n * (n * 4 + 1));
  let p = 0;
  for (let y = 0; y < n; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < n; x++) {
      const [r, g, b, a] = pixel(x, y, n);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

fs.mkdirSync(ICONS_DIR, { recursive: true });
for (const n of SIZES) {
  fs.writeFileSync(path.join(ICONS_DIR, `icon-${n}.png`), makePng(n));
  console.log(`icons/icon-${n}.png`);
}
