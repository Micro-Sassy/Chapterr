import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    VitePWA({
      // Show an "update available" prompt instead of silently swapping versions.
      registerType: "prompt",
      injectRegister: false,
      manifest: false, // served from public/manifest.webmanifest
      includeAssets: ["favicon.svg", "favicon.png", "robots.txt", "icons/*.png", "brand/chapterr/*.svg", "brand/chapterr/*.png"],
      // Custom service worker (src/sw.ts): Workbox precache + the cover-proxy cache,
      // the offline navigation fallback and the push/notificationclick handlers.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        // The OCR engine (tesseract core + worker) is loaded on demand, never precached.
        globIgnores: ["**/tesseract-core*", "**/worker.min*"],
        maximumFileSizeToCacheInBytes: 3_000_000,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
