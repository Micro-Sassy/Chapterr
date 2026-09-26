// Regenerate PWA icons from public/icon.svg and public/icon-maskable.svg.
// Usage: npm run icons
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

await mkdir("public/icons", { recursive: true });
const jobs = [
  ["public/icon.svg", "public/icons/icon-192.png", 192],
  ["public/icon.svg", "public/icons/icon-512.png", 512],
  ["public/icon-maskable.svg", "public/icons/maskable-192.png", 192],
  ["public/icon-maskable.svg", "public/icons/maskable-512.png", 512],
  ["public/icon-maskable.svg", "public/icons/apple-touch-icon.png", 180],
];
for (const [src, out, size] of jobs) {
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(out);
  console.log("wrote", out);
}
