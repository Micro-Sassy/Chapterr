// Renders the Chapterr brand files (brand/chapterr/**, supplied as outlined SVG)
// into everything the app, the marketing site and emails reference:
//   public/brand/chapterr/*.svg + *.png   logo lockups (horizontal, vertical, mark, wordmark)
//   public/icons/*.png                    PWA icons (any + maskable), Apple touch icon
//   public/favicon.{svg,png}
//   public/brand/chapterr/og-image.png    1200x630 social card (rendered with Playwright so the
//                                         real Fraunces/Inter fonts are used)
//   site/public/...                       the same files for chapterr.io
// Usage: node scripts/build-brand.mjs
import { chromium } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.join(root, "brand", "chapterr");
const outBrand = path.join(root, "public", "brand", "chapterr");
const outIcons = path.join(root, "public", "icons");
const siteBrand = path.join(root, "site", "public", "brand");
const siteIcons = path.join(root, "site", "public", "icons");
for (const d of [outBrand, outIcons, siteBrand, siteIcons]) mkdirSync(d, { recursive: true });

const FOREST = { r: 0x1e, g: 0x3a, b: 0x2f, alpha: 1 };
const LINEN = { r: 0xf4, g: 0xee, b: 0xe2, alpha: 1 };

const VARIANTS = ["color-on-light", "color-on-dark", "mono-forest", "mono-linen", "mono-black", "mono-white"];
const LOCKUPS = [
  ["horizontal", 1600],
  ["vertical", 1000],
  ["mark", 512],
  ["wordmark", 1400],
];

function readSvg(rel) {
  const p = path.join(src, rel);
  if (!existsSync(p)) throw new Error(`Missing brand file ${rel}`);
  return readFileSync(p);
}

async function png(svg, width, file, opts = {}) {
  let img = sharp(svg, { density: 384 }).resize({ width, withoutEnlargement: false });
  if (opts.flatten) img = img.flatten({ background: opts.flatten });
  await img.png({ compressionLevel: 9, palette: opts.palette ?? true, quality: 92, effort: 10 }).toFile(file);
  console.log("wrote", path.relative(root, file));
}

// --- Logo lockups: copy SVGs and render PNGs ----------------------------------------
for (const [kind, width] of LOCKUPS) {
  for (const v of VARIANTS) {
    const name = `chapterr-${kind}-${v}.svg`;
    const svg = readSvg(path.join("logo", kind, name));
    const base = `${kind === "mark" ? "mark" : kind === "wordmark" ? "wordmark" : `logo-${kind}`}-${v}`;
    writeFileSync(path.join(outBrand, `${base}.svg`), svg);
    await png(svg, width, path.join(outBrand, `${base}.png`));
  }
}

// --- Watermark (12% opacity baked in) ------------------------------------------------
for (const tone of ["forest", "linen"]) {
  const svg = readSvg(path.join("watermark", `chapterr-watermark-mark-${tone}.svg`));
  writeFileSync(path.join(outBrand, `watermark-mark-${tone}.svg`), svg);
}

// --- App icons -------------------------------------------------------------------------
const iconSquare = readSvg("app-icon/chapterr-app-icon-square.svg");
const iconRounded = readSvg("app-icon/chapterr-app-icon-rounded.svg");
const iconLight = readSvg("app-icon/chapterr-app-icon-light-rounded.svg");
const avatar = readSvg("app-icon/chapterr-avatar-circle.svg");
writeFileSync(path.join(outBrand, "app-icon-rounded.svg"), iconRounded);
writeFileSync(path.join(outBrand, "app-icon-square.svg"), iconSquare);
writeFileSync(path.join(outBrand, "avatar-circle.svg"), avatar);
// "any" purpose icons: rounded (platforms that do not mask). Maskable: square (the OS masks it;
// the mark sits at 70% width, inside the 80% safe zone).
for (const size of [192, 512]) {
  await png(iconRounded, size, path.join(outIcons, `icon-${size}.png`), { palette: false });
  await png(iconSquare, size, path.join(outIcons, `maskable-${size}.png`), { palette: false, flatten: FOREST });
}
await png(iconSquare, 180, path.join(outIcons, "apple-touch-icon.png"), { palette: false, flatten: FOREST });
await png(iconLight, 512, path.join(outIcons, "icon-light-512.png"), { palette: false });
await png(iconRounded, 64, path.join(root, "public", "favicon.png"), { palette: false });
writeFileSync(path.join(root, "public", "favicon.svg"), iconRounded);

// --- Open Graph image (1200x630) --------------------------------------------------------
const lockup = readSvg("logo/horizontal/chapterr-horizontal-color-on-light.svg").toString("utf8");
// Fonts are embedded from the app's own packages so the render needs no network.
const fontUrl = (rel) => `url(data:font/woff2;base64,${readFileSync(path.join(root, "node_modules", rel)).toString("base64")}) format("woff2")`;
const ogHtml = `<!doctype html><html><head><meta charset="utf-8">
<style>
  @font-face{font-family:Fraunces;font-style:normal;font-weight:100 900;src:${fontUrl("@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2")}}
  @font-face{font-family:Inter;font-style:normal;font-weight:100 900;src:${fontUrl("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")}}
  html,body{margin:0;width:1200px;height:630px;background:#F4EEE2;overflow:hidden}
  .wrap{position:relative;width:1200px;height:630px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:0 96px;box-sizing:border-box;color:#1E3A2F}
  .logo svg{height:96px;width:auto;display:block}
  h1{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:72px;line-height:1.05;letter-spacing:-0.03em;margin:56px 0 20px;font-variation-settings:"opsz" 144}
  h1 em{font-style:normal;color:#B8903F}
  p{font-family:Inter,system-ui,sans-serif;font-size:28px;line-height:1.4;color:#4B5E55;margin:0;max-width:640px}
  .shelf{position:absolute;right:96px;bottom:0;width:300px;height:400px}
  .spine{position:absolute;bottom:70px;border-radius:8px;background:#1E3A2F}
  .band{position:absolute;left:0;right:0;height:14px;background:#B8903F}
  .rail{position:absolute;left:0;right:0;bottom:56px;height:14px;border-radius:6px;background:#B8903F}
</style></head><body><div class="wrap">
  <div class="logo">${lockup}</div>
  <h1>Your club, <em>one shelf</em></h1>
  <p>The shelf, the schedule, the conversation — for every book club you're in.</p>
  <div class="shelf" aria-hidden="true">
    <div class="spine" style="left:20px;width:52px;height:150px"><div class="band" style="top:30px"></div></div>
    <div class="spine" style="left:92px;width:52px;height:200px;background:#2A4D3F"><div class="band" style="top:36px"></div></div>
    <div class="spine" style="left:184px;width:52px;height:230px;transform:rotate(14deg);transform-origin:bottom left;background:#142A22"><div class="band" style="top:36px"></div></div>
    <div class="rail"></div>
  </div>
</div></body></html>`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(ogHtml, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const ogPath = path.join(outBrand, "og-image.png");
await page.screenshot({ path: ogPath, type: "png" });
await browser.close();
console.log("wrote", path.relative(root, ogPath));

// --- Marketing site copies --------------------------------------------------------------
for (const f of [
  "logo-horizontal-color-on-light.svg",
  "logo-horizontal-color-on-dark.svg",
  "logo-horizontal-color-on-light.png",
  "logo-vertical-color-on-light.svg",
  "logo-vertical-color-on-dark.svg",
  "mark-color-on-light.svg",
  "mark-color-on-dark.svg",
  "wordmark-color-on-light.svg",
  "wordmark-color-on-dark.svg",
  "watermark-mark-forest.svg",
  "watermark-mark-linen.svg",
  "app-icon-rounded.svg",
]) {
  cpSync(path.join(outBrand, f), path.join(siteBrand, f));
}
cpSync(ogPath, path.join(root, "site", "public", "og-image.png"));
cpSync(path.join(root, "public", "favicon.svg"), path.join(root, "site", "public", "favicon.svg"));
cpSync(path.join(root, "public", "favicon.png"), path.join(root, "site", "public", "favicon.png"));
cpSync(path.join(outIcons, "apple-touch-icon.png"), path.join(siteIcons, "apple-touch-icon.png"));
console.log("copied site assets");
void LINEN;
