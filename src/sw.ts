/// <reference lib="webworker" />
// Chapterr service worker (vite-plugin-pwa injectManifest). Precaches the app shell,
// keeps the cover-proxy cache, falls back to index.html for navigations, and shows
// push notifications. Private API responses are never cached here.
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import type { PushPayload } from "@shared/types";

declare let self: ServiceWorkerGlobalScope;

// `registerType: "prompt"`: wait for the app to call skipWaiting via the update banner.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") void self.skipWaiting();
});
clientsClaim();

// --- Precache (manifest injected at build time) -----------------------------------------
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Offline app shell: any navigation that is not an API call falls back to index.html.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }));

// Covers are proxied through our own origin (worker/routes/covers.ts).
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname === "/api/public/covers",
  new CacheFirst({
    cacheName: "book-covers",
    plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 }), new CacheableResponsePlugin({ statuses: [200] })],
  }),
);

// --- Push -----------------------------------------------------------------------------------
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/maskable-192.png";

function parsePayload(event: PushEvent): PushPayload {
  const fallback: PushPayload = { title: "Chapterr", body: "Something new in your club.", url: "/notifications", tag: "chapterr" };
  if (!event.data) return fallback;
  try {
    const data = event.data.json() as Partial<PushPayload>;
    return {
      title: typeof data.title === "string" && data.title ? data.title : fallback.title,
      body: typeof data.body === "string" ? data.body : fallback.body,
      url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : fallback.url,
      tag: typeof data.tag === "string" && data.tag ? data.tag : fallback.tag,
    };
  } catch {
    return { ...fallback, body: event.data.text() || fallback.body };
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: ICON,
      badge: BADGE,
      tag: payload.tag,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const target = new URL(data?.url && data.url.startsWith("/") ? data.url : "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Prefer a tab that already has the app open: navigate it and bring it forward.
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ("navigate" in client && typeof client.navigate === "function") {
          try {
            const navigated = await client.navigate(target);
            if (navigated) return navigated.focus();
          } catch {
            /* fall through to focus */
          }
        }
        return client.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
