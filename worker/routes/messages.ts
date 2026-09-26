import { Hono } from "hono";
import { directConversationSchema, messageSchema } from "../../shared/schemas";
import type { Conversation, Message } from "../../shared/types";
import type { AppEnv, Env } from "../env";
import { all, first, run } from "../lib/db";
import { ApiError, badRequest, forbidden, notFound } from "../lib/errors";
import { parseBody, queryInt } from "../lib/http";
import { mapMember, mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { notifyUsers } from "../lib/notify";
import { newId, nowIso } from "../lib/util";
import { publish, realtimeStub } from "../realtime/publish";
import { enforceRateLimit } from "../security/rate-limit";

/**
 * Chats are authenticated-only. The main club conversation is readable by
 * every signed-in member; a direct conversation only by its two participants.
 * Chats are never reachable through share links (the share system has no
 * message resource type, enforced by a CHECK constraint).
 */
export const conversationRoutes = new Hono<AppEnv>();
export const messageRoutes = new Hono<AppEnv>();

interface ConversationRow {
  id: string;
  kind: "club" | "direct";
}

/** Throws 404 unless the user may read the conversation. Returns it plus the audience for realtime delivery. */
export async function authorizeConversation(db: D1Database, conversationId: string, userId: string): Promise<{ conv: ConversationRow; audience: string[] | "all" }> {
  const conv = await first<ConversationRow>(db, "SELECT id, kind FROM conversations WHERE id = ?", conversationId);
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

async function loadMessage(db: D1Database, id: string): Promise<(Message & { senderId: string }) | null> {
  const r = await first<Row>(db, `${MESSAGE_SELECT} WHERE msg.id = ?`, id);
  return r ? { ...mapMessage(r), senderId: String(r.m_id) } : null;
}

async function unreadCount(db: D1Database, conversationId: string, userId: string): Promise<number> {
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM messages m
     LEFT JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = ?
     WHERE m.conversation_id = ? AND m.sender_id <> ? AND m.deleted_at IS NULL
       AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)`,
    userId,
    conversationId,
    userId,
  );
  return Number(row?.n ?? 0);
}

export async function totalUnread(env: Env, userId: string): Promise<number> {
  const row = await first<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = ?
     WHERE m.sender_id <> ? AND m.deleted_at IS NULL
       AND (c.kind = 'club' OR cp.user_id IS NOT NULL)
       AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
       AND (c.kind = 'direct' OR m.created_at > (SELECT "createdAt" FROM "user" WHERE id = ?))`,
    userId,
    userId,
    userId,
  );
  return Number(row?.n ?? 0);
}

conversationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const rows = await all<Row>(
    c.env.DB,
    `SELECT c.id, c.kind, c.last_message_at,
       (SELECT CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE substr(m.body, 1, 140) END FROM messages m
          WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS preview,
       ${memberCols("o", "o_")}
     FROM conversations c
     LEFT JOIN conversation_participants me ON me.conversation_id = c.id AND me.user_id = ?
     LEFT JOIN conversation_participants other ON other.conversation_id = c.id AND other.user_id <> ? AND c.kind = 'direct'
     LEFT JOIN "user" o ON o.id = other.user_id
     WHERE c.kind = 'club' OR me.user_id IS NOT NULL
     ORDER BY c.kind = 'club' DESC, COALESCE(c.last_message_at, c.created_at) DESC`,
    user.id,
    user.id,
  );
  const conversations: Conversation[] = [];
  for (const r of rows) {
    const other = r.kind === "direct" ? mapMemberOrNull(r, "o_") : null;
    conversations.push({
      id: String(r.id),
      kind: r.kind as Conversation["kind"],
      title: r.kind === "club" ? "Club conversation" : (other?.displayName ?? "Former member"),
      otherMember: other,
      lastMessageAt: (r.last_message_at as string | null) ?? null,
      lastMessagePreview: (r.preview as string | null) ?? null,
      unreadCount: await unreadCount(c.env.DB, String(r.id), user.id),
    });
  }
  return c.json(conversations);
});

/** Open (or return the existing) one-to-one conversation with another member. */
conversationRoutes.post("/direct", async (c) => {
  const user = c.get("user");
  const { userId } = await parseBody(c, directConversationSchema);
  if (userId === user.id) throw badRequest("You cannot start a conversation with yourself");
  const other = await first<{ id: string }>(c.env.DB, 'SELECT id FROM "user" WHERE id = ? AND "emailVerified" = 1', userId);
  if (!other) throw notFound("Member not found");
  const key = [user.id, userId].sort().join(":");
  const existing = await first<{ id: string }>(c.env.DB, "SELECT id FROM conversations WHERE direct_key = ?", key);
  if (existing) return c.json({ id: existing.id, created: false });
  const id = newId();
  const now = nowIso();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO conversations (id, kind, direct_key, created_at) VALUES (?, 'direct', ?, ?)").bind(id, key, now),
      c.env.DB.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, user.id, now),
      c.env.DB.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, userId, now),
    ]);
  } catch {
    // Created concurrently by the other member.
    const again = await first<{ id: string }>(c.env.DB, "SELECT id FROM conversations WHERE direct_key = ?", key);
    if (again) return c.json({ id: again.id, created: false });
    throw new ApiError(500, "server_error", "Could not start conversation");
  }
  c.executionCtx.waitUntil(publish(c.env, [userId], { type: "conversation.created", conversationId: id }));
  return c.json({ id, created: true }, 201);
});

conversationRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const { conv } = await authorizeConversation(c.env.DB, c.req.param("id"), user.id);
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
  return c.json({ id: conv.id, kind: conv.kind, title: conv.kind === "club" ? "Club conversation" : (other?.displayName ?? "Former member"), otherMember: other });
});

conversationRoutes.get("/:id/messages", async (c) => {
  const user = c.get("user");
  const { conv } = await authorizeConversation(c.env.DB, c.req.param("id"), user.id);
  const limit = queryInt(c, "limit", 50, 1, 100);
  const before = c.req.query("before");
  if (before && Number.isNaN(Date.parse(before))) throw badRequest("Invalid cursor");
  const rows = await all<Row>(
    c.env.DB,
    `${MESSAGE_SELECT} WHERE msg.conversation_id = ? ${before ? "AND msg.created_at < ?" : ""} ORDER BY msg.created_at DESC LIMIT ?`,
    ...(before ? [conv.id, before, limit + 1] : [conv.id, limit + 1]),
  );
  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit).map(mapMessage).reverse();
  return c.json({ messages, hasMore });
});

conversationRoutes.post("/:id/messages", async (c) => {
  const user = c.get("user");
  const { conv, audience } = await authorizeConversation(c.env.DB, c.req.param("id"), user.id);
  const { body } = await parseBody(c, messageSchema);
  await enforceRateLimit(c.env, "message", user.id, { window: 60, max: 30 });
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
  const message = await loadMessage(c.env.DB, id);
  if (!message) throw new ApiError(500, "server_error", "Message could not be saved");
  const { senderId: _senderId, ...payload } = message;
  // D1 write happened first; realtime delivery is best effort.
  c.executionCtx.waitUntil(
    Promise.all([
      publish(c.env, audience, { type: "message.created", message: payload }),
      conv.kind === "direct"
        ? notifyUsers(c.env, (audience as string[]).filter((u) => u !== user.id), {
            kind: "direct_message",
            title: `New message from ${user.name}`,
            body: body.slice(0, 140),
            link: `/messages/${conv.id}`,
            actorId: user.id,
          })
        : Promise.resolve(),
    ]),
  );
  return c.json(payload, 201);
});

conversationRoutes.post("/:id/read", async (c) => {
  const user = c.get("user");
  const { conv } = await authorizeConversation(c.env.DB, c.req.param("id"), user.id);
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
messageRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const { body } = await parseBody(c, messageSchema);
  const existing = await loadMessage(c.env.DB, id);
  if (!existing) throw notFound("Message not found");
  const { audience } = await authorizeConversation(c.env.DB, existing.conversationId, user.id);
  if (existing.senderId !== user.id) throw forbidden("You can only edit your own messages");
  if (existing.deletedAt) throw badRequest("Removed messages cannot be edited");
  await run(c.env.DB, "UPDATE messages SET body = ?, edited_at = ? WHERE id = ? AND sender_id = ? AND deleted_at IS NULL", body, nowIso(), id, user.id);
  const updated = await loadMessage(c.env.DB, id);
  const { senderId: _s, ...payload } = updated!;
  c.executionCtx.waitUntil(publish(c.env, audience, { type: "message.updated", message: payload }));
  return c.json(payload);
});

/** Soft delete by the sender. The text is erased from the database, not merely hidden. */
messageRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const existing = await loadMessage(c.env.DB, id);
  if (!existing) throw notFound("Message not found");
  const { audience } = await authorizeConversation(c.env.DB, existing.conversationId, user.id);
  if (existing.senderId !== user.id) throw forbidden("You can only remove your own messages");
  await run(c.env.DB, "UPDATE messages SET body = NULL, deleted_at = ? WHERE id = ? AND sender_id = ? AND deleted_at IS NULL", nowIso(), id, user.id);
  const updated = await loadMessage(c.env.DB, id);
  const { senderId: _s, ...payload } = updated!;
  c.executionCtx.waitUntil(publish(c.env, audience, { type: "message.updated", message: payload }));
  return c.json(payload);
});

/**
 * WebSocket endpoint. Authenticated like every other API route, with an
 * Origin check to stop cross-site WebSocket hijacking, then handed to the
 * ClubRealtime Durable Object with trusted identity headers.
 */
export async function realtimeUpgrade(c: import("hono").Context<AppEnv>): Promise<Response> {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.json({ error: { code: "upgrade_required", message: "Expected WebSocket" } }, 426);
  const origin = c.req.header("origin");
  const allowed = [new URL(c.env.PUBLIC_APP_URL).origin, new URL(c.req.url).origin];
  if (!origin || !allowed.includes(origin)) return c.json({ error: { code: "bad_origin", message: "Cross-site WebSocket rejected" } }, 403);
  const user = c.get("user");
  const session = c.get("session");
  const headers = new Headers({ Upgrade: "websocket" });
  headers.set("x-trbc-user-id", user.id);
  headers.set("x-trbc-session-id", session.id);
  headers.set("x-trbc-session-expires", String(new Date(session.expiresAt).getTime()));
  return realtimeStub(c.env).fetch(new Request("https://realtime.internal/connect", { headers }));
}
