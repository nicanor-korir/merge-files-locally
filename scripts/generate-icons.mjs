// Generates the app icons and the social card.
//
// There is no image tooling to depend on here, and adding one for four static files would be
// a poor trade, so the shapes are rasterised directly and encoded as PNG with node's own zlib.
// Geometry is supersampled 4x per axis, which is what keeps the curves smooth at 32px.
//
// Run: bun run generate-icons   (only needed when the mark itself changes)

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

const BRAND = [0x43, 0x61, 0xee];
const BRAND_DEEP = [0x33, 0x4d, 0xc8];
const PAPER = [0xff, 0xff, 0xff];
const FOLD = [0xc7, 0xd2, 0xfe];

const SS = 4; // supersampling factor per axis

// -- PNG encoding --

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay zero: default compression, filter and interlace.

  // Filter type 0 (none) on every scanline: these are flat shapes, so the win from a smarter
  // filter is not worth the code.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// -- Drawing --

// A canvas of coverage-blended RGBA pixels. Shapes are painted by testing SSxSS sample points
// per pixel and blending by how many landed inside.
function createCanvas(width, height, background) {
  const px = Buffer.alloc(width * height * 4);
  if (background) {
    for (let i = 0; i < width * height; i++) {
      px[i * 4] = background[0];
      px[i * 4 + 1] = background[1];
      px[i * 4 + 2] = background[2];
      px[i * 4 + 3] = 255;
    }
  }
  return { width, height, px };
}

function paint(canvas, colour, inside) {
  const { width, height, px } = canvas;
  const step = 1 / SS;
  const offset = step / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (inside(x + offset + sx * step, y + offset + sy * step)) hits++;
        }
      }
      if (!hits) continue;

      const a = hits / (SS * SS);
      const i = (y * width + x) * 4;
      const dstA = px[i + 3] / 255;
      const outA = a + dstA * (1 - a);
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.round((colour[c] * a + px[i + c] * dstA * (1 - a)) / outA);
      }
      px[i + 3] = Math.round(outA * 255);
    }
  }
}

const roundedRect = (x, y, w, h, r) => (px, py) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  // Distance to the nearest corner centre, clamped so straight edges always pass.
  const dx = Math.max(x + r - px, 0, px - (x + w - r));
  const dy = Math.max(y + r - py, 0, py - (y + h - r));
  return dx * dx + dy * dy <= r * r;
};

const and = (a, b) => (x, y) => a(x, y) && b(x, y);

// Half-plane below the line through (x1,y1)-(x2,y2), used to slice the folded corner.
const belowLine = (x1, y1, x2, y2) => (x, y) =>
  (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1) >= 0;

const triangle = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx, cy);
  const d3 = sign(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

/**
 * The mark: a sheet of paper with a folded corner and a download arrow through it — the two
 * things the app actually does, merge into one document and hand it back.
 *
 * `scale` maps the design, authored on a 1000-unit square, onto the requested pixel size.
 */
function drawMark(canvas, size, originX, originY, boxed) {
  const u = size / 1000;
  const X = (v) => originX + v * u;
  const Y = (v) => originY + v * u;
  const S = (v) => v * u;

  if (boxed) {
    // iOS and Android both mask icons, so the art stays well inside a rounded tile.
    paint(canvas, BRAND, roundedRect(X(0), Y(0), S(1000), S(1000), S(220)));
  }

  const docX = 250;
  const docY = 170;
  const docW = 500;
  const docH = 660;
  const fold = 180;

  const sheet = roundedRect(X(docX), Y(docY), S(docW), S(docH), S(48));
  const cornerCut = belowLine(
    X(docX + docW - fold), Y(docY),
    X(docX + docW), Y(docY + fold),
  );

  paint(canvas, PAPER, and(sheet, cornerCut));

  // The dog-ear: the small triangle just inside the cut, tinted to read as the underside of
  // a folded corner. It lies on the kept side of the cut line, so it is clipped to the sheet
  // rather than to the removed corner.
  paint(
    canvas,
    FOLD,
    and(
      sheet,
      triangle(
        X(docX + docW - fold), Y(docY),
        X(docX + docW), Y(docY + fold),
        X(docX + docW - fold), Y(docY + fold),
      ),
    ),
  );

  // Download arrow: stem plus head, centred in the sheet.
  const cx = docX + docW / 2;
  paint(canvas, BRAND_DEEP, roundedRect(X(cx - 42), Y(370), S(84), S(210), S(42)));
  paint(
    canvas,
    BRAND_DEEP,
    triangle(X(cx - 150), Y(540), X(cx + 150), Y(540), X(cx), Y(700)),
  );
}

function writeIcon(name, size) {
  const canvas = createCanvas(size, size, null);
  drawMark(canvas, size, 0, 0, true);
  writeFileSync(join(PUBLIC, name), encodePng(size, size, canvas.px));
  return name;
}

function writeSocialCard(name, width, height) {
  const canvas = createCanvas(width, height, BRAND);
  const mark = Math.round(height * 0.62);
  drawMark(canvas, mark, Math.round((width - mark) / 2), Math.round((height - mark) / 2), false);
  writeFileSync(join(PUBLIC, name), encodePng(width, height, canvas.px));
  return name;
}

mkdirSync(PUBLIC, { recursive: true });
const written = [
  writeIcon('icon-192.png', 192),
  writeIcon('icon-512.png', 512),
  writeIcon('apple-touch-icon.png', 180),
  writeIcon('favicon-32.png', 32),
  writeSocialCard('og.png', 1200, 630),
];
console.log(`Generated ${written.length} images: ${written.join(', ')}`);
