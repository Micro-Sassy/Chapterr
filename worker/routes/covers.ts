import { Hono } from "hono";
import type { AppEnv } from "../env";
import { badRequest, notFound } from "../lib/errors";
import { clientIp } from "../security/turnstile";
import { enforceRateLimit } from "../security/rate-limit";

/**
 * Same-origin proxy for book cover images.
 *
 * Cover art comes from Open Library (which redirects to archive.org) and
 * Google Books. Loading those straight into the page was unreliable: the
 * redirects, the service worker's cache rules and the content-security
 * policy all had to agree, and when any one of them did not the browser
 * silently showed the placeholder. Fetching the image here and serving it
 * from our own origin removes every one of those failure points, keeps
 * members' browsers from talking to third parties, and lets Cloudflare's
 * cache absorb the traffic.
 *
 * Public (share pages show covers to anonymous visitors), rate limited per
 * IP, images only, 2 MB cap, cached for 30 days.
 */
export const coverRoutes = new Hono<AppEnv>();

const MAX_BYTES = 2_000_000;
const CACHE_SECONDS = 60 * 60 * 24 * 30;

function upstreamUrl(raw: string | undefined): URL {
  if (!raw) throw badRequest("Missing cover URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("Invalid cover URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw badRequest("Invalid cover URL");
  // Never proxy ourselves or bare IP addresses.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) || url.hostname.includes(":") || url.hostname === "localhost") {
    throw badRequest("Invalid cover URL");
  }
  return url;
}

coverRoutes.get("/", async (c) => {
  const upstream = upstreamUrl(c.req.query("u"));
  if (new URL(c.req.url).hostname === upstream.hostname) throw badRequest("Invalid cover URL");
  await enforceRateLimit(c.env, "covers", clientIp(c.req.raw) ?? "unknown", { window: 60, max: 240 });

  const cacheKey = new Request(`https://covers.chapterr.internal/${encodeURIComponent(upstream.toString())}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      redirect: "follow",
      headers: { Accept: "image/*", "User-Agent": `Chapterr/1.0 (+${c.env.PUBLIC_APP_URL})` },
      signal: AbortSignal.timeout(8000),
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
  } catch {
    throw notFound("Cover not available");
  }
  const type = res.headers.get("content-type") ?? "";
  const length = Number(res.headers.get("content-length") ?? "0");
  if (!res.ok || !type.startsWith("image/") || length > MAX_BYTES) throw notFound("Cover not available");

  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES || body.byteLength === 0) throw notFound("Cover not available");

  const out = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": type.split(";")[0]!.trim(),
      "Content-Length": String(body.byteLength),
      "Cache-Control": `public, max-age=${CACHE_SECONDS}, immutable`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
});
