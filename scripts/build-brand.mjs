// Build web-ready brand assets from the club's original logo files in brand/source/.
// Produces transparent logos in the brand ink (green) and a cream variant for dark
// mode, a cropped book mark, and all PWA/app icons.
// Usage: npm run brand
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const SRC = "brand/source";
const OUT = "public/brand";
const ICONS = "public/icons";
const GREEN = { r: 0x21, g: 0x3a, b: 0x2f }; // logo ink
const CREAM = { r: 0xf1, g: 0xe6, b: 0xcc }; // parchment
const PAPER = { r: 0xf3, g: 0xea, b: 0xd6 };

await mkdir(OUT, { recursive: true });
await mkdir(ICONS, { recursive: true });

/** Return {width,height,mask} where mask is an 8-bit ink coverage map. */
async function inkMask(file) {
  const img = sharp(file);
  const meta = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = Buffer.alloc(info.width * info.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3] / 255;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // Dark ink on light paper -> opaque; light paper -> transparent. Soft edges preserved.
    const ink = meta.hasAlpha && a < 0.999 ? a : Math.min(1, Math.max(0, (225 - lum) / (225 - 70)));
    mask[p] = Math.round(ink * 255);
  }
  return { width: info.width, height: info.height, mask };
}

function colorize({ width, height, mask }, color) {
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < mask.length; p++) {
    out[p * 4] = color.r;
    out[p * 4 + 1] = color.g;
    out[p * 4 + 2] = color.b;
    out[p * 4 + 3] = mask[p];
  }
  return sharp(out, { raw: { width, height, channels: 4 } });
}

/** Bounding box of ink, optionally limited to rows [y0, y1). */
function bbox({ width, height, mask }, y0 = 0, y1 = height, threshold = 40) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < width; x++)
      if (mask[y * width + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function crop(m, box, pad = 0) {
  const left = Math.max(0, box.left - pad), top = Math.max(0, box.top - pad);
  const w = Math.min(m.width - left, box.width + pad * 2), h = Math.min(m.height - top, box.height + pad * 2);
  const mask = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) m.mask.copy(mask, y * w, (top + y) * m.width + left, (top + y) * m.width + left + w);
  return { width: w, height: h, mask };
}

/**
 * Split the stacked logo into horizontal ink bands (ridge, book, "Teel Ridge",
 * "BOOK CLUB"). The widest band is the wordmark; the mark is everything above it.
 */
function markRows(m) {
  const bands = [];
  let start = -1;
  for (let y = 0; y <= m.height; y++) {
    let ink = false;
    if (y < m.height) for (let x = 0; x < m.width; x++) if (m.mask[y * m.width + x] > 40) { ink = true; break; }
    if (ink && start < 0) start = y;
    if (!ink && start >= 0) {
      const box = bbox(m, start, y);
      bands.push({ start, end: y, width: box.width });
      start = -1;
    }
  }
  const widest = bands.reduce((best, b, i) => (b.width > bands[best].width ? i : best), 0);
  if (widest === 0) throw new Error("Could not find the book mark above the wordmark");
  return [bands[0].start, bands[widest - 1].end];
}

async function save(img, file, width) {
  await img.resize({ width, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 }).toFile(file);
  console.log("wrote", file);
}

// Horizontal lockup (header, emails) and stacked lockup (sign-in, share pages).
const horizontal = crop(await inkMask(`${SRC}/logo-horizontal.jpg`), bbox(await inkMask(`${SRC}/logo-horizontal.jpg`)), 8);
const stacked = await inkMask(`${SRC}/logo-stacked.png`);
const stackedTrim = crop(stacked, bbox(stacked), 8);
for (const [name, color] of [["green", GREEN], ["cream", CREAM]]) {
  await save(colorize(horizontal, color), `${OUT}/logo-horizontal-${name}.png`, 1200);
  await save(colorize(stackedTrim, color), `${OUT}/logo-stacked-${name}.png`, 720);
}

// Book mark alone (icons, compact header).
const [markTop, markBottom] = markRows(stackedTrim);
const markBox = bbox(stackedTrim, markTop, markBottom);
const mark = crop(stackedTrim, markBox, 4);
for (const [name, color] of [["green", GREEN], ["cream", CREAM]]) await save(colorize(mark, color), `${OUT}/mark-${name}.png`, 512);

/** Square icon: mark centred on a solid background, occupying `scale` of the width. */
async function icon(file, size, bg, fg, scale, radius = 0) {
  const markW = Math.round(size * scale);
  const markPng = await colorize(mark, fg).resize({ width: markW }).png().toBuffer();
  const markMeta = await sharp(markPng).metadata();
  const base = sharp({ create: { width: size, height: size, channels: 4, background: { ...bg, alpha: 1 } } });
  let out = base.composite([{ input: markPng, left: Math.round((size - markW) / 2), top: Math.round((size - markMeta.height) / 2) }]);
  if (radius) {
    const r = Math.round(size * radius);
    const rounded = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`);
    out = sharp(await out.png().toBuffer()).composite([{ input: rounded, blend: "dest-in" }]);
  }
  await out.png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 }).toFile(file);
  console.log("wrote", file);
}

await icon(`${ICONS}/icon-192.png`, 192, GREEN, CREAM, 0.72, 0.18);
await icon(`${ICONS}/icon-512.png`, 512, GREEN, CREAM, 0.72, 0.18);
await icon(`${ICONS}/maskable-192.png`, 192, GREEN, CREAM, 0.56);
await icon(`${ICONS}/maskable-512.png`, 512, GREEN, CREAM, 0.56);
await icon(`${ICONS}/apple-touch-icon.png`, 180, PAPER, GREEN, 0.7);
await icon(`public/favicon.png`, 64, GREEN, CREAM, 0.82, 0.18);
