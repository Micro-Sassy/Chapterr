import { Hono, type Context } from "hono";
import type { GateType } from "../../shared/constants";
import { directConversationSchema, messageSchema } from "../../shared/schemas";
import { messageCreateSchema, reactionToggleSchema } from "../../shared/schemas-chat";
import type { Conversation, RealtimeEvent } from "../../shared/types";
import type { Attachment, ChatMessage, ClubReadingProgress, ConversationExtras, ReactionSummary, RealtimeEventWave2, RoomGate } from "../../shared/types-chat";
import type { AppEnv, Env } from "../env";
import { all, bool, first, placeholders, run } from "../lib/db";
import { ApiError, badRequest, forbidden, notFound } from "../lib/errors";
import { parseBody } from "../lib/http";
import { mapMember, mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { loadMembersById, resolveMentions } from "../lib/mentions";
import { notifyUsers } from "../lib/notify";
import { makePage, pageQuery, timeCursor } from "../lib/paging";
import { newId, nowIso } from "../lib/util";
import { publish, realtimeStub } from "../realtime/publish";
import { consumeRateLimit, enforceRateLimit } from "../security/rate-limit";

/**
 * Chats live inside a club (mounted at /api/clubs/:clubId behind
 * requireClubMember). The club conversation is readable by every member of
 * that club; a direct conversation only by its two participants, and a pair
 * of members has one direct conversation per club. Discussion rooms (wave 2)
 * also own a conversation: stored with kind 'direct' (the CHECK constraint
 * allows only club|direct), direct_key `room:<roomId>` and room_id set; every
 * club member is a participant, but reading and writing are gated by the
 * member's reading progress (see docs/FEATURES-2.md §4). Chats are never
 * reachable through share links (the share system has no message resource
 * type, enforced by a CHECK constraint).
 */
export const conversationRoutes = new Hono<AppEnv>();
export const messageRoutes = new Hono<AppEnv>();

export interface ConversationRow {
  id: string;
  club_id: string;
  kind: "club" | "direct";
  room_id: string | null;
}

export interface RoomRow {
  id: string;
  club_id: string;
  edition_id: string;
  kind: string;
  title: string;
  position: number;
  gate_type: GateType;
  gate_value: number | null;
  conversation_id: string;
  version: number;
  created_at: string;
  archived_at: string | null;
}

// ---------------------------------------------------------------------------
// Progress gating (shared with rooms.ts and digest.ts)
// ---------------------------------------------------------------------------

/**
 * SQL: true when the progress row `p` (LEFT JOINed club_reading_progress, may be
 * all NULL) satisfies room `r`'s gate. Finishing the book opens every room.
 */
export function gateOpenSql(r: string, p: string): string {
  return `(${r}.gate_type = 'none' OR COALESCE(${p}.finished, 0) = 1
    OR (${r}.gate_type = 'chapter' AND COALESCE(${p}.chapter, 0) >= ${r}.gate_value)
    OR (${r}.gate_type = 'page' AND COALESCE(${p}.page, 0) >= ${r}.gate_value)
    OR (${r}.gate_type = 'percent' AND COALESCE(${p}.percent, 0) >= ${r}.gate_value))`;
}

/**
 * SQL: conversation `c` is not a room, or is a live room the member has
 * unlocked. Binds: userId (once). Used so unread counts and digests never
 * surface a room a member has not reached.
 */
export function roomVisibleSql(c: string): string {
  return `(${c}.room_id IS NULL OR EXISTS (
    SELECT 1 FROM discussion_rooms rv
    LEFT JOIN club_reading_progress pv ON pv.club_id = rv.club_id AND pv.edition_id = rv.edition_id AND pv.user_id = ?
    WHERE rv.id = ${c}.room_id AND rv.archived_at IS NULL AND ${gateOpenSql("rv", "pv")}))`;
}

export const EMPTY_PROGRESS: ClubReadingProgress = { chapter: null, page: null, percent: null, finished: false, updatedAt: null };

export function gateSatisfied(gate: RoomGate, progress: ClubReadingProgress): boolean {
  if (gate.type === "none" || progress.finished) return true;
  if (gate.type === "finished") return false;
  const value = gate.value;
  if (value === null) return false;
  const have = gate.type === "chapter" ? progress.chapter : gate.type === "page" ? progress.page : progress.percent;
  return (have ?? 0) >= value;
}

export function mapProgress(r: Row | null): ClubReadingProgress {
  if (!r) return EMPTY_PROGRESS;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { chapter: num(r.chapter), page: num(r.page), percent: num(r.percent), finished: bool(r.finished), updatedAt: (r.updated_at as string | null) ?? null };
}

export async function loadProgress(db: D1Database, clubId: string, editionId: string, userId: string): Promise<ClubReadingProgress> {
  const r = await first<Row>(
    db,
    "SELECT chapter, page, percent, finished, updated_at FROM club_reading_progress WHERE club_id = ? AND edition_id = ? AND user_id = ?",
    clubId,
    editionId,
    userId,
  );
  return mapProgress(r);
}

export const ROOM_COLS = "id, club_id, edition_id, kind, title, position, gate_type, gate_value, conversation_id, version, created_at, archived_at";

export function roomGate(room: RoomRow): RoomGate {
  return { type: room.gate_type, value: room.gate_value === null ? null : Number(room.gate_value) };
}

export function roomLocked(gate: RoomGate, progress: ClubReadingProgress): ApiError {
  const extra = { gate, progress } as unknown as ApiError["extra"];
  return new ApiError(403, "room_locked", "Keep reading. This room opens once you reach its point in the book.", extra);
}

/** Members are added to a room's conversation when it is created; later joiners are added the first time they open it. */
export async function ensureRoomParticipant(db: D1Database, conversationId: string, userId: string): Promise<void> {
  await run(db, "INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)", conversationId, userId, nowIso());
}

/** Ids of club members whose progress satisfies the room's gate (realtime audience, `membersInside`). */
export async function unlockedMemberIds(db: D1Database, room: RoomRow): Promise<string[]> {
  const rows = await all<{ user_id: string }>(
    db,
    `SELECT cm.user_id FROM club_members cm
     JOIN discussion_rooms r ON r.id = ?
     LEFT JOIN club_reading_progress p ON p.club_id = cm.club_id AND p.edition_id = r.edition_id AND p.user_id = cm.user_id
     WHERE cm.club_id = ? AND ${gateOpenSql("r", "p")}`,
    room.id,
    room.club_id,
  );
  return rows.map((r) => r.user_id);
}

export interface AuthorizedConversation {
  conv: ConversationRow;
  audience: string[] | "all";
  room: RoomRow | null;
}

/**
 * Throws 404 unless the user may read the conversation inside this club, and
 * 403 room_locked for a room the member has not reached. Returns it plus the
 * audience for realtime delivery (for rooms: only members who are unlocked).
 */
export async function authorizeConversation(db: D1Database, clubId: string, conversationId: string, userId: string): Promise<AuthorizedConversation> {
  const conv = await first<ConversationRow>(db, "SELECT id, club_id, kind, room_id FROM conversations WHERE id = ? AND club_id = ?", conversationId, clubId);
  if (!conv) throw notFound("Conversation not found");
  if (conv.kind === "club") return { conv, audience: "all", room: null };
  if (conv.room_id) {
    const room = await first<RoomRow>(db, `SELECT ${ROOM_COLS} FROM discussion_rooms WHERE id = ? AND club_id = ? AND archived_at IS NULL`, conv.room_id, clubId);
    if (!room) throw notFound("Conversation not found");
    const progress = await loadProgress(db, clubId, room.edition_id, userId);
    const gate = roomGate(room);
    if (!gateSatisfied(gate, progress)) throw roomLocked(gate, progress);
    await ensureRoomParticipant(db, conv.id, userId);
    return { conv, audience: await unlockedMemberIds(db, room), room };
  }
  const participants = await all<{ user_id: string }>(db, "SELECT user_id FROM conversation_participants WHERE conversation_id = ?", conv.id);
  const ids = participants.map((p) => p.user_id);
  // 404 rather than 403 so conversation ids cannot be probed.
  if (!ids.includes(userId)) throw notFound("Conversation not found");
  return { conv, audience: ids, room: null };
}

// ---------------------------------------------------------------------------
// Message loading
// ---------------------------------------------------------------------------

const MESSAGE_SELECT = `SELECT msg.id, msg.conversation_id, msg.sender_id, msg.body, msg.created_at, msg.edited_at, msg.deleted_at,
    msg.parent_id, msg.reply_count, msg.attachments, msg.mentions, msg.kind, ${memberCols("u", "m_")}
  FROM messages msg JOIN "user" u ON u.id = msg.sender_id`;

interface StoredAttachment {
  fileId: string;
  contentType: string;
  width: number | null;
  height: number | null;
  title: string | null;
}

function parseStoredJson<T>(value: unknown): T[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function attachmentUrl(clubId: string, fileId: string): string {
  return `/api/clubs/${clubId}/files/${fileId}/content`;
}

/** Reaction summaries for a set of messages, with `mine` for the viewer. */
async function reactionsFor(db: D1Database, messageIds: string[], viewerId: string): Promise<Map<string, ReactionSummary[]>> {
  const map = new Map<string, ReactionSummary[]>();
  if (messageIds.length === 0) return map;
  const rows = await all<{ message_id: string; emoji: string; n: number; mine: number }>(
    db,
    `SELECT message_id, emoji, COUNT(*) AS n, MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine, MIN(created_at) AS first_at
     FROM message_reactions WHERE message_id IN (${placeholders(messageIds.length)}) GROUP BY message_id, emoji ORDER BY n DESC, first_at ASC`,
    viewerId,
    ...messageIds,
  );
  for (const r of rows) {
    const list = map.get(r.message_id) ?? [];
    list.push({ emoji: r.emoji, count: Number(r.n), mine: bool(r.mine) });
    map.set(r.message_id, list);
  }
  return map;
}

/** Turn raw message rows into API messages, loading reactions and mention summaries in two batched queries. */
export async function hydrateMessages(db: D1Database, clubId: string, rows: Row[], viewerId: string): Promise<ChatMessage[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => String(r.id));
  const mentionIds = Array.from(new Set(rows.flatMap((r) => parseStoredJson<string>(r.mentions).filter((v) => typeof v === "string"))));
  const [reactions, members] = await Promise.all([reactionsFor(db, ids, viewerId), loadMembersById(db, clubId, mentionIds)]);
  const memberById = new Map(members.map((m) => [m.id, m]));
  return rows.map((r) => {
    const deleted = !!r.deleted_at;
    const attachments: Attachment[] = deleted
      ? []
      : parseStoredJson<StoredAttachment>(r.attachments)
          .filter((a) => a && typeof a.fileId === "string")
          .map((a) => ({
            fileId: a.fileId,
            contentType: String(a.contentType ?? "application/octet-stream"),
            width: a.width ?? null,
            height: a.height ?? null,
            title: a.title ?? null,
            url: attachmentUrl(clubId, a.fileId),
          }));
    return {
      id: String(r.id),
      conversationId: String(r.conversation_id),
      sender: mapMember(r, "m_"),
      body: deleted ? null : ((r.body as string | null) ?? null),
      createdAt: String(r.created_at),
      editedAt: (r.edited_at as string | null) ?? null,
      deletedAt: (r.deleted_at as string | null) ?? null,
      parentId: (r.parent_id as string | null) ?? null,
      replyCount: Number(r.reply_count ?? 0),
      attachments,
      mentions: parseStoredJson<string>(r.mentions)
        .map((id) => memberById.get(id))
        .filter((m): m is NonNullable<typeof m> => !!m),
      reactions: reactions.get(String(r.id)) ?? [],
      kind: String(r.kind ?? "user") as ChatMessage["kind"],
    };
  });
}

export async function loadMessage(db: D1Database, clubId: string, id: string, viewerId: string): Promise<ChatMessage | null> {
  const r = await first<Row>(db, `${MESSAGE_SELECT} JOIN conversations cv ON cv.id = msg.conversation_id WHERE msg.id = ? AND cv.club_id = ?`, id, clubId);
  if (!r) return null;
  const [m] = await hydrateMessages(db, clubId, [r], viewerId);
  return m ?? null;
}

function publishWave2(env: Env, clubId: string, audience: string[] | "all", event: RealtimeEventWave2): Promise<void> {
  return publish(env, clubId, audience, event as unknown as RealtimeEvent);
}

// ---------------------------------------------------------------------------
// Unread counts
// ---------------------------------------------------------------------------

/**
 * Unread = top-level or reply messages from others, not removed, newer than the
 * member's last read time. For the club conversation a member who has never
 * opened it only counts messages sent since they joined the club; for a room,
 * since they were added to it. Binds: userId.
 */
const UNREAD_SINCE = `COALESCE(me.last_read_at, CASE WHEN c.kind = 'club'
  THEN (SELECT cm.joined_at FROM club_members cm WHERE cm.club_id = c.club_id AND cm.user_id = ?)
  WHEN c.room_id IS NOT NULL THEN me.joined_at ELSE '' END)`;

/** Unread message count for one member inside one club (locked rooms excluded). */
export async function unreadInClub(db: D1Database, clubId: string, userId: string): Promise<number> {
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN conversation_participants me ON me.conversation_id = c.id AND me.user_id = ?
     WHERE c.club_id = ? AND m.sender_id <> ? AND m.deleted_at IS NULL
       AND (c.kind = 'club' OR me.user_id IS NOT NULL)
       AND ${roomVisibleSql("c")}
       AND m.created_at > ${UNREAD_SINCE}`,
    userId,
    clubId,
    userId,
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
       AND ${roomVisibleSql("c")}
       AND m.created_at > ${UNREAD_SINCE}
     GROUP BY c.club_id`,
    userId,
    userId,
    userId,
    userId,
    userId,
  );
  return new Map(rows.map((r) => [r.club_id, Number(r.n)]));
}

// ---------------------------------------------------------------------------
// Sending (shared by the HTTP route, scheduled messages and welcome messages)
// ---------------------------------------------------------------------------

export interface SendMessageInput {
  clubId: string;
  clubName: string;
  conversationId: string;
  senderId: string;
  body: string;
  parentId?: string | null;
  attachmentFileIds?: string[];
  kind?: ChatMessage["kind"];
  /** Extra user ids to record as mentioned (e.g. the newcomer a welcome message addresses). */
  extraMentionIds?: string[];
}

export interface SentMessage {
  message: ChatMessage;
  audience: string[] | "all";
  /** Realtime fan-out and notifications; run with waitUntil in a request, awaited in cron. */
  deliver: () => Promise<void>;
}

function conversationLink(clubId: string, conv: ConversationRow, room: RoomRow | null, messageId: string): string {
  return room
    ? `/c/${clubId}/rooms/${room.edition_id}?room=${room.id}&message=${messageId}`
    : `/c/${clubId}/messages/${conv.id}?message=${messageId}`;
}

/**
 * Validate, store and announce a message. Enforces conversation access and room
 * gates for the sender, resolves @mentions to club members, checks attachments
 * are the sender's own `attachment` files in this club, and keeps thread counts.
 */
export async function sendMessage(env: Env, input: SendMessageInput): Promise<SentMessage> {
  const db = env.DB;
  const { conv, audience, room } = await authorizeConversation(db, input.clubId, input.conversationId, input.senderId);
  const body = input.body;
  const kind = input.kind ?? "user";
  const fileIds = Array.from(new Set(input.attachmentFileIds ?? []));

  let parent: ChatMessage | null = null;
  if (input.parentId) {
    parent = await loadMessage(db, input.clubId, input.parentId, input.senderId);
    if (!parent || parent.conversationId !== conv.id) throw notFound("Message not found");
    if (parent.parentId) throw badRequest("Replies can only be added to a top-level message");
    if (parent.deletedAt) throw badRequest("That message was removed");
  }

  let stored: StoredAttachment[] = [];
  if (fileIds.length > 0) {
    const files = await all<{ id: string; content_type: string; title: string | null }>(
      db,
      `SELECT id, content_type, title FROM files WHERE id IN (${placeholders(fileIds.length)}) AND club_id = ? AND owner_id = ? AND kind = 'attachment' AND archived_at IS NULL`,
      ...fileIds,
      input.clubId,
      input.senderId,
    );
    if (files.length !== fileIds.length) {
      throw new ApiError(422, "validation_error", "Attach only photos you uploaded to this club", { fields: { attachmentFileIds: ["Attachment not found"] } });
    }
    stored = fileIds.map((id) => {
      const f = files.find((x) => x.id === id)!;
      return { fileId: f.id, contentType: f.content_type, width: null, height: null, title: f.title };
    });
  }

  const mentioned = await resolveMentions(db, input.clubId, body);
  const mentionIds = Array.from(new Set([...mentioned.map((m) => m.id), ...(input.extraMentionIds ?? [])]));

  const id = newId();
  const now = nowIso();
  const stmts = [
    db
      .prepare(
        "INSERT INTO messages (id, conversation_id, sender_id, body, created_at, parent_id, attachments, mentions, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(id, conv.id, input.senderId, body, now, parent?.id ?? null, JSON.stringify(stored), JSON.stringify(mentionIds), kind),
    db.prepare("UPDATE conversations SET last_message_at = ? WHERE id = ?").bind(now, conv.id),
    db
      .prepare(
        `INSERT INTO conversation_participants (conversation_id, user_id, last_read_at, joined_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
      )
      .bind(conv.id, input.senderId, now, now),
  ];
  if (parent) stmts.push(db.prepare("UPDATE messages SET reply_count = reply_count + 1 WHERE id = ?").bind(parent.id));
  await db.batch(stmts);

  const message = await loadMessage(db, input.clubId, id, input.senderId);
  if (!message) throw new ApiError(500, "server_error", "Message could not be saved");
  const replyCount = parent ? parent.replyCount + 1 : 0;
  const link = conversationLink(input.clubId, conv, room, id);
  const place = room ? room.title : conv.kind === "club" ? input.clubName : "a direct message";
  const senderName = message.sender.displayName;
  const excerpt = body.slice(0, 140);

  const deliver = async () => {
    const jobs: Promise<unknown>[] = [];
    jobs.push(
      parent
        ? publishWave2(env, input.clubId, audience, { type: "thread.reply", parentId: parent.id, conversationId: conv.id, replyCount, message })
        : publish(env, input.clubId, audience, { type: "message.created", message }),
    );
    // Only members who may read the conversation are ever notified.
    const allowed = (userId: string) => audience === "all" || audience.includes(userId);
    const mentionTargets = mentionIds.filter((u) => u !== input.senderId && allowed(u));
    if (mentionTargets.length > 0) {
      jobs.push(
        notifyUsers(env, mentionTargets, {
          kind: kind === "welcome" ? "welcome" : "mention",
          clubId: input.clubId,
          title: kind === "welcome" ? `Welcome to ${input.clubName}` : `${senderName} mentioned you in ${place}`,
          body: excerpt,
          link,
          actorId: input.senderId,
        }),
      );
    }
    if (parent && parent.sender.id !== input.senderId && !mentionTargets.includes(parent.sender.id) && allowed(parent.sender.id)) {
      jobs.push(
        notifyUsers(env, [parent.sender.id], {
          kind: "thread_reply",
          clubId: input.clubId,
          title: `${senderName} replied to your message`,
          body: excerpt,
          link,
          actorId: input.senderId,
        }),
      );
    }
    if (conv.kind === "direct" && !room && kind !== "welcome") {
      jobs.push(
        notifyUsers(env, (audience as string[]).filter((u) => u !== input.senderId && !mentionTargets.includes(u)), {
          kind: "direct_message",
          clubId: input.clubId,
          title: `New message from ${senderName}`,
          body: excerpt,
          link: `/c/${input.clubId}/messages/${conv.id}`,
          actorId: input.senderId,
        }),
      );
    }
    await Promise.all(jobs);
  };
  return { message, audience, deliver };
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

type ConversationOut = Conversation & ConversationExtras;

conversationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  // Rooms are listed per book (GET /books/:editionId/rooms), never here.
  const rows = await all<Row>(
    c.env.DB,
    `SELECT c.id, c.club_id, c.kind, c.last_message_at,
       (SELECT CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE substr(m.body, 1, 140) END FROM messages m
          WHERE m.conversation_id = c.id AND m.parent_id IS NULL ORDER BY m.created_at DESC LIMIT 1) AS preview,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.deleted_at IS NULL
          AND m.created_at > ${UNREAD_SINCE}) AS unread,
       ${memberCols("o", "o_")}
     FROM conversations c
     LEFT JOIN conversation_participants me ON me.conversation_id = c.id AND me.user_id = ?
     LEFT JOIN conversation_participants other ON other.conversation_id = c.id AND other.user_id <> ? AND c.kind = 'direct'
     LEFT JOIN "user" o ON o.id = other.user_id
     WHERE c.club_id = ? AND c.room_id IS NULL AND (c.kind = 'club' OR me.user_id IS NOT NULL)
     ORDER BY c.kind = 'club' DESC, COALESCE(c.last_message_at, c.created_at) DESC`,
    user.id,
    user.id,
    user.id,
    user.id,
    clubId,
  );
  const conversations: ConversationOut[] = rows.map((r) => {
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
      roomId: null,
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
  const { id, created } = await openDirectConversation(c.env.DB, clubId, user.id, userId);
  if (!created) return c.json({ id, created: false });
  c.executionCtx.waitUntil(publish(c.env, clubId, [userId], { type: "conversation.created", conversationId: id }));
  return c.json({ id, created: true }, 201);
});

/** Find or create the one direct conversation two members share inside a club (direct_key `<clubId>:<idA>:<idB>`). */
export async function openDirectConversation(db: D1Database, clubId: string, a: string, b: string): Promise<{ id: string; created: boolean }> {
  const key = `${clubId}:${[a, b].sort().join(":")}`;
  const existing = await first<{ id: string }>(db, "SELECT id FROM conversations WHERE direct_key = ?", key);
  if (existing) return { id: existing.id, created: false };
  const id = newId();
  const now = nowIso();
  try {
    await db.batch([
      db.prepare("INSERT INTO conversations (id, club_id, kind, direct_key, created_at) VALUES (?, ?, 'direct', ?, ?)").bind(id, clubId, key, now),
      db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, a, now),
      db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, b, now),
    ]);
  } catch {
    // Created concurrently by the other member.
    const again = await first<{ id: string }>(db, "SELECT id FROM conversations WHERE direct_key = ?", key);
    if (again) return { id: again.id, created: false };
    throw new ApiError(500, "server_error", "Could not start conversation");
  }
  return { id, created: true };
}

conversationRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const { conv, room } = await authorizeConversation(c.env.DB, clubId, c.req.param("id"), user.id);
  let other = null;
  if (conv.kind === "direct" && !room) {
    const r = await first<Row>(
      c.env.DB,
      `SELECT ${memberCols("u", "o_")} FROM conversation_participants cp JOIN "user" u ON u.id = cp.user_id WHERE cp.conversation_id = ? AND cp.user_id <> ?`,
      conv.id,
      user.id,
    );
    other = r ? mapMemberOrNull(r, "o_") : null;
  }
  const out: Omit<ConversationOut, "lastMessageAt" | "lastMessagePreview" | "unreadCount"> = {
    id: conv.id,
    clubId,
    kind: conv.kind,
    title: room ? room.title : conv.kind === "club" ? c.get("club").name : (other?.displayName ?? "Former member"),
    otherMember: other,
    roomId: room?.id ?? null,
  };
  return c.json(out);
});

/**
 * Top-level messages (replies live in threads), newest first in the database,
 * returned in chronological order per page. `nextCursor` is the oldest
 * timestamp on the page; pass it back as `?cursor=` to load older messages.
 */
conversationRoutes.get("/:id/messages", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const { conv } = await authorizeConversation(c.env.DB, clubId, c.req.param("id"), user.id);
  const { cursor, limit } = pageQuery(c);
  if (cursor && !timeCursor(cursor)) throw badRequest("Invalid cursor");
  const rows = await all<Row>(
    c.env.DB,
    `${MESSAGE_SELECT} WHERE msg.conversation_id = ? AND msg.parent_id IS NULL ${cursor ? "AND msg.created_at < ?" : ""} ORDER BY msg.created_at DESC LIMIT ?`,
    ...(cursor ? [conv.id, cursor, limit + 1] : [conv.id, limit + 1]),
  );
  const page = makePage(await hydrateMessages(c.env.DB, clubId, rows, user.id), limit, (m) => m.createdAt);
  return c.json({ ...page, items: page.items.reverse() });
});

conversationRoutes.post("/:id/messages", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const input = await parseBody(c, messageCreateSchema);
  await enforceRateLimit(c.env, "message", `${club.id}:${user.id}`, { window: 60, max: 60 });
  const sent = await sendMessage(c.env, {
    clubId: club.id,
    clubName: club.name,
    conversationId: c.req.param("id"),
    senderId: user.id,
    body: input.body,
    parentId: input.parentId,
    attachmentFileIds: input.attachmentFileIds,
  });
  // D1 write happened first; realtime delivery and notifications are best effort.
  c.executionCtx.waitUntil(sent.deliver());
  return c.json(sent.message, 201);
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

// ---------------------------------------------------------------------------
// Messages: threads, reactions, edit, remove
// ---------------------------------------------------------------------------

/** Replies to one message, oldest first; `nextCursor` is the newest timestamp on the page. */
messageRoutes.get("/:id/thread", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const parent = await loadMessage(c.env.DB, clubId, c.req.param("id"), user.id);
  if (!parent) throw notFound("Message not found");
  await authorizeConversation(c.env.DB, clubId, parent.conversationId, user.id);
  const { cursor, limit } = pageQuery(c);
  if (cursor && !timeCursor(cursor)) throw badRequest("Invalid cursor");
  const rows = await all<Row>(
    c.env.DB,
    `${MESSAGE_SELECT} WHERE msg.parent_id = ? ${cursor ? "AND msg.created_at > ?" : ""} ORDER BY msg.created_at ASC LIMIT ?`,
    ...(cursor ? [parent.id, cursor, limit + 1] : [parent.id, limit + 1]),
  );
  const page = makePage(await hydrateMessages(c.env.DB, clubId, rows, user.id), limit, (m) => m.createdAt);
  return c.json({ ...page, parent });
});

/** Toggle the caller's reaction. Returns the new summary; the author is told at most once per message per hour. */
messageRoutes.put("/:id/reactions", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const id = c.req.param("id");
  const { emoji } = await parseBody(c, reactionToggleSchema);
  const existing = await loadMessage(c.env.DB, club.id, id, user.id);
  if (!existing) throw notFound("Message not found");
  if (existing.deletedAt) throw badRequest("Removed messages cannot be reacted to");
  const { audience } = await authorizeConversation(c.env.DB, club.id, existing.conversationId, user.id);
  const removed = await run(c.env.DB, "DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?", id, user.id, emoji);
  const added = removed.meta.changes === 0;
  if (added) {
    await run(c.env.DB, "INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)", id, user.id, emoji, nowIso());
  }
  const reactions = (await reactionsFor(c.env.DB, [id], user.id)).get(id) ?? [];
  const jobs: Promise<unknown>[] = [publishWave2(c.env, club.id, audience, { type: "message.reaction", messageId: id, conversationId: existing.conversationId, reactions })];
  if (added && existing.sender.id !== user.id) {
    // One "reaction" notice per message per hour, however many people react (fixed window, not scaled per environment).
    const gate = await consumeRateLimit(c.env.DB, `reaction-notify:${id}`, { window: 3600, max: 1 });
    if (gate.allowed) {
      jobs.push(
        notifyUsers(c.env, [existing.sender.id], {
          kind: "reaction",
          clubId: club.id,
          title: `${user.name} reacted ${emoji} to your message`,
          body: existing.body?.slice(0, 140) ?? null,
          link: `/c/${club.id}/messages/${existing.conversationId}?message=${id}`,
          actorId: user.id,
        }),
      );
    }
  }
  c.executionCtx.waitUntil(Promise.all(jobs));
  return c.json({ messageId: id, reactions, mine: added });
});

/** Only the sender may edit; the edit is marked with edited_at and mentions are re-read from the new text. */
messageRoutes.put("/:id", editMessage);
messageRoutes.patch("/:id", editMessage);

async function editMessage(c: Context<AppEnv>): Promise<Response> {
  const user = c.get("user");
  const club = c.get("club");
  const id = c.req.param("id") ?? "";
  const { body } = await parseBody(c, messageSchema);
  const existing = await loadMessage(c.env.DB, club.id, id, user.id);
  if (!existing) throw notFound("Message not found");
  const { audience, conv, room } = await authorizeConversation(c.env.DB, club.id, existing.conversationId, user.id);
  if (existing.sender.id !== user.id) throw forbidden("You can only edit your own messages");
  if (existing.deletedAt) throw badRequest("Removed messages cannot be edited");
  const mentioned = await resolveMentions(c.env.DB, club.id, body);
  const previous = new Set(existing.mentions.map((m) => m.id));
  const mentionIds = Array.from(new Set([...existing.mentions.map((m) => m.id), ...mentioned.map((m) => m.id)]));
  await run(c.env.DB, "UPDATE messages SET body = ?, edited_at = ?, mentions = ? WHERE id = ? AND sender_id = ? AND deleted_at IS NULL", body, nowIso(), JSON.stringify(mentionIds), id, user.id);
  const updated = (await loadMessage(c.env.DB, club.id, id, user.id))!;
  const fresh = mentioned.map((m) => m.id).filter((u) => u !== user.id && !previous.has(u) && (audience === "all" || audience.includes(u)));
  // Replies carry parentId, so one event serves both the main list and open threads.
  const jobs: Promise<unknown>[] = [publish(c.env, club.id, audience, { type: "message.updated", message: updated })];
  if (fresh.length > 0) {
    jobs.push(
      notifyUsers(c.env, fresh, {
        kind: "mention",
        clubId: club.id,
        title: `${user.name} mentioned you in ${room ? room.title : conv.kind === "club" ? club.name : "a direct message"}`,
        body: body.slice(0, 140),
        link: conversationLink(club.id, conv, room, id),
        actorId: user.id,
      }),
    );
  }
  c.executionCtx.waitUntil(Promise.all(jobs));
  return c.json(updated);
}

/** Soft delete by the sender. The text, attachments and mentions are erased from the database, not merely hidden. */
messageRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("id");
  const existing = await loadMessage(c.env.DB, clubId, id, user.id);
  if (!existing) throw notFound("Message not found");
  const { audience } = await authorizeConversation(c.env.DB, clubId, existing.conversationId, user.id);
  if (existing.sender.id !== user.id) throw forbidden("You can only remove your own messages");
  await run(
    c.env.DB,
    "UPDATE messages SET body = NULL, deleted_at = ?, attachments = '[]', mentions = '[]' WHERE id = ? AND sender_id = ? AND deleted_at IS NULL",
    nowIso(),
    id,
    user.id,
  );
  const updated = (await loadMessage(c.env.DB, clubId, id, user.id))!;
  c.executionCtx.waitUntil(publish(c.env, clubId, audience, { type: "message.updated", message: updated }));
  return c.json(updated);
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
