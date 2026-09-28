import { Hono } from "hono";
import { z } from "zod";
import {
  avatarUploadSchema,
  changeEmailSchema,
  changePasswordSchema,
  changeUsernameSchema,
  notificationPreferencesSchema,
  profileUpdateSchema,
} from "../../shared/schemas";
import { LIMITS } from "../../shared/constants";
import type { Me, NotificationPreferences, SessionInfo } from "../../shared/types";
import { getAuth } from "../auth/auth";
import type { AppEnv } from "../env";
import { all, bool, first, run } from "../lib/db";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { parseBody } from "../lib/http";
import { base64ToBytes, nowIso } from "../lib/util";
import { disconnectSession, disconnectUser } from "../realtime/publish";
import { enforceRateLimit } from "../security/rate-limit";

export const accountRoutes = new Hono<AppEnv>();

interface ProfileRow {
  bio: string | null;
  location: string | null;
  pronouns: string | null;
  favorite_genres: string | null;
  default_visibility: "private" | "club";
}

interface PrefRow {
  inapp_direct_messages: number;
  inapp_recommendations: number;
  inapp_club_updates: number;
  inapp_reactions: number;
  email_club_updates: number;
  email_recommendations: number;
}

export function mapPrefs(row: PrefRow | null): NotificationPreferences {
  return {
    inappDirectMessages: row ? bool(row.inapp_direct_messages) : true,
    inappRecommendations: row ? bool(row.inapp_recommendations) : true,
    inappClubUpdates: row ? bool(row.inapp_club_updates) : true,
    inappReactions: row ? bool(row.inapp_reactions) : true,
    emailClubUpdates: row ? bool(row.email_club_updates) : false,
    emailRecommendations: row ? bool(row.email_recommendations) : false,
  };
}

async function loadMe(db: D1Database, userId: string): Promise<Me> {
  const u = await first<{ id: string; username: string; name: string; email: string; emailVerified: number; image: string | null; createdAt: string }>(
    db,
    'SELECT id, username, name, email, "emailVerified", image, "createdAt" FROM "user" WHERE id = ?',
    userId,
  );
  if (!u) throw notFound("Account not found");
  const p = await first<ProfileRow>(db, "SELECT bio, location, pronouns, favorite_genres, default_visibility FROM profiles WHERE user_id = ?", userId);
  const prefs = await first<PrefRow>(db, "SELECT * FROM notification_preferences WHERE user_id = ?", userId);
  return {
    id: u.id,
    username: u.username,
    displayName: u.name,
    email: u.email,
    emailVerified: bool(u.emailVerified),
    avatarUrl: u.image,
    createdAt: u.createdAt,
    profile: {
      bio: p?.bio ?? null,
      location: p?.location ?? null,
      pronouns: p?.pronouns ?? null,
      favoriteGenres: p?.favorite_genres ?? null,
      defaultVisibility: p?.default_visibility ?? "club",
    },
    preferences: mapPrefs(prefs),
  };
}

/** Re-check the member's current password before a sensitive change. */
async function confirmPassword(c: { env: AppEnv["Bindings"]; req: { raw: Request } }, userId: string, password: string) {
  await enforceRateLimit(c.env, "password-confirm", userId, { window: 15 * 60, max: 10 });
  try {
    await getAuth(c.env).api.verifyPassword({ body: { password }, headers: c.req.raw.headers });
  } catch {
    throw new ApiError(400, "invalid_password", "Your current password is incorrect", { fields: { currentPassword: ["Incorrect password"] } });
  }
}

function authErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: { message?: string } }).body;
    if (body?.message) return body.message;
  }
  return fallback;
}

accountRoutes.get("/me", async (c) => c.json(await loadMe(c.env.DB, c.get("user").id)));

accountRoutes.put("/profile", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, profileUpdateSchema);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE "user" SET name = ?, "updatedAt" = ? WHERE id = ?').bind(input.displayName, now, user.id),
    c.env.DB.prepare(
      `INSERT INTO profiles (user_id, bio, location, pronouns, favorite_genres, default_visibility, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET bio = excluded.bio, location = excluded.location, pronouns = excluded.pronouns,
         favorite_genres = excluded.favorite_genres, default_visibility = excluded.default_visibility, updated_at = excluded.updated_at`,
    ).bind(user.id, input.bio, input.location, input.pronouns, input.favoriteGenres, input.defaultVisibility, now, now, now),
  ]);
  return c.json(await loadMe(c.env.DB, user.id));
});

accountRoutes.put("/username", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, changeUsernameSchema);
  await confirmPassword(c, user.id, input.currentPassword);
  const taken = await first<{ id: string }>(c.env.DB, 'SELECT id FROM "user" WHERE username = ? COLLATE NOCASE AND id <> ?', input.username, user.id);
  if (taken) throw new ApiError(409, "username_taken", "That username is already taken", { fields: { username: ["Already taken"] } });
  try {
    await getAuth(c.env).api.updateUser({ body: { username: input.username, displayUsername: input.username }, headers: c.req.raw.headers });
  } catch (err) {
    throw badRequest(authErrorMessage(err, "Could not change username"));
  }
  return c.json(await loadMe(c.env.DB, user.id));
});

accountRoutes.post("/email", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, changeEmailSchema);
  await confirmPassword(c, user.id, input.currentPassword);
  await enforceRateLimit(c.env, "change-email", user.id, { window: 60 * 60, max: 5 });
  if (input.newEmail === user.email) throw badRequest("That is already your email address", { newEmail: ["Same as current email"] });
  try {
    await getAuth(c.env).api.changeEmail({
      body: { newEmail: input.newEmail, callbackURL: "/settings?tab=account&emailChanged=1" },
      headers: c.req.raw.headers,
    });
  } catch (err) {
    throw badRequest(authErrorMessage(err, "Could not start the email change"));
  }
  // Generic response: does not reveal whether the address belongs to someone else.
  return c.json({ ok: true, message: "If that address can be used, a confirmation link has been sent to it." });
});

accountRoutes.post("/password", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, changePasswordSchema);
  await enforceRateLimit(c.env, "change-password", user.id, { window: 15 * 60, max: 10 });
  // With revokeOtherSessions Better Auth replaces *every* session (this one
  // included) with a fresh one, so remember them all to close their sockets.
  const previousSessions = await all<{ id: string }>(c.env.DB, 'SELECT id FROM "session" WHERE "userId" = ?', user.id);
  let authHeaders: Headers;
  try {
    const result = await getAuth(c.env).api.changePassword({
      body: { currentPassword: input.currentPassword, newPassword: input.newPassword, revokeOtherSessions: input.revokeOtherSessions },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    authHeaders = result.headers;
  } catch (err) {
    const msg = authErrorMessage(err, "Could not change password");
    throw new ApiError(400, "invalid_password", msg, /password/i.test(msg) ? { fields: { currentPassword: [msg] } } : {});
  }
  if (input.revokeOtherSessions) {
    // Close realtime sockets that belonged to the now-revoked sessions; this
    // browser reconnects with its new session cookie.
    c.executionCtx.waitUntil(Promise.all(previousSessions.map((s) => disconnectSession(c.env, s.id))));
  }
  // Forward the replacement session cookie so this device stays signed in.
  for (const cookie of authHeaders.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
  return c.json({ ok: true });
});

accountRoutes.put("/preferences", async (c) => {
  const user = c.get("user");
  const p = await parseBody(c, notificationPreferencesSchema);
  await run(
    c.env.DB,
    `INSERT INTO notification_preferences (user_id, inapp_direct_messages, inapp_recommendations, inapp_club_updates, inapp_reactions,
       email_club_updates, email_recommendations, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET inapp_direct_messages = excluded.inapp_direct_messages,
       inapp_recommendations = excluded.inapp_recommendations, inapp_club_updates = excluded.inapp_club_updates,
       inapp_reactions = excluded.inapp_reactions, email_club_updates = excluded.email_club_updates,
       email_recommendations = excluded.email_recommendations, updated_at = excluded.updated_at`,
    user.id,
    Number(p.inappDirectMessages),
    Number(p.inappRecommendations),
    Number(p.inappClubUpdates),
    Number(p.inappReactions),
    Number(p.emailClubUpdates),
    Number(p.emailRecommendations),
    nowIso(),
  );
  return c.json(await loadMe(c.env.DB, user.id));
});

// --- Avatar (stored in D1 as a small, client-resized image) ------------------

const IMAGE_SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45,
};

accountRoutes.put("/avatar", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, avatarUploadSchema);
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(input.data);
  } catch {
    throw badRequest("Invalid image data");
  }
  if (bytes.length === 0 || bytes.length > LIMITS.avatarBytesMax) throw badRequest("Images must be smaller than 400 KB");
  if (!IMAGE_SIGNATURES[input.contentType]!(bytes)) throw badRequest("The file does not match its image type");
  const now = nowIso();
  const profile = await first<{ avatar_version: number }>(c.env.DB, "SELECT avatar_version FROM profiles WHERE user_id = ?", user.id);
  const version = (profile?.avatar_version ?? 0) + 1;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO avatars (user_id, content_type, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET content_type = excluded.content_type, data = excluded.data, updated_at = excluded.updated_at`,
    ).bind(user.id, input.contentType, bytes, now),
    c.env.DB.prepare("UPDATE profiles SET avatar_version = ?, updated_at = ? WHERE user_id = ?").bind(version, now, user.id),
    c.env.DB.prepare('UPDATE "user" SET image = ?, "updatedAt" = ? WHERE id = ?').bind(`/api/avatars/${user.id}?v=${version}`, now, user.id),
  ]);
  return c.json(await loadMe(c.env.DB, user.id));
});

accountRoutes.delete("/avatar", async (c) => {
  const user = c.get("user");
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM avatars WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare('UPDATE "user" SET image = NULL, "updatedAt" = ? WHERE id = ?').bind(now, user.id),
  ]);
  return c.json(await loadMe(c.env.DB, user.id));
});

// --- Sessions -------------------------------------------------------------------

accountRoutes.get("/sessions", async (c) => {
  const user = c.get("user");
  const current = c.get("session");
  const rows = await all<{ id: string; createdAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null }>(
    c.env.DB,
    'SELECT id, "createdAt", "expiresAt", "ipAddress", "userAgent" FROM "session" WHERE "userId" = ? AND "expiresAt" > ? ORDER BY "createdAt" DESC',
    user.id,
    nowIso(),
  );
  const sessions: SessionInfo[] = rows.map((r) => ({ ...r, current: r.id === current.id }));
  return c.json(sessions);
});

accountRoutes.delete("/sessions/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  // Scoped by user id: a member can only revoke their own sessions.
  const res = await run(c.env.DB, 'DELETE FROM "session" WHERE id = ? AND "userId" = ?', id, user.id);
  if (res.meta.changes === 0) throw notFound("Session not found");
  c.executionCtx.waitUntil(disconnectSession(c.env, id));
  return c.json({ ok: true });
});

accountRoutes.post("/sessions/revoke-others", async (c) => {
  const user = c.get("user");
  const current = c.get("session");
  const others = await all<{ id: string }>(c.env.DB, 'SELECT id FROM "session" WHERE "userId" = ? AND id <> ?', user.id, current.id);
  await run(c.env.DB, 'DELETE FROM "session" WHERE "userId" = ? AND id <> ?', user.id, current.id);
  c.executionCtx.waitUntil(Promise.all(others.map((s) => disconnectSession(c.env, s.id))));
  return c.json({ ok: true, revoked: others.length });
});

// --- Data export & account deletion ------------------------------------------------

accountRoutes.get("/export", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const [me, library, reviews, quotes, goals, recommendations, messages] = await Promise.all([
    loadMe(db, user.id),
    all(db, "SELECT ub.*, e.title, e.authors, e.isbn13 FROM user_books ub JOIN book_editions e ON e.id = ub.edition_id WHERE ub.user_id = ?", user.id),
    all(db, "SELECT r.*, e.title, e.isbn13 FROM reviews r JOIN book_editions e ON e.id = r.edition_id WHERE r.user_id = ?", user.id),
    all(db, "SELECT q.*, e.title, e.isbn13 FROM quotes q JOIN book_editions e ON e.id = q.edition_id WHERE q.user_id = ?", user.id),
    all(db, "SELECT year, target FROM personal_reading_goals WHERE user_id = ?", user.id),
    all(db, "SELECT r.*, e.title FROM recommendations r JOIN book_editions e ON e.id = r.edition_id WHERE r.user_id = ?", user.id),
    all(db, "SELECT id, conversation_id, body, created_at, edited_at, deleted_at FROM messages WHERE sender_id = ?", user.id),
  ]);
  c.header("Content-Disposition", `attachment; filename="teel-ridge-export-${user.username ?? user.id}.json"`);
  return c.json({ exportedAt: nowIso(), account: me, library, reviews, quotes, goals, recommendations, messages });
});

accountRoutes.post("/delete", async (c) => {
  const user = c.get("user");
  const { password } = await parseBody(c, z.object({ password: z.string().min(1).max(128), confirm: z.literal("DELETE") }));
  await confirmPassword(c, user.id, password);
  await disconnectUser(c.env, user.id).catch(() => undefined);
  // Personal data cascades via foreign keys; shared club records keep their content with the author cleared.
  await getAuth(c.env).api.deleteUser({ body: { password }, headers: c.req.raw.headers });
  return c.json({ ok: true });
});
