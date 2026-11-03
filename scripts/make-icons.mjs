// Generates the PWA icons as PNGs with no dependencies (zlib + a tiny PNG encoder).
// Run: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../client/public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (h, a = 255) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const TEAL = hex('#2f6f73');
const CAB = hex('#fffdf9');
const BRASS = hex('#b08a4e');
const GLASS = hex('#cfe2e7');
const WATER = hex('#5f97c4');
const CLEAR = [0, 0, 0, 0];

const inRound = (x, y, x0, y0, w, h, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** The washer mark on a 64-unit grid; `pad` shrinks it for maskable safe zones. */
function washer(bg, pad = 0, rounded = true) {
  return (px, py, size) => {
    const s = 64 / size;
    const k = 64 / (64 - 2 * pad);
    const x = (px * s - 32) * k + 32;
    const y = (py * s - 32) * k + 32;
    const X = px * s;
    const Y = py * s;
    if (rounded && !inRound(X, Y, 0, 0, 64, 64, 14)) return CLEAR;
    const d = Math.hypot(x - 32, y - 36);
    if (inRound(x, y, 12, 10, 40, 46, 6)) {
      if (Math.hypot(x - 20, y - 17) < 2.2) return BRASS;
      if (d < 11.5) return y > 37 + Math.sin((x - 20) / 3) * 1.5 ? WATER : GLASS;
      if (d < 14.5) return BRASS;
      return CAB;
    }
    return bg;
  };
}

/** Monochrome badge (Android status bar): white glyph on transparent. */
const badge = (px, py, size) => {
  const s = 72 / size;
  const d = Math.hypot(px * s - 36, py * s - 38);
  const ring = d > 15 && d < 21;
  const cab = inRound(px * s, py * s, 14, 8, 44, 56, 8) && !inRound(px * s, py * s, 18, 12, 36, 48, 5);
  return ring || cab ? [255, 255, 255, 255] : CLEAR;
};

const files = {
  'icon-192.png': png(192, washer(TEAL)),
  'icon-512.png': png(512, washer(TEAL)),
  'maskable-512.png': png(512, washer(TEAL, 10, false)),
  'apple-touch-icon-180.png': png(180, washer(TEAL, 0, false)),
  'badge-72.png': png(72, badge),
};
for (const [name, buf] of Object.entries(files)) {
  writeFileSync(new URL(name, OUT), buf);
  console.log(`icons/${name}  ${buf.length} bytes`);
}
