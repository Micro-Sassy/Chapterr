import { Hono } from "hono";
import { pushSubscribeSchema, pushUnsubscribeSchema } from "../../shared/schemas";
import type { PushPublicKey, PushSubscriptionInfo } from "../../shared/types";
import type { AppEnv } from "../env";
import { all, first, run } from "../lib/db";
import { ApiError, notFound } from "../lib/errors";
import { parseBody } from "../lib/http";
import { newId, nowIso } from "../lib/util";
import { fromBase64Url, sendPush, vapidConfigured } from "../lib/webpush";
import { enforceRateLimit } from "../security/rate-limit";

/**
 * Web Push subscriptions (personal, /api/push). The browser subscribes with
 * the VAPID public key and posts the resulting PushSubscription here.
 */
export const pushRoutes = new Hono<AppEnv>();

function requireVapid(env: AppEnv["Bindings"]): void {
  if (!vapidConfigured(env)) throw new ApiError(404, "push_unavailable", "Push notifications are not enabled on this server.");
}

/** The applicationServerKey for PushManager.subscribe (base64url). */
pushRoutes.get("/public-key", (c) => {
  requireVapid(c.env);
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY!.trim() } satisfies PushPublicKey);
});

interface SubRow {
  id: string;
  endpoint: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
}

const mapSub = (r: SubRow): PushSubscriptionInfo => ({
  id: r.id,
  endpoint: r.endpoint,
  userAgent: r.user_agent,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
});

pushRoutes.get("/subscriptions", async (c) => {
  const rows = await all<SubRow>(
    c.env.DB,
    "SELECT id, endpoint, user_agent, created_at, last_used_at FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC",
    c.get("user").id,
  );
  return c.json(rows.map(mapSub) satisfies PushSubscriptionInfo[]);
});

/** Store (or re-own) a subscription. The endpoint is unique: a browser re-subscribing after sign-out moves it to the new account. */
pushRoutes.post("/subscribe", async (c) => {
  const user = c.get("user");
  requireVapid(c.env);
  await enforceRateLimit(c.env, "push-subscribe", user.id, { window: 60 * 60, max: 20 });
  const input = await parseBody(c, pushSubscribeSchema);
  const endpointUrl = new URL(input.endpoint);
  if (endpointUrl.protocol !== "https:") throw new ApiError(422, "validation_error", "Push endpoints must use https", { fields: { endpoint: ["Must be https"] } });
  try {
    if (fromBase64Url(input.keys.p256dh).byteLength !== 65 || fromBase64Url(input.keys.auth).byteLength !== 16) throw new Error("bad length");
  } catch {
    throw new ApiError(422, "validation_error", "The subscription keys are not valid", { fields: { keys: ["Invalid p256dh or auth"] } });
  }
  const now = nowIso();
  const userAgent = input.userAgent ?? c.req.header("user-agent")?.slice(0, 200) ?? null;
  const id = newId();
  await run(
    c.env.DB,
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, failures) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       user_agent = excluded.user_agent, failures = 0`,
    id,
    user.id,
    input.endpoint,
    input.keys.p256dh,
    input.keys.auth,
    userAgent,
    now,
  );
  const row = await first<SubRow>(c.env.DB, "SELECT id, endpoint, user_agent, created_at, last_used_at FROM push_subscriptions WHERE endpoint = ?", input.endpoint);
  return c.json(mapSub(row!) satisfies PushSubscriptionInfo, 201);
});

pushRoutes.delete("/subscribe", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, pushUnsubscribeSchema);
  const res = await run(c.env.DB, "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", user.id, input.endpoint);
  if (res.meta.changes === 0) throw notFound("Subscription not found");
  return c.json({ ok: true });
});

/** Send a test notification to the caller's own devices (handy from the settings page). */
pushRoutes.post("/test", async (c) => {
  const user = c.get("user");
  requireVapid(c.env);
  await enforceRateLimit(c.env, "push-test", user.id, { window: 60 * 60, max: 5 });
  const result = await sendPush(c.env, user.id, {
    title: "Chapterr",
    body: "Push notifications are working on this device.",
    url: "/settings",
    tag: "test",
  });
  return c.json(result);
});
