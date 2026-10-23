import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { APP_NAME, CLUB_PRICE_CENTS } from "../shared/constants";
import type { ApiErrorBody, PublicConfig } from "../shared/types";
import type { AppEnv, Env } from "./env";
import { isProduction } from "./env";
import { requireClubMember } from "./lib/club";
import { all, first } from "./lib/db";
import { ApiError } from "./lib/errors";
import { requireUser } from "./lib/session";
import { accountRoutes } from "./routes/account";
import { authRoutes } from "./routes/auth-guard";
import { bookRoutes } from "./routes/books";
import { clubRoutes } from "./routes/club";
import { clubAdminRoutes, clubsRoutes, invitePreview } from "./routes/clubs";
import { bookGenreRoutes, genreRoutes } from "./routes/genres";
import { clubHomeRoutes, homeRoutes } from "./routes/home";
import { importRoutes } from "./routes/imports";
import { memberRoutes } from "./routes/members";
import { conversationRoutes, messageRoutes, realtimeUpgrade } from "./routes/messages";
import { notificationRoutes } from "./routes/notifications";
import { clubQuoteRoutes, clubReviewRoutes, goalRoutes, libraryRoutes, quoteRoutes, recommendationRoutes, reviewRoutes } from "./routes/personal";
import { coverRoutes } from "./routes/covers";
import { publicRoutes, shareRoutes } from "./routes/shares";
import { purgeRateLimits } from "./security/rate-limit";
import { requireHttps, sameOriginGuard, securityHeaders } from "./security/headers";

export { ClubRealtime } from "./realtime/ClubRealtime";

const app = new Hono<AppEnv>();

app.use("*", requireHttps);
app.use("*", securityHeaders);
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 2 * 1024 * 1024,
    onError: (c) => c.json({ error: { code: "payload_too_large", message: "Request is too large" } } satisfies ApiErrorBody, 413),
  }),
);
app.use("/api/*", sameOriginGuard);

// --- Public, unauthenticated endpoints -----------------------------------------
app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/config", (c) => {
  const config: PublicConfig = {
    appName: c.env.APP_NAME || APP_NAME,
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
    environment: c.env.APP_ENV,
    googleBooksEnabled: !!c.env.GOOGLE_BOOKS_API_KEY,
    marketingUrl: c.env.MARKETING_URL || "https://chapterr.io",
    billingEnabled: false,
    clubPriceCents: CLUB_PRICE_CENTS,
  };
  c.header("Cache-Control", "public, max-age=300");
  return c.json(config);
});

app.route("/api/auth", authRoutes);
app.route("/api/public", publicRoutes);
app.route("/api/public/covers", coverRoutes);
// Invite preview works signed out (the join page is where new members land).
app.get("/api/invites/:code", invitePreview);

/**
 * Development-only mailbox so local testers and E2E tests can open
 * verification/reset links without a real email provider. Unavailable in
 * production and whenever a real provider is configured.
 */
app.get("/api/dev/outbox", async (c) => {
  if (isProduction(c.env) || (c.env.EMAIL_PROVIDER ?? "").toLowerCase() !== "console") {
    return c.json({ error: { code: "not_found", message: "Not found" } } satisfies ApiErrorBody, 404);
  }
  const to = (c.req.query("to") ?? "").toLowerCase();
  const rows = await all(
    c.env.DB,
    "SELECT id, to_address, subject, text_body, created_at FROM dev_outbox WHERE to_address = ? ORDER BY created_at DESC LIMIT 20",
    to,
  );
  return c.json(rows);
});

// --- Everything below requires a signed-in, verified member ------------------------
const api = new Hono<AppEnv>();
api.use("*", requireUser);
api.route("/account", accountRoutes);
api.route("/members", memberRoutes);
api.route("/books", bookRoutes);
api.route("/library", libraryRoutes);
api.route("/reviews", reviewRoutes);
api.route("/quotes", quoteRoutes);
api.route("/goals", goalRoutes);
api.route("/shares", shareRoutes);
api.route("/notifications", notificationRoutes);
api.route("/imports", importRoutes);
api.route("/", homeRoutes);

// Club list / create / join (no club context). Registered before the
// club-scoped router so POST /clubs/join is never read as a club id.
api.route("/clubs", clubsRoutes);

// --- Club scope: /api/clubs/:clubId/* — membership is checked once, here ---------
const club = new Hono<AppEnv>();
club.use("*", requireClubMember);
club.get("/realtime", realtimeUpgrade);
club.route("/", clubAdminRoutes);
club.route("/", clubRoutes);
club.route("/", clubHomeRoutes);
club.route("/genres", genreRoutes);
club.route("/works", bookGenreRoutes);
club.route("/reviews", clubReviewRoutes);
club.route("/quotes", clubQuoteRoutes);
club.route("/recommendations", recommendationRoutes);
club.route("/conversations", conversationRoutes);
club.route("/messages", messageRoutes);
api.route("/clubs/:clubId", club);

api.get("/avatars/:userId", async (c) => {
  const row = await first<{ content_type: string; data: ArrayBuffer }>(
    c.env.DB,
    "SELECT content_type, data FROM avatars WHERE user_id = ?",
    c.req.param("userId"),
  );
  if (!row) return c.json({ error: { code: "not_found", message: "No avatar" } } satisfies ApiErrorBody, 404);
  return new Response(row.data, {
    headers: {
      "Content-Type": row.content_type,
      // Private: avatars are only served to signed-in members. URLs are versioned (?v=n).
      "Cache-Control": "private, max-age=604800, immutable",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
});

app.route("/api", api);

app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "Not found" } } satisfies ApiErrorBody, 404));

// Non-API paths fall through to the static SPA (normally handled before the Worker runs).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    if (err.status === 429) c.header("Retry-After", "60");
    return c.json({ error: { code: err.code, message: err.message, ...err.extra } } satisfies ApiErrorBody, err.status);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { code: "http_error", message: err.message || "Request failed" } } satisfies ApiErrorBody, err.status);
  }
  console.error("Unhandled error", c.req.method, c.req.path, err instanceof Error ? (err.stack ?? err.message) : err);
  return c.json({ error: { code: "server_error", message: "Something went wrong. Please try again." } } satisfies ApiErrorBody, 500);
});

const DAY = 86400_000;

/** Daily housekeeping (cron trigger in wrangler.jsonc). Exported for tests. */
export async function runHousekeeping(env: Env, now = new Date()): Promise<void> {
  const iso = now.toISOString();
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  await purgeRateLimits(env.DB);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM "verification" WHERE "expiresAt" < ?').bind(iso),
    env.DB.prepare('DELETE FROM "session" WHERE "expiresAt" < ?').bind(iso),
    env.DB.prepare("DELETE FROM dev_outbox WHERE created_at < ?").bind(ago(7)),
    // Expired share links (and links revoked more than 30 days ago).
    env.DB.prepare("DELETE FROM share_links WHERE (expires_at IS NOT NULL AND expires_at < ?) OR (revoked_at IS NOT NULL AND revoked_at < ?)").bind(iso, ago(30)),
    env.DB.prepare("DELETE FROM imports WHERE created_at < ?").bind(ago(30)),
    // Archived clubs are purged after 30 days; every club table cascades from clubs.
    env.DB.prepare("DELETE FROM clubs WHERE archived_at IS NOT NULL AND archived_at < ?").bind(ago(30)),
    env.DB.prepare("DELETE FROM notifications WHERE created_at < ?").bind(ago(90)),
  ]);
}

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runHousekeeping(env));
  },
} satisfies ExportedHandler<Env>;

export { app };
