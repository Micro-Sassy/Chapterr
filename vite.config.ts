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
      includeAssets: ["favicon.svg", "robots.txt", "icons/*.png"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        // Offline app shell: any navigation that is not an API call falls back
        // to the cached index.html so the app opens without a connection.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // Private API responses are intentionally NOT cached by the service
        // worker, so member data never lingers in Cache Storage on shared devices.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === "https://covers.openlibrary.org" ||
              url.hostname.endsWith("books.google.com") ||
              url.hostname.endsWith("googleusercontent.com"),
            handler: "CacheFirst",
            options: {
              cacheName: "book-covers",
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
