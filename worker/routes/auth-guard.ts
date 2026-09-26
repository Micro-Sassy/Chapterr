import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { displayNameSchema, emailSchema, passwordSchema, usernameSchema } from "../../shared/schemas";
import { getAuth } from "../auth/auth";
import type { AppEnv } from "../env";
import { first } from "../lib/db";
import { ApiError } from "../lib/errors";
import { parseWith } from "../lib/http";
import { disconnectSession } from "../realtime/publish";
import { enforceRateLimit } from "../security/rate-limit";
import { clientIp, requireTurnstile } from "../security/turnstile";

/**
 * Only these Better Auth endpoints are reachable from the browser. Anything
 * else (social sign-in, direct update-user/change-email/delete-user which
 * would bypass the current-password check) returns 404. Sensitive account
 * changes go through /api/account instead.
 */
const ALLOWED = new Set([
  "GET /get-session",
  "POST /sign-in/email",
  "POST /sign-in/username",
  "POST /sign-up/email",
  "POST /sign-out",
  "GET /verify-email",
  "POST /send-verification-email",
  "POST /request-password-reset",
  "GET /reset-password/:token",
  "POST /reset-password",
  "POST /is-username-available",
  "GET /ok",
  "GET /error",
]);

const TURNSTILE_PATHS = new Set([
  "/sign-up/email",
  "/sign-in/email",
  "/sign-in/username",
  "/request-password-reset",
  "/send-verification-email",
]);

const signUpBody = z.object({
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema,
  acceptPrivacy: z.literal(true, { error: "Please accept the privacy and use notice" }),
});
const signInEmailBody = z.object({ email: emailSchema, password: z.string().min(1).max(128), rememberMe: z.boolean().optional() });
const signInUsernameBody = z.object({ username: z.string().trim().min(1).max(254), password: z.string().min(1).max(128), rememberMe: z.boolean().optional() });
const emailOnlyBody = z.object({ email: emailSchema });
const resetBody = z.object({ newPassword: passwordSchema, token: z.string().min(1).max(512) });

function routeKey(method: string, path: string): string {
  const p = path.startsWith("/reset-password/") ? "/reset-password/:token" : path;
  return `${method} ${p}`;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.clone().json();
  } catch {
    throw new ApiError(400, "bad_request", "Request body must be valid JSON");
  }
}

function withBody(req: Request, body: unknown): Request {
  const headers = new Headers(req.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return new Request(req.url, { method: req.method, headers, body: JSON.stringify(body) });
}

const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = c.env;
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/^\/api\/auth/, "") || "/";
  const method = c.req.method.toUpperCase();
  if (!ALLOWED.has(routeKey(method, path))) {
    return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
  }
  const ip = clientIp(c.req.raw);
  const base = env.PUBLIC_APP_URL.replace(/\/+$/, "");
  let request = c.req.raw;

  if (TURNSTILE_PATHS.has(path)) {
    await requireTurnstile(env, c.req.header("x-turnstile-token"), ip);
  }

  switch (path) {
    case "/sign-up/email": {
      const body = parseWith(signUpBody, await readJson(request));
      // Rebuild the body so only expected fields reach Better Auth.
      request = withBody(request, {
        name: body.name,
        email: body.email,
        password: body.password,
        username: body.username,
        callbackURL: `${base}/verified`,
      });
      break;
    }
    case "/sign-in/email": {
      const body = parseWith(signInEmailBody, await readJson(request));
      await enforceRateLimit(env, "login-id", body.email, { window: 15 * 60, max: 20 });
      request = withBody(request, { email: body.email, password: body.password, rememberMe: body.rememberMe ?? true, callbackURL: `${base}/verified` });
      break;
    }
    case "/sign-in/username": {
      const body = parseWith(signInUsernameBody, await readJson(request));
      await enforceRateLimit(env, "login-id", body.username, { window: 15 * 60, max: 20 });
      request = withBody(request, { username: body.username.toLowerCase(), password: body.password, rememberMe: body.rememberMe ?? true });
      break;
    }
    case "/request-password-reset": {
      const body = parseWith(emailOnlyBody, await readJson(request));
      await enforceRateLimit(env, "reset-id", body.email, { window: 60 * 60, max: 3 });
      request = withBody(request, { email: body.email, redirectTo: `${base}/reset-password` });
      break;
    }
    case "/send-verification-email": {
      const body = parseWith(emailOnlyBody, await readJson(request));
      await enforceRateLimit(env, "verify-id", body.email, { window: 60 * 60, max: 3 });
      request = withBody(request, { email: body.email, callbackURL: `${base}/verified` });
      break;
    }
    case "/reset-password": {
      if (method === "POST") {
        const body = parseWith(resetBody, await readJson(request));
        request = withBody(request, body);
      }
      break;
    }
    case "/sign-out": {
      // Close realtime sockets for the session that is ending.
      const session = await getAuth(env).api.getSession({ headers: c.req.raw.headers });
      if (session) c.executionCtx.waitUntil(disconnectSession(env, session.session.id));
      break;
    }
  }

  c.set("authRequest", request);
  return next();
};

export const authRoutes = new Hono<AppEnv>();

authRoutes.use("*", guard);
authRoutes.all("*", async (c) => {
  const request = c.get("authRequest") ?? c.req.raw;
  const res = await getAuth(c.env).handler(request);
  return res;
});

/** Look up the owner of a session by id — used when revoking a specific session. */
export async function sessionOwner(db: D1Database, sessionId: string): Promise<{ userId: string; token: string } | null> {
  return first<{ userId: string; token: string }>(db, 'SELECT "userId", token FROM "session" WHERE id = ?', sessionId);
}
