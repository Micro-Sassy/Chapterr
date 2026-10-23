import { Hono } from "hono";
import { z } from "zod";
import {
  avatarUploadSchema,
  idSchema,
  changeEmailSchema,
  changePasswordSchema,
  changeUsernameSchema,
  notificationPreferencesSchema,
  phoneSchema,
  profileUpdateSchema,
  pushPreferencesSchema,
} from "../../shared/schemas";
import { LIMITS } from "../../shared/constants";
import type { AccountContact, Me, NotificationPreferences, PushPreferences, SessionInfo } from "../../shared/types";
import { getAuth } from "../auth/auth";
import type { AppEnv } from "../env";
import { all, bool, first, run } from "../lib/db";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { confirmPassword } from "../lib/confirm";
import { parseBody } from "../lib/http";
import { base64ToBytes, nowIso } from "../lib/util";
import { disconnectSession, disconnectUser } from "../realtime/publish";
import { enforceRateLimit } from "../security/rate-limit";
import { loadClubSummaries } from "./clubs";

export const accountRoutes = new Hono<AppEnv>();

interface ProfileRow {
  bio: string | null;
  location: string | null;
  pronouns: string | null;
  favorite_genres: string | null;
  default_visibility: "private" | "club";
  last_club_id: string | null;
  phone: string | null;
  sms_opt_in: number;
}

interface PrefRow {
  inapp_direct_messages: number;
  inapp_recommendations: number;
  inapp_club_updates: number;
  inapp_reactions: number;
  email_club_updates: number;
  email_recommendations: number;
  // Feature wave 2 channels (migration 0003)
  push_enabled: number;
  push_meeting_reminders: number;
  push_mentions: number;
  email_meeting_reminders: number;
  sms_meeting_reminders: number;
  digest_catch_up: number;
}

/** Me with the wave 2 additions: phone / SMS opt-in and the push, reminder and digest channels. */
export type MeResponse = Me & AccountContact & { preferences: NotificationPreferences & PushPreferences };

export function mapPrefs(row: PrefRow | null): NotificationPreferences & PushPreferences {
  return {
    inappDirectMessages: row ? bool(row.inapp_direct_messages) : true,
    inappRecommendations: row ? bool(row.inapp_recommendations) : true,
    inappClubUpdates: row ? bool(row.inapp_club_updates) : true,
    inappReactions: row ? bool(row.inapp_reactions) : true,
    emailClubUpdates: row ? bool(row.email_club_updates) : false,
    emailRecommendations: row ? bool(row.email_recommendations) : false,
    pushEnabled: row ? bool(row.push_enabled) : true,
    pushMeetingReminders: row ? bool(row.push_meeting_reminders) : true,
    pushMentions: row ? bool(row.push_mentions) : true,
    emailMeetingReminders: row ? bool(row.email_meeting_reminders) : true,
    smsMeetingReminders: row ? bool(row.sms_meeting_reminders) : false,
    digestCatchUp: row ? bool(row.digest_catch_up) : true,
  };
}

async function loadMe(db: D1Database, userId: string): Promise<MeResponse> {
  const u = await first<{ id: string; username: string; name: string; email: string; emailVerified: number; image: string | null; createdAt: string }>(
    db,
    'SELECT id, username, name, email, "emailVerified", image, "createdAt" FROM "user" WHERE id = ?',
    userId,
  );
  if (!u) throw notFound("Account not found");
  const [p, prefs, clubs] = await Promise.all([
    first<ProfileRow>(db, "SELECT bio, location, pronouns, favorite_genres, default_visibility, last_club_id, phone, sms_opt_in FROM profiles WHERE user_id = ?", userId),
    first<PrefRow>(db, "SELECT * FROM notification_preferences WHERE user_id = ?", userId),
    loadClubSummaries(db, userId),
  ]);
  const lastClubId = p?.last_club_id && clubs.some((club) => club.id === p.last_club_id) ? p.last_club_id : null;
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
    clubs,
    lastClubId,
    phone: p?.phone ?? null,
    smsOptIn: p ? bool(p.sms_opt_in) : false,
  };
}

function authErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: { message?: string } }).body;
    if (body?.message) return body.message;
  }
  return fallback;
}

accountRoutes.get("/me", async (c) => c.json(await loadMe(c.env.DB, c.get("user").id)));

/** Remember the club to open next time the app starts. */
accountRoutes.put("/last-club", async (c) => {
  const user = c.get("user");
  const { clubId } = await parseBody(c, z.object({ clubId: idSchema }));
  const member = await first<{ n: number }>(
    c.env.DB,
    "SELECT 1 AS n FROM club_members m JOIN clubs c ON c.id = m.club_id AND c.archived_at IS NULL WHERE m.club_id = ? AND m.user_id = ?",
    clubId,
    user.id,
  );
  if (!member) throw notFound("Club not found");
  await run(c.env.DB, "UPDATE profiles SET last_club_id = ?, updated_at = ? WHERE user_id = ?", clubId, nowIso(), user.id);
  return c.json({ ok: true, lastClubId: clubId });
});

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
    c.executionCtx.waitUntil(Promise.all(previousSessions.map((s) => disconnectSession(c.env, user.id, s.id))));
  }
  // Forward the replacement session cookie so this device stays signed in.
  for (const cookie of authHeaders.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
  return c.json({ ok: true });
});

accountRoutes.put("/preferences", async (c) => {
  const user = c.get("user");
  const p = await parseBody(c, notificationPreferencesSchema.extend(pushPreferencesSchema.shape));
  // Wave 2 channels are optional in the body; absent keys keep their stored value (or the default).
  const current = (await first<PrefRow>(c.env.DB, "SELECT * FROM notification_preferences WHERE user_id = ?", user.id)) ?? null;
  const cur = mapPrefs(current);
  const pick = (v: boolean | undefined, fallback: boolean) => Number(v ?? fallback);
  await run(
    c.env.DB,
    `INSERT INTO notification_preferences (user_id, inapp_direct_messages, inapp_recommendations, inapp_club_updates, inapp_reactions,
       email_club_updates, email_recommendations, push_enabled, push_meeting_reminders, push_mentions, email_meeting_reminders,
       sms_meeting_reminders, digest_catch_up, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET inapp_direct_messages = excluded.inapp_direct_messages,
       inapp_recommendations = excluded.inapp_recommendations, inapp_club_updates = excluded.inapp_club_updates,
       inapp_reactions = excluded.inapp_reactions, email_club_updates = excluded.email_club_updates,
       email_recommendations = excluded.email_recommendations, push_enabled = excluded.push_enabled,
       push_meeting_reminders = excluded.push_meeting_reminders, push_mentions = excluded.push_mentions,
       email_meeting_reminders = excluded.email_meeting_reminders, sms_meeting_reminders = excluded.sms_meeting_reminders,
       digest_catch_up = excluded.digest_catch_up, updated_at = excluded.updated_at`,
    user.id,
    Number(p.inappDirectMessages),
    Number(p.inappRecommendations),
    Number(p.inappClubUpdates),
    Number(p.inappReactions),
    Number(p.emailClubUpdates),
    Number(p.emailRecommendations),
    pick(p.pushEnabled, cur.pushEnabled),
    pick(p.pushMeetingReminders, cur.pushMeetingReminders),
    pick(p.pushMentions, cur.pushMentions),
    pick(p.emailMeetingReminders, cur.emailMeetingReminders),
    pick(p.smsMeetingReminders, cur.smsMeetingReminders),
    pick(p.digestCatchUp, cur.digestCatchUp),
    nowIso(),
  );
  return c.json(await loadMe(c.env.DB, user.id));
});

/** Phone number (E.164) and SMS opt-in for meeting reminders. Opting in without a number is rejected. */
accountRoutes.put("/phone", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, phoneSchema);
  if (input.smsOptIn && !input.phone) throw badRequest("Add a phone number to receive texts", { phone: ["Required to opt in"] });
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO profiles (user_id, phone, sms_opt_in, privacy_accepted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET phone = excluded.phone, sms_opt_in = excluded.sms_opt_in, updated_at = excluded.updated_at`,
    user.id,
    input.phone,
    input.phone && input.smsOptIn ? 1 : 0,
    now,
    now,
    now,
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
  c.executionCtx.waitUntil(disconnectSession(c.env, user.id, id));
  return c.json({ ok: true });
});

accountRoutes.post("/sessions/revoke-others", async (c) => {
  const user = c.get("user");
  const current = c.get("session");
  const others = await all<{ id: string }>(c.env.DB, 'SELECT id FROM "session" WHERE "userId" = ? AND id <> ?', user.id, current.id);
  await run(c.env.DB, 'DELETE FROM "session" WHERE "userId" = ? AND id <> ?', user.id, current.id);
  c.executionCtx.waitUntil(Promise.all(others.map((s) => disconnectSession(c.env, user.id, s.id))));
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
  c.header("Content-Disposition", `attachment; filename="chapterr-export-${user.username ?? user.id}.json"`);
  return c.json({ exportedAt: nowIso(), account: me, library, reviews, quotes, goals, recommendations, messages });
});

accountRoutes.post("/delete", async (c) => {
  const user = c.get("user");
  const { password } = await parseBody(c, z.object({ password: z.string().min(1).max(128), confirm: z.literal("DELETE") }));
  await confirmPassword(c, user.id, password);
  // A club must not lose its owner: clubs owned alone are archived with the account;
  // clubs with other members need a new owner first.
  const owned = await all<{ id: string; members: number }>(
    c.env.DB,
    `SELECT c.id, (SELECT COUNT(*) FROM club_members x WHERE x.club_id = c.id) AS members
       FROM clubs c JOIN club_members m ON m.club_id = c.id AND m.user_id = ? AND m.role = 'owner' WHERE c.archived_at IS NULL`,
    user.id,
  );
  if (owned.some((club) => Number(club.members) > 1)) {
    throw new ApiError(409, "owns_clubs", "You own a club that still has other members. Transfer ownership or delete the club first.");
  }
  const now = nowIso();
  if (owned.length) {
    await c.env.DB.batch(owned.map((club) => c.env.DB.prepare("UPDATE clubs SET archived_at = ?, updated_at = ? WHERE id = ?").bind(now, now, club.id)));
  }
  await disconnectUser(c.env, user.id).catch(() => undefined);
  // Personal data cascades via foreign keys; shared club records keep their content with the author cleared.
  await getAuth(c.env).api.deleteUser({ body: { password }, headers: c.req.raw.headers });
  return c.json({ ok: true });
});
