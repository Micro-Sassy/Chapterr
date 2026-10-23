import { Hono } from "hono";
import { WAVE2_LIMITS, type GateType, type RoomKind } from "../../shared/constants";
import { guideGenerateSchema, guideSchema, progressSchema, roomSchema, roomsAutoSchema } from "../../shared/schemas-chat";
import type { EditionSummary, RealtimeEvent } from "../../shared/types";
import type { ClubReadingProgress, DiscussionGuide, DiscussionRoom, GuideQuestion, GuideSection, MemberProgress, RealtimeEventWave2 } from "../../shared/types-chat";
import type { AppEnv, Env } from "../env";
import { generateGuideWithAi } from "../lib/ai";
import { requireClubRole } from "../lib/club";
import { all, first, run } from "../lib/db";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parseBody } from "../lib/http";
import { editionCols, mapEdition, mapMember, mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { buildTemplateGuide, type TemplateRoom } from "../lib/prompts";
import { localToday, newId, nowIso } from "../lib/util";
import { publish } from "../realtime/publish";
import { enforceRateLimit } from "../security/rate-limit";
import { ensureRoomParticipant, gateOpenSql, gateSatisfied, loadProgress, mapProgress, roomGate, roomLocked, type RoomRow } from "./messages";

/**
 * Discussion rooms, club reading progress and discussion guides, per club per
 * edition (docs/FEATURES-2.md §4). Mounted at the club root:
 *   /books/:editionId/rooms[/auto]   /rooms/:roomId
 *   /books/:editionId/progress[/all] /books/:editionId/guide[/generate]
 *
 * Room conversations: conversations.kind = 'direct' (the CHECK allows only
 * club|direct), direct_key = `room:<roomId>`, room_id = the room. Every member
 * is a participant; reading and posting is gated by progress in messages.ts.
 * Admins are not exempt from gates: spoiler safety applies to everyone.
 */
export const roomRoutes = new Hono<AppEnv>();

const admin = requireClubRole("admin");

function publishWave2(env: Env, clubId: string, event: RealtimeEventWave2): Promise<void> {
  return publish(env, clubId, "all", event as unknown as RealtimeEvent);
}

async function loadEdition(db: D1Database, editionId: string): Promise<EditionSummary> {
  const r = await first<Row>(db, `SELECT ${editionCols("e", "e_")} FROM book_editions e WHERE e.id = ?`, editionId);
  if (!r) throw notFound("Book not found");
  return mapEdition(r, "e_");
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

const ROOM_SELECT = `SELECT r.id, r.club_id, r.edition_id, r.kind, r.title, r.position, r.gate_type, r.gate_value, r.conversation_id, r.version, r.created_at, r.archived_at,
    cv.last_message_at,
    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = r.conversation_id AND m.deleted_at IS NULL) AS message_count,
    (SELECT COUNT(*) FROM club_members cm LEFT JOIN club_reading_progress p ON p.club_id = cm.club_id AND p.edition_id = r.edition_id AND p.user_id = cm.user_id
       WHERE cm.club_id = r.club_id AND ${gateOpenSql("r", "p")}) AS inside,
    vp.chapter AS vp_chapter, vp.page AS vp_page, vp.percent AS vp_percent, vp.finished AS vp_finished, vp.updated_at AS vp_updated_at,
    ${editionCols("e", "e_")}
  FROM discussion_rooms r
  JOIN conversations cv ON cv.id = r.conversation_id
  JOIN book_editions e ON e.id = r.edition_id
  LEFT JOIN club_reading_progress vp ON vp.club_id = r.club_id AND vp.edition_id = r.edition_id AND vp.user_id = ?`;

function viewerProgress(r: Row): ClubReadingProgress {
  return mapProgress({ chapter: r.vp_chapter, page: r.vp_page, percent: r.vp_percent, finished: r.vp_finished, updated_at: r.vp_updated_at });
}

function mapRoom(r: Row, questions: GuideQuestion[]): DiscussionRoom {
  const gate = { type: String(r.gate_type) as GateType, value: r.gate_value === null ? null : Number(r.gate_value) };
  const unlocked = gateSatisfied(gate, viewerProgress(r));
  return {
    id: String(r.id),
    clubId: String(r.club_id),
    edition: mapEdition(r, "e_"),
    kind: String(r.kind) as RoomKind,
    title: String(r.title),
    position: Number(r.position),
    gateType: gate.type,
    gateValue: gate.value,
    conversationId: String(r.conversation_id),
    unlocked,
    membersInside: Number(r.inside ?? 0),
    // Locked rooms show their title only: no counts, timestamps or questions.
    messageCount: unlocked ? Number(r.message_count ?? 0) : 0,
    lastMessageAt: unlocked ? ((r.last_message_at as string | null) ?? null) : null,
    questions: unlocked ? questions : [],
    version: Number(r.version),
    createdAt: String(r.created_at),
  };
}

async function guideQuestionsByRoom(db: D1Database, clubId: string, editionId: string): Promise<Map<string, GuideQuestion[]>> {
  const g = await first<{ sections: string }>(db, "SELECT sections FROM discussion_guides WHERE club_id = ? AND edition_id = ?", clubId, editionId);
  const map = new Map<string, GuideQuestion[]>();
  for (const s of parseSections(g?.sections)) {
    for (const q of s.questions) {
      if (!q.roomId) continue;
      map.set(q.roomId, [...(map.get(q.roomId) ?? []), q]);
    }
  }
  return map;
}

async function listRooms(db: D1Database, clubId: string, editionId: string, viewerId: string): Promise<DiscussionRoom[]> {
  const [rows, questions] = await Promise.all([
    all<Row>(db, `${ROOM_SELECT} WHERE r.club_id = ? AND r.edition_id = ? AND r.archived_at IS NULL ORDER BY r.position, r.created_at`, viewerId, clubId, editionId),
    guideQuestionsByRoom(db, clubId, editionId),
  ]);
  return rows.map((r) => mapRoom(r, questions.get(String(r.id)) ?? []));
}

async function loadRoom(db: D1Database, clubId: string, roomId: string, viewerId: string): Promise<{ room: DiscussionRoom; row: RoomRow; progress: ClubReadingProgress } | null> {
  const r = await first<Row>(db, `${ROOM_SELECT} WHERE r.id = ? AND r.club_id = ? AND r.archived_at IS NULL`, viewerId, roomId, clubId);
  if (!r) return null;
  const questions = (await guideQuestionsByRoom(db, clubId, String(r.edition_id))).get(String(r.id)) ?? [];
  return { room: mapRoom(r, questions), row: r as unknown as RoomRow, progress: viewerProgress(r) };
}

interface NewRoom {
  kind: RoomKind;
  title: string;
  gateType: GateType;
  gateValue: number | null;
  position: number;
}

/** Statements that create a room, its conversation and a participant row for every current member. */
async function createRoomStatements(db: D1Database, clubId: string, editionId: string, userId: string, input: NewRoom): Promise<{ id: string; stmts: D1PreparedStatement[] }> {
  const id = newId();
  const conversationId = newId();
  const now = nowIso();
  const members = await all<{ user_id: string }>(db, "SELECT user_id FROM club_members WHERE club_id = ?", clubId);
  const stmts = [
    db
      .prepare("INSERT INTO conversations (id, club_id, kind, direct_key, room_id, created_at) VALUES (?, ?, 'direct', ?, ?, ?)")
      .bind(conversationId, clubId, `room:${id}`, id, now),
    db
      .prepare(
        `INSERT INTO discussion_rooms (id, club_id, edition_id, kind, title, position, gate_type, gate_value, conversation_id, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, clubId, editionId, input.kind, input.title, input.position, input.gateType, input.gateType === "none" || input.gateType === "finished" ? null : input.gateValue, conversationId, userId, userId, now, now),
    ...members.map((m) => db.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(conversationId, m.user_id, now)),
  ];
  return { id, stmts };
}

async function roomCount(db: D1Database, clubId: string, editionId: string): Promise<number> {
  const r = await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM discussion_rooms WHERE club_id = ? AND edition_id = ? AND archived_at IS NULL", clubId, editionId);
  return Number(r?.n ?? 0);
}

roomRoutes.get("/books/:editionId/rooms", async (c) => {
  const clubId = c.get("club").id;
  return c.json(await listRooms(c.env.DB, clubId, c.req.param("editionId"), c.get("user").id));
});

roomRoutes.post("/books/:editionId/rooms", admin, async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const editionId = c.req.param("editionId");
  await loadEdition(c.env.DB, editionId);
  const input = await parseBody(c, roomSchema);
  if ((input.gateType === "chapter" || input.gateType === "page" || input.gateType === "percent") && input.gateValue === null) {
    throw badRequest("Choose where in the book this room opens", { gateValue: ["Required for this gate"] });
  }
  const count = await roomCount(c.env.DB, clubId, editionId);
  if (count >= WAVE2_LIMITS.roomsPerBookMax) throw conflict(`A book can have at most ${WAVE2_LIMITS.roomsPerBookMax} rooms`);
  const { id, stmts } = await createRoomStatements(c.env.DB, clubId, editionId, user.id, { ...input, position: count + 1 });
  await c.env.DB.batch(stmts);
  const loaded = await loadRoom(c.env.DB, clubId, id, user.id);
  c.executionCtx.waitUntil(publishWave2(c.env, clubId, { type: "rooms.changed", editionId }));
  return c.json(loaded!.room, 201);
});

/** Chapter rooms 1..n (gate chapter = n) plus an end-of-book reflection room (gate finished). Idempotent: existing rooms are kept. */
roomRoutes.post("/books/:editionId/rooms/auto", admin, async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const editionId = c.req.param("editionId");
  await loadEdition(c.env.DB, editionId);
  const { chapters, reflection } = await parseBody(c, roomsAutoSchema);
  const existing = await all<{ kind: string; gate_type: string; gate_value: number | null }>(
    c.env.DB,
    "SELECT kind, gate_type, gate_value FROM discussion_rooms WHERE club_id = ? AND edition_id = ? AND archived_at IS NULL",
    clubId,
    editionId,
  );
  const haveChapter = new Set(existing.filter((r) => r.kind === "chapter" && r.gate_type === "chapter").map((r) => Number(r.gate_value)));
  const haveReflection = existing.some((r) => r.kind === "reflection");
  const wanted: NewRoom[] = [];
  for (let n = 1; n <= chapters; n++) {
    if (!haveChapter.has(n)) wanted.push({ kind: "chapter", title: `Chapter ${n}`, gateType: "chapter", gateValue: n, position: n });
  }
  if (reflection && !haveReflection) wanted.push({ kind: "reflection", title: "Finished the book", gateType: "finished", gateValue: null, position: chapters + 1 });
  if (existing.length + wanted.length > WAVE2_LIMITS.roomsPerBookMax) throw conflict(`A book can have at most ${WAVE2_LIMITS.roomsPerBookMax} rooms`);
  const stmts: D1PreparedStatement[] = [];
  for (const w of wanted) stmts.push(...(await createRoomStatements(c.env.DB, clubId, editionId, user.id, w)).stmts);
  // D1 batches are limited in size; members x rooms can be large, so write in chunks.
  for (let i = 0; i < stmts.length; i += 90) await c.env.DB.batch(stmts.slice(i, i + 90));
  if (wanted.length) c.executionCtx.waitUntil(publishWave2(c.env, clubId, { type: "rooms.changed", editionId }));
  return c.json(await listRooms(c.env.DB, clubId, editionId, user.id), wanted.length ? 201 : 200);
});

/** Room detail with its conversation id and pinned guide questions. Locked rooms answer 403 room_locked with the gate and the viewer's progress. */
roomRoutes.get("/rooms/:roomId", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const loaded = await loadRoom(c.env.DB, clubId, c.req.param("roomId"), user.id);
  if (!loaded) throw notFound("Room not found");
  if (!loaded.room.unlocked) throw roomLocked(roomGate(loaded.row), loaded.progress);
  await ensureRoomParticipant(c.env.DB, loaded.room.conversationId, user.id);
  return c.json(loaded.room);
});

/** Archive a room (admin). Its conversation stays in the database but is no longer reachable. */
roomRoutes.delete("/rooms/:roomId", admin, async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("roomId");
  const row = await first<{ edition_id: string }>(c.env.DB, "SELECT edition_id FROM discussion_rooms WHERE id = ? AND club_id = ? AND archived_at IS NULL", id, clubId);
  if (!row) throw notFound("Room not found");
  const now = nowIso();
  await run(c.env.DB, "UPDATE discussion_rooms SET archived_at = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND club_id = ?", now, now, user.id, id, clubId);
  c.executionCtx.waitUntil(publishWave2(c.env, clubId, { type: "rooms.changed", editionId: row.edition_id }));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Club reading progress
// ---------------------------------------------------------------------------

roomRoutes.get("/books/:editionId/progress", async (c) => {
  const clubId = c.get("club").id;
  return c.json(await loadProgress(c.env.DB, clubId, c.req.param("editionId"), c.get("user").id));
});

/**
 * Set the viewer's position. Finishing also marks their library entry finished
 * (if they have one) and logs today's reading; a page increase logs the pages.
 * `?today=YYYY-MM-DD` is the member's local date (see localToday).
 */
roomRoutes.put("/books/:editionId/progress", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const editionId = c.req.param("editionId");
  const edition = await loadEdition(c.env.DB, editionId);
  const input = await parseBody(c, progressSchema);
  const before = await loadProgress(c.env.DB, clubId, editionId, user.id);
  const now = nowIso();
  const today = localToday(c.req.query("today"));
  const page = input.page ?? (input.finished ? (edition.pageCount ?? before.page) : null);
  let delta = Math.max(0, (page ?? 0) - (before.page ?? 0));
  if (input.finished && !before.finished && delta === 0 && edition.pageCount) delta = Math.max(0, edition.pageCount - (before.page ?? 0));
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO club_reading_progress (club_id, edition_id, user_id, chapter, page, percent, finished, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (club_id, edition_id, user_id) DO UPDATE SET chapter = excluded.chapter, page = excluded.page, percent = excluded.percent, finished = excluded.finished, updated_at = excluded.updated_at`,
    ).bind(clubId, editionId, user.id, input.chapter, page, input.finished ? 100 : input.percent, input.finished ? 1 : 0, now),
  ];
  if (input.finished) {
    stmts.push(
      c.env.DB.prepare(
        "UPDATE user_books SET status = 'finished', finished_at = COALESCE(finished_at, ?), progress_percent = 100, updated_at = ? WHERE user_id = ? AND edition_id = ? AND status <> 'finished'",
      ).bind(today, now, user.id, editionId),
    );
  }
  if (delta > 0 || (input.finished && !before.finished)) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO reading_log (user_id, day, edition_id, pages, minutes, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT (user_id, day) DO UPDATE SET pages = reading_log.pages + excluded.pages, edition_id = COALESCE(excluded.edition_id, reading_log.edition_id), updated_at = excluded.updated_at`,
      ).bind(user.id, today, editionId, delta, now, now),
    );
  }
  await c.env.DB.batch(stmts);
  const progress = await loadProgress(c.env.DB, clubId, editionId, user.id);
  c.executionCtx.waitUntil(publishWave2(c.env, clubId, { type: "progress.updated", editionId, userId: user.id, progress }));
  return c.json(progress);
});

/** Everyone's position in this book: positions only, never notes or messages. */
roomRoutes.get("/books/:editionId/progress/all", async (c) => {
  const clubId = c.get("club").id;
  const editionId = c.req.param("editionId");
  const rows = await all<Row>(
    c.env.DB,
    `SELECT ${memberCols("u", "m_")}, p.chapter, p.page, p.percent, p.finished, p.updated_at
       FROM club_members cm JOIN "user" u ON u.id = cm.user_id
       LEFT JOIN club_reading_progress p ON p.club_id = cm.club_id AND p.edition_id = ? AND p.user_id = cm.user_id
      WHERE cm.club_id = ?
      ORDER BY COALESCE(p.finished, 0) DESC, COALESCE(p.chapter, 0) DESC, COALESCE(p.page, 0) DESC, COALESCE(p.percent, 0) DESC, u.name COLLATE NOCASE`,
    editionId,
    clubId,
  );
  const out: MemberProgress[] = rows.map((r) => ({ ...mapMember(r, "m_"), progress: r.updated_at ? mapProgress(r) : { chapter: null, page: null, percent: null, finished: false, updatedAt: null } }));
  return c.json(out);
});

// ---------------------------------------------------------------------------
// Discussion guides
// ---------------------------------------------------------------------------

const GUIDE_SELECT = `SELECT g.id, g.club_id, g.source, g.sections, g.version, g.updated_at, ${editionCols("e", "e_")}, ${memberCols("uu", "uu_")}
  FROM discussion_guides g JOIN book_editions e ON e.id = g.edition_id LEFT JOIN "user" uu ON uu.id = g.updated_by`;

function parseSections(value: unknown): GuideSection[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is { title?: unknown; questions?: unknown } => !!s && typeof s === "object")
      .map((s) => ({
        title: String(s.title ?? ""),
        questions: (Array.isArray(s.questions) ? s.questions : [])
          .filter((q): q is { id?: unknown; text?: unknown; roomId?: unknown } => !!q && typeof q === "object")
          .map((q) => ({ id: String(q.id ?? ""), text: String(q.text ?? ""), roomId: typeof q.roomId === "string" ? q.roomId : null })),
      }));
  } catch {
    return [];
  }
}

function mapGuide(r: Row): DiscussionGuide {
  return {
    id: String(r.id),
    clubId: String(r.club_id),
    edition: mapEdition(r, "e_"),
    source: String(r.source) as DiscussionGuide["source"],
    sections: parseSections(r.sections),
    version: Number(r.version),
    updatedBy: mapMemberOrNull(r, "uu_"),
    updatedAt: String(r.updated_at),
  };
}

async function loadGuide(db: D1Database, clubId: string, editionId: string): Promise<DiscussionGuide | null> {
  const r = await first<Row>(db, `${GUIDE_SELECT} WHERE g.club_id = ? AND g.edition_id = ?`, clubId, editionId);
  return r ? mapGuide(r) : null;
}

/** Give every question an id and make sure roomIds point at this book's rooms in this club. */
async function normalizeSections(db: D1Database, clubId: string, editionId: string, sections: { title: string; questions: { id?: string; text: string; roomId: string | null }[] }[]): Promise<GuideSection[]> {
  const rooms = await all<{ id: string }>(db, "SELECT id FROM discussion_rooms WHERE club_id = ? AND edition_id = ? AND archived_at IS NULL", clubId, editionId);
  const roomIds = new Set(rooms.map((r) => r.id));
  const seen = new Set<string>();
  let total = 0;
  const out: GuideSection[] = sections.map((s) => ({
    title: s.title,
    questions: s.questions.map((q) => {
      total++;
      if (q.roomId && !roomIds.has(q.roomId)) throw badRequest("A question points at a room that does not exist for this book", { sections: ["Unknown room"] });
      let id = q.id && !seen.has(q.id) ? q.id : newId().slice(0, 12);
      while (seen.has(id)) id = newId().slice(0, 12);
      seen.add(id);
      return { id, text: q.text, roomId: q.roomId ?? null };
    }),
  }));
  if (total > WAVE2_LIMITS.guideQuestionsMax) throw badRequest(`A guide can hold at most ${WAVE2_LIMITS.guideQuestionsMax} questions`);
  return out;
}

async function saveGuide(db: D1Database, clubId: string, editionId: string, userId: string, source: DiscussionGuide["source"], sections: GuideSection[], expectedVersion?: number): Promise<{ guide: DiscussionGuide; created: boolean }> {
  const existing = await first<{ id: string; version: number }>(db, "SELECT id, version FROM discussion_guides WHERE club_id = ? AND edition_id = ?", clubId, editionId);
  const now = nowIso();
  const json = JSON.stringify(sections);
  if (!existing) {
    await run(
      db,
      "INSERT INTO discussion_guides (id, club_id, edition_id, source, sections, version, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
      newId(),
      clubId,
      editionId,
      source,
      json,
      userId,
      userId,
      now,
      now,
    );
    return { guide: (await loadGuide(db, clubId, editionId))!, created: true };
  }
  const res = await run(
    db,
    `UPDATE discussion_guides SET source = ?, sections = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? ${expectedVersion !== undefined ? "AND version = ?" : ""}`,
    ...(expectedVersion !== undefined ? [source, json, userId, now, existing.id, expectedVersion] : [source, json, userId, now, existing.id]),
  );
  const current = (await loadGuide(db, clubId, editionId))!;
  if (res.meta.changes === 0) throw conflict("Someone else updated this guide while you were editing. Review the latest version and try again.", current);
  return { guide: current, created: false };
}

roomRoutes.get("/books/:editionId/guide", async (c) => {
  const guide = await loadGuide(c.env.DB, c.get("club").id, c.req.param("editionId"));
  if (!guide) throw notFound("No discussion guide yet");
  return c.json(guide);
});

/** Manual edit (admin). `expectedVersion` guards against overwriting a teammate's changes when the guide already exists. */
roomRoutes.put("/books/:editionId/guide", admin, async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const editionId = c.req.param("editionId");
  await loadEdition(c.env.DB, editionId);
  const input = await parseBody(c, guideSchema);
  const sections = await normalizeSections(c.env.DB, clubId, editionId, input.sections);
  const { guide, created } = await saveGuide(c.env.DB, clubId, editionId, user.id, "manual", sections, input.expectedVersion);
  return c.json(guide, created ? 201 : 200);
});

/** Generate a guide (admin): `template` is deterministic and offline; `ai` needs ANTHROPIC_API_KEY (409 ai_unavailable otherwise). Replaces the current guide. */
roomRoutes.post("/books/:editionId/guide/generate", admin, async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const editionId = c.req.param("editionId");
  const edition = await loadEdition(c.env.DB, editionId);
  const input = await parseBody(c, guideGenerateSchema);
  await enforceRateLimit(c.env, "guide_generate", clubId, { window: 3600, max: 10 });
  const [detail, genreRows, roomRows] = await Promise.all([
    first<{ description: string | null }>(c.env.DB, "SELECT description FROM book_editions WHERE id = ?", editionId),
    all<{ name: string }>(
      c.env.DB,
      "SELECT g.name FROM book_genres bg JOIN genres g ON g.id = bg.genre_id WHERE bg.club_id = ? AND bg.book_id = ? AND g.archived_at IS NULL ORDER BY g.name",
      clubId,
      edition.bookId,
    ),
    all<{ id: string; kind: RoomKind; gate_type: GateType; gate_value: number | null }>(
      c.env.DB,
      "SELECT id, kind, gate_type, gate_value FROM discussion_rooms WHERE club_id = ? AND edition_id = ? AND archived_at IS NULL ORDER BY position",
      clubId,
      editionId,
    ),
  ]);
  const rooms: TemplateRoom[] = roomRows.map((r) => ({ id: r.id, kind: r.kind, gateType: r.gate_type, gateValue: r.gate_value === null ? null : Number(r.gate_value) }));
  const chapters = input.chapters ?? (rooms.filter((r) => r.kind === "chapter" && r.gateType === "chapter").map((r) => r.gateValue ?? 0).sort((a, b) => b - a)[0] || null);
  const base = { title: edition.title, authors: edition.authors, description: detail?.description ?? null, genres: genreRows.map((g) => g.name), chapters };
  let sections: GuideSection[];
  if (input.source === "template") {
    sections = buildTemplateGuide({ ...base, rooms });
  } else {
    sections = await generateGuideWithAi(c.env, base);
    // The model knows nothing about rooms; pin whole-book questions to the reflection room when there is one.
    const reflection = rooms.find((r) => r.kind === "reflection");
    if (reflection) {
      sections = sections.map((s) => (/\bend\b|finish/i.test(s.title) ? { ...s, questions: s.questions.map((q) => ({ ...q, roomId: reflection.id })) } : s));
    }
  }
  const { guide, created } = await saveGuide(c.env.DB, clubId, editionId, user.id, input.source, sections);
  return c.json(guide, created ? 201 : 200);
});
