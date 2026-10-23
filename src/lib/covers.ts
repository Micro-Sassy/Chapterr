/**
 * Cover images are served through the app's own cover proxy
 * (GET /api/public/covers?u=…) rather than loaded from the catalogue sites
 * directly, so they are not subject to third-party redirects, the content
 * security policy or the service worker's rules for other origins.
 */
export function coverSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/") || url.startsWith("data:") || url.startsWith("blob:")) return url;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (typeof location !== "undefined" && u.origin === location.origin) return url;
    return `/api/public/covers?u=${encodeURIComponent(u.toString())}`;
  } catch {
    return null;
  }
}
