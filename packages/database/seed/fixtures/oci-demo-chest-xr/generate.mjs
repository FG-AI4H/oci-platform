// One-shot grayscale-PNG generator for the OCI-curated demo dataset
// `oci-demo-chest-xr` (#251). Produces five 256×256 PNGs that look
// vaguely chest-XR-ish — dark background, two oval lung-shaped
// regions, central spine-ish stripe, plus per-image noise so the SHA-
// 256 hashes differ. The output is *committed* to the repo (the
// migrate task uploads the bytes to S3 on deploy); regenerate only
// when intentionally rotating the demo set.
//
// Zero runtime dependencies — encodes PNGs by hand using node:zlib
// for the IDAT compression and a hand-rolled CRC-32 table for the
// chunk checksums.
//
// Usage:
//   node packages/database/seed/fixtures/oci-demo-chest-xr/generate.mjs
//
// IMPORTANT: the synthetic images are NOT diagnostic content. The
// dataset is flagged in the manifest with `synthetic: true`.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3 polynomial 0xedb88320). PNG mandates this checksum
// over each chunk's type + data. Declare at the top so the encoder below
// can reference it without an ESM temporal-dead-zone trip.
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Minimal hand-rolled grayscale PNG encoder (color type 0, 8-bit depth,
// no interlace, no palette). Zero-dependency by design — we don't want
// sharp / pngjs in the seed pipeline for ~10 KB of data per image.
// ---------------------------------------------------------------------------

function encodeGrayscalePng(pixels, width, height) {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: width, height, bit depth, color type, compression, filter, interlace.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits/sample
  ihdr[9] = 0; // 0 = grayscale, no alpha
  ihdr[10] = 0; // compression method (only 0 = deflate is standardised)
  ihdr[11] = 0; // filter method (0 = adaptive)
  ihdr[12] = 0; // interlace (0 = none)

  // IDAT: filter byte (0 = None) prepended to each scanline, then
  // zlib-compress the whole stream.
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  const idatData = deflateSync(raw, { level: 9 });

  const iendData = Buffer.alloc(0);

  return Buffer.concat([
    magic,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', iendData),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// ---------------------------------------------------------------------------
// Image content — a tiny rasteriser for the chest-XR-ish look.
// ---------------------------------------------------------------------------

function renderChestXr(width, height, seed, lungOffset) {
  const out = Buffer.alloc(width * height);
  const rand = mulberry32(seed);

  const cx = width / 2;
  const cy = height / 2 + 8;
  const lungRx = width * 0.22;
  const lungRy = height * 0.34;
  const lungSepX = width * 0.18;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Dark base value with subtle radial vignette.
      const dx = x - cx;
      const dy = y - cy;
      const radial = Math.sqrt(dx * dx + dy * dy) / (width * 0.55);
      let v = 28 + Math.max(0, 1 - radial) * 22;

      // Spine — vertical stripe slightly brighter than torso.
      if (Math.abs(x - cx) < 4) v += 50;

      // Lungs darker (air-filled).
      const lx = (x - (cx - lungSepX + lungOffset)) / lungRx;
      const ly = (y - cy) / lungRy;
      if (lx * lx + ly * ly < 1) v -= 18;

      const rx = (x - (cx + lungSepX + lungOffset)) / lungRx;
      const ry = (y - cy) / lungRy;
      if (rx * rx + ry * ry < 1) v -= 18;

      // Faint mediastinum + diaphragm hint.
      const aorta = Math.exp(-Math.pow((x - cx + 6) / 18, 2) - Math.pow((y - (cy - 30)) / 20, 2));
      v += aorta * 38;

      const diaphragm = Math.exp(-Math.pow((y - (cy + lungRy - 6)) / 14, 2));
      v += diaphragm * (16 + Math.sin(x * 0.07) * 6);

      // Per-pixel noise so two images aren't byte-identical and the
      // SHA-256 hashes diverge.
      v += (rand() - 0.5) * 14;

      const px = Math.max(0, Math.min(255, Math.round(v)));
      out[y * width + x] = px;
    }
  }
  return out;
}

// Tiny seeded RNG (Mulberry32 — fast, good distribution for visual
// noise; not cryptographic).
function mulberry32(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

const WIDTH = 256;
const HEIGHT = 256;
const SEED_BASE = 0xc0ffee;

const IMAGES = [
  { name: 'sample-001.png', seed: SEED_BASE + 1, lungOffset: 0 },
  { name: 'sample-002.png', seed: SEED_BASE + 2, lungOffset: 4 },
  { name: 'sample-003.png', seed: SEED_BASE + 3, lungOffset: -3 },
  { name: 'sample-004.png', seed: SEED_BASE + 4, lungOffset: 7 },
  { name: 'sample-005.png', seed: SEED_BASE + 5, lungOffset: -6 },
];

for (const img of IMAGES) {
  const pixels = renderChestXr(WIDTH, HEIGHT, img.seed, img.lungOffset);
  const png = encodeGrayscalePng(pixels, WIDTH, HEIGHT);
  writeFileSync(join(__dirname, img.name), png);
  console.log(`wrote ${img.name} (${png.length} bytes)`);
}
