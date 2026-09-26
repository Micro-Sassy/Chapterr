import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { ApiErrorBody, PublicConfig } from "../shared/types";
import type { AppEnv, Env } from "./env";
import { isProduction } from "./env";
import { all, first } from "./lib/db";
import { ApiError } from "./lib/errors";
import { requireUser } from "./lib/session";
import { accountRoutes } from "./routes/account";
import { authRoutes } from "./routes/auth-guard";
import { bookRoutes } from "./routes/books";
import { clubRoutes } from "./routes/club";
import { dashboardRoutes } from "./routes/dashboard";
import { genreRoutes } from "./routes/genres";
import { importRoutes } from "./routes/imports";
import { memberRoutes } from "./routes/members";
import { conversationRoutes, messageRoutes, realtimeUpgrade } from "./routes/messages";
import { notificationRoutes } from "./routes/notifications";
import { goalRoutes, libraryRoutes, quoteRoutes, recommendationRoutes, reviewRoutes } from "./routes/personal";
import { publicRoutes, shareRoutes } from "./routes/shares";
import { purgeRateLimits } from "./security/rate-limit";
import { sameOriginGuard, securityHeaders } from "./security/headers";

export { ClubRealtime } from "./realtime/ClubRealtime";

const app = new Hono<AppEnv>();

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
    appName: c.env.APP_NAME || "Teel Ridge Book Club",
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
    environment: c.env.APP_ENV,
    googleBooksEnabled: !!c.env.GOOGLE_BOOKS_API_KEY,
  };
  c.header("Cache-Control", "public, max-age=300");
  return c.json(config);
});

app.route("/api/auth", authRoutes);
app.route("/api/public", publicRoutes);

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
api.get("/realtime", realtimeUpgrade);
api.route("/account", accountRoutes);
api.route("/members", memberRoutes);
api.route("/books", bookRoutes);
api.route("/genres", genreRoutes);
api.route("/library", libraryRoutes);
api.route("/reviews", reviewRoutes);
api.route("/quotes", quoteRoutes);
api.route("/goals", goalRoutes);
api.route("/recommendations", recommendationRoutes);
api.route("/club", clubRoutes);
api.route("/conversations", conversationRoutes);
api.route("/messages", messageRoutes);
api.route("/shares", shareRoutes);
api.route("/notifications", notificationRoutes);
api.route("/imports", importRoutes);
api.route("/", dashboardRoutes);

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

export default {
  fetch: app.fetch,
  /** Optional daily housekeeping (enable with a cron trigger, see README). */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      Promise.all([
        purgeRateLimits(env.DB),
        env.DB.prepare('DELETE FROM "verification" WHERE "expiresAt" < ?').bind(new Date().toISOString()).run(),
        env.DB.prepare('DELETE FROM "session" WHERE "expiresAt" < ?').bind(new Date().toISOString()).run(),
        env.DB.prepare("DELETE FROM dev_outbox WHERE created_at < ?").bind(new Date(Date.now() - 7 * 86400_000).toISOString()).run(),
        env.DB.prepare("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?")
          .bind(new Date(Date.now() - 180 * 86400_000).toISOString())
          .run(),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;

export { app };
