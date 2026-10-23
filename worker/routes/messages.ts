import { Hono, type Context } from "hono";
import { directConversationSchema, messageSchema } from "../../shared/schemas";
import type { Conversation, Message } from "../../shared/types";
import type { AppEnv } from "../env";
import { all, first, run } from "../lib/db";
import { ApiError, badRequest, forbidden, notFound } from "../lib/errors";
import { parseBody } from "../lib/http";
import { mapMember, mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { notifyUsers } from "../lib/notify";
import { makePage, pageQuery, timeCursor } from "../lib/paging";
import { newId, nowIso } from "../lib/util";
import { publish, realtimeStub } from "../realtime/publish";
import { enforceRateLimit } from "../security/rate-limit";

/**
 * Chats live inside a club (mounted at /api/clubs/:clubId behind
 * requireClubMember). The club conversation is readable by every member of
 * that club; a direct conversation only by its two participants, and a pair
 * of members has one direct conversation per club. Chats are never reachable
 * through share links (the share system has no message resource type,
 * enforced by a CHECK constraint).
 */
export const conversationRoutes = new Hono<AppEnv>();
export const messageRoutes = new Hono<AppEnv>();

interface ConversationRow {
  id: string;
  club_id: string;
  kind: "club" | "direct";
}

/** Throws 404 unless the user may read the conversation inside this club. Returns it plus the audience for realtime delivery. */
export async function authorizeConversation(
  db: D1Database,
  clubId: string,
  conversationId: string,
  userId: string,
): Promise<{ conv: ConversationRow; audience: string[] | "all" }> {
  const conv = await first<ConversationRow>(db, "SELECT id, club_id, kind FROM conversations WHERE id = ? AND club_id = ?", conversationId, clubId);
  if (!conv) throw notFound("Conversation not found");
  if (conv.kind === "club") return { conv, audience: "all" };
  const participants = await all<{ user_id: string }>(db, "SELECT user_id FROM conversation_participants WHERE conversation_id = ?", conv.id);
  const ids = participants.map((p) => p.user_id);
  // 404 rather than 403 so conversation ids cannot be probed.
  if (!ids.includes(userId)) throw notFound("Conversation not found");
  return { conv, audience: ids };
}

const MESSAGE_SELECT = `SELECT msg.id, msg.conversation_id, msg.body, msg.created_at, msg.edited_at, msg.deleted_at, ${memberCols("u", "m_")}
  FROM messages msg JOIN "user" u ON u.id = msg.sender_id`;

export function mapMessage(r: Row): Message {
  const deleted = !!r.deleted_at;
  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    sender: mapMember(r, "m_"),
    body: deleted ? null : ((r.body as string | null) ?? null),
    createdAt: String(r.created_at),
    editedAt: (r.edited_at as string | null) ?? null,
    deletedAt: (r.deleted_at as string | null) ?? null,
  };
}

async function loadMessage(db: D1Database, clubId: string, id: string): Promise<(Message & { senderId: string }) | null> {
  const r = await first<Row>(
    db,
    `${MESSAGE_SELECT} JOIN conversations cv ON cv.id = msg.conversation_id WHERE msg.id = ? AND cv.club_id = ?`,
    id,
    clubId,
  );
  return r ? { ...mapMessage(r), senderId: String(r.m_id) } : null;
}

/**
 * Unread = messages from others, not removed, newer than the member's last read
 * time. For the club conversation a member who has never opened it only counts
 * messages sent since they joined the club. Binds: userId.
 */
const UNREAD_SINCE = `COALESCE(me.last_read_at, CASE WHEN c.kind = 'club'
  THEN (SELECT cm.joined_at FROM club_members cm WHERE cm.club_id = c.club_id AND cm.user_id = ?) ELSE '' END)`;

/** Unread message count for one member inside one club. */
export async function unreadInClub(db: D1Database, clubId: string, userId: string): Promise<number> {
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN conversation_participants me ON me.conversation_id = c.id AND me.user_id = ?
     WHERE c.club_id = ? AND m.sender_id <> ? AND m.deleted_at IS NULL
       AND (c.kind = 'club' OR me.user_id IS NOT NULL)
       AND m.created_at > ${UNREAD_SINCE}`,
    userId,
    clubId,
    userId,
    userId,
  );
  return Number(row?.n ?? 0);
}

/** Unread counts per club for every club the member belongs to (one query, for the home page). */
export async function unreadByClub(db: D1Database, userId: string): Promise<Map<string, number>> {
  const rows = await all<{ club_id: string; n: number }>(
    db,
    `SELECT c.club_id, COUNT(*) AS n FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN club_members mem ON mem.club_id = c.club_id AND mem.user_id = ?
     LEFT JOIN conversation_participants me ON me.conversation_id = c.id AND me.user_id = ?
     WHERE m.sender_id <> ? AND m.deleted_at IS NULL
       AND (c.kind = 'club' OR me.user_id IS NOT NULL)
       AND m.created_at > ${UNREAD_SINCE}
     GROUP BY c.club_id`,
    userId,
    userId,
    userId,
    userId,
  );
  return new Map(rows.map((r) => [r.club_id, Number(r.n)]));
}

conversationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const rows = await all<Row>(
    c.env.DB,
    `SELECT c.id, c.club_id, c.kind, c.last_message_at,
       (SELECT CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE substr(m.body, 1, 140) END FROM messages m
          WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS preview,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.deleted_at IS NULL
          AND m.created_at > ${UNREAD_SINCE}) AS unread,
       ${memberCols("o", "o_")}
     FROM conversations c
     LEFT JOIN conversation_participants me ON me.conversation_id = c.id AND me.user_id = ?
     LEFT JOIN conversation_participants other ON other.conversation_id = c.id AND other.user_id <> ? AND c.kind = 'direct'
     LEFT JOIN "user" o ON o.id = other.user_id
     WHERE c.club_id = ? AND (c.kind = 'club' OR me.user_id IS NOT NULL)
     ORDER BY c.kind = 'club' DESC, COALESCE(c.last_message_at, c.created_at) DESC`,
    user.id,
    user.id,
    user.id,
    user.id,
    clubId,
  );
  const conversations: Conversation[] = rows.map((r) => {
    const other = r.kind === "direct" ? mapMemberOrNull(r, "o_") : null;
    return {
      id: String(r.id),
      clubId: String(r.club_id),
      kind: r.kind as Conversation["kind"],
      title: r.kind === "club" ? c.get("club").name : (other?.displayName ?? "Former member"),
      otherMember: other,
      lastMessageAt: (r.last_message_at as string | null) ?? null,
      lastMessagePreview: (r.preview as string | null) ?? null,
      unreadCount: Number(r.unread ?? 0),
    };
  });
  return c.json(conversations);
});

/** Open (or return the existing) one-to-one conversation with another member of this club. */
conversationRoutes.post("/direct", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const { userId } = await parseBody(c, directConversationSchema);
  if (userId === user.id) throw badRequest("You cannot start a conversation with yourself");
  const other = await first<{ id: string }>(
    c.env.DB,
    'SELECT u.id FROM "user" u JOIN club_members m ON m.user_id = u.id AND m.club_id = ? WHERE u.id = ? AND u."emailVerified" = 1',
    clubId,
    userId,
  );
  if (!other) throw notFound("Member not found");
  const key = `${clubId}:${[user.id, userId].sort().join(":")}`;
  const existing = await first<{ id: string }>(c.env.DB, "SELECT id FROM conversations WHERE direct_key = ?", key);
  if (existing) return c.json({ id: existing.id, created: false });
  const id = newId();
  const now = nowIso();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO conversations (id, club_id, kind, direct_key, created_at) VALUES (?, ?, 'direct', ?, ?)").bind(id, clubId, key, now),
      c.env.DB.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, user.id, now),
      c.env.DB.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, userId, now),
    ]);
  } catch {
    // Created concurrently by the other member.
    const again = await first<{ id: string }>(c.env.DB, "SELECT id FROM conversations WHERE direct_key = ?", key);
    if (again) return c.json({ id: again.id, created: false });
    throw new ApiError(500, "server_error", "Could not start conversation");
  }
  c.executionCtx.waitUntil(publish(c.env, clubId, [userId], { type: "conversation.created", conversationId: id }));
  return c.json({ id, created: true }, 201);
});

conversationRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const { conv } = await authorizeConversation(c.env.DB, clubId, c.req.param("id"), user.id);
  let other = null;
  if (conv.kind === "direct") {
    const r = await first<Row>(
      c.env.DB,
      `SELECT ${memberCols("u", "o_")} FROM conversation_participants cp JOIN "user" u ON u.id = cp.user_id WHERE cp.conversation_id = ? AND cp.user_id <> ?`,
      conv.id,
      user.id,
    );
    other = r ? mapMemberOrNull(r, "o_") : null;
  }
  return c.json({
    id: conv.id,
    clubId,
    kind: conv.kind,
    title: conv.kind === "club" ? c.get("club").name : (other?.displayName ?? "Former member"),
    otherMember: other,
  });
});

/**
 * Messages, newest first in the database, returned in chronological order per
 * page. `nextCursor` is the oldest timestamp on the page; pass it back as
 * `?cursor=` to load older messages.
 */
conversationRoutes.get("/:id/messages", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const { conv } = await authorizeConversation(c.env.DB, clubId, c.req.param("id"), user.id);
  const { cursor, limit } = pageQuery(c);
  if (cursor && !timeCursor(cursor)) throw badRequest("Invalid cursor");
  const rows = await all<Row>(
    c.env.DB,
    `${MESSAGE_SELECT} WHERE msg.conversation_id = ? ${cursor ? "AND msg.created_at < ?" : ""} ORDER BY msg.created_at DESC LIMIT ?`,
    ...(cursor ? [conv.id, cursor, limit + 1] : [conv.id, limit + 1]),
  );
  const page = makePage(rows.map(mapMessage), limit, (m) => m.createdAt);
  return c.json({ ...page, items: page.items.reverse() });
});

conversationRoutes.post("/:id/messages", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const { conv, audience } = await authorizeConversation(c.env.DB, club.id, c.req.param("id"), user.id);
  const { body } = await parseBody(c, messageSchema);
  await enforceRateLimit(c.env, "message", `${club.id}:${user.id}`, { window: 60, max: 60 });
  const id = newId();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO messages (id, conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, conv.id, user.id, body, now),
    c.env.DB.prepare("UPDATE conversations SET last_message_at = ? WHERE id = ?").bind(now, conv.id),
    c.env.DB.prepare(
      `INSERT INTO conversation_participants (conversation_id, user_id, last_read_at, joined_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    ).bind(conv.id, user.id, now, now),
  ]);
  const message = await loadMessage(c.env.DB, club.id, id);
  if (!message) throw new ApiError(500, "server_error", "Message could not be saved");
  const { senderId: _senderId, ...payload } = message;
  // D1 write happened first; realtime delivery is best effort.
  c.executionCtx.waitUntil(
    Promise.all([
      publish(c.env, club.id, audience, { type: "message.created", message: payload }),
      conv.kind === "direct"
        ? notifyUsers(c.env, (audience as string[]).filter((u) => u !== user.id), {
            kind: "direct_message",
            clubId: club.id,
            title: `New message from ${user.name}`,
            body: body.slice(0, 140),
            link: `/c/${club.id}/messages/${conv.id}`,
            actorId: user.id,
          })
        : Promise.resolve(),
    ]),
  );
  return c.json(payload, 201);
});

conversationRoutes.post("/:id/read", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const { conv } = await authorizeConversation(c.env.DB, clubId, c.req.param("id"), user.id);
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO conversation_participants (conversation_id, user_id, last_read_at, joined_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    conv.id,
    user.id,
    now,
    now,
  );
  return c.json({ ok: true });
});

/** Only the sender may edit; the edit is marked with edited_at. */
messageRoutes.put("/:id", editMessage);
messageRoutes.patch("/:id", editMessage);

async function editMessage(c: Context<AppEnv>): Promise<Response> {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("id") ?? "";
  const { body } = await parseBody(c, messageSchema);
  const existing = await loadMessage(c.env.DB, clubId, id);
  if (!existing) throw notFound("Message not found");
  const { audience } = await authorizeConversation(c.env.DB, clubId, existing.conversationId, user.id);
  if (existing.senderId !== user.id) throw forbidden("You can only edit your own messages");
  if (existing.deletedAt) throw badRequest("Removed messages cannot be edited");
  await run(c.env.DB, "UPDATE messages SET body = ?, edited_at = ? WHERE id = ? AND sender_id = ? AND deleted_at IS NULL", body, nowIso(), id, user.id);
  const updated = await loadMessage(c.env.DB, clubId, id);
  const { senderId: _s, ...payload } = updated!;
  c.executionCtx.waitUntil(publish(c.env, clubId, audience, { type: "message.updated", message: payload }));
  return c.json(payload);
}

/** Soft delete by the sender. The text is erased from the database, not merely hidden. */
messageRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("id");
  const existing = await loadMessage(c.env.DB, clubId, id);
  if (!existing) throw notFound("Message not found");
  const { audience } = await authorizeConversation(c.env.DB, clubId, existing.conversationId, user.id);
  if (existing.senderId !== user.id) throw forbidden("You can only remove your own messages");
  await run(c.env.DB, "UPDATE messages SET body = NULL, deleted_at = ? WHERE id = ? AND sender_id = ? AND deleted_at IS NULL", nowIso(), id, user.id);
  const updated = await loadMessage(c.env.DB, clubId, id);
  const { senderId: _s, ...payload } = updated!;
  c.executionCtx.waitUntil(publish(c.env, clubId, audience, { type: "message.updated", message: payload }));
  return c.json(payload);
});

/**
 * WebSocket endpoint for one club (/api/clubs/:clubId/realtime). Authenticated
 * and membership-checked like every other club route, with an Origin check to
 * stop cross-site WebSocket hijacking, then handed to that club's ClubRealtime
 * Durable Object with trusted identity headers.
 */
export async function realtimeUpgrade(c: Context<AppEnv>): Promise<Response> {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.json({ error: { code: "upgrade_required", message: "Expected WebSocket" } }, 426);
  const origin = c.req.header("origin");
  const allowed = [new URL(c.env.PUBLIC_APP_URL).origin, new URL(c.req.url).origin];
  if (!origin || !allowed.includes(origin)) return c.json({ error: { code: "bad_origin", message: "Cross-site WebSocket rejected" } }, 403);
  const user = c.get("user");
  const session = c.get("session");
  const club = c.get("club");
  const headers = new Headers({ Upgrade: "websocket" });
  headers.set("x-chapterr-user-id", user.id);
  headers.set("x-chapterr-session-id", session.id);
  headers.set("x-chapterr-club-id", club.id);
  headers.set("x-chapterr-session-expires", String(new Date(session.expiresAt).getTime()));
  return realtimeStub(c.env, club.id).fetch(new Request("https://realtime.internal/connect", { headers }));
}
