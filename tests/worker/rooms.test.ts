import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "../../shared/types";
import type { RealtimeEventWave2 } from "../../shared/types-chat";
import { addToClub, as, createClub, createMember, installFetchMock, json, seedEdition, testEnv, type Member, type TestClub } from "./helpers";

type AnyEvent = RealtimeEvent | RealtimeEventWave2;

let alice: Member; // owner
let bob: Member; // member
let carol: Member; // member
let club: TestClub;
let base: string;
let edition: string;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  installFetchMock();
  alice = await createMember("room_a");
  bob = await createMember("room_b");
  carol = await createMember("room_c");
  club = await createClub(alice, "Spoiler Free Club");
  await addToClub(alice, club, bob);
  await addToClub(alice, club, carol);
  base = `/api/clubs/${club.id}`;
  edition = await seedEdition("The Gated Garden Mystery");
  await testEnv.DB.prepare("UPDATE book_editions SET page_count = 300, description = ? WHERE id = ?")
    .bind("A detective untangles a murder in a walled garden in this suspenseful mystery.", edition)
    .run();
  // Rooms are created once here: vitest-pool-workers rolls back storage written inside each `it`.
  const res = await as(alice)(`${base}/books/${edition}/rooms/auto`, { body: { chapters: 3, reflection: true } });
  if (res.status !== 201) throw new Error(`rooms/auto failed ${res.status}: ${await res.text()}`);
  vi.restoreAllMocks();
});

async function openSocket(member: Member): Promise<{ ws: WebSocket; events: AnyEvent[] }> {
  const res = await as(member)(`${base}/realtime`, { headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const events: AnyEvent[] = [];
  ws.addEventListener("message", (e) => {
    events.push(JSON.parse(e.data as string));
  });
  ws.accept();
  return { ws, events };
}
const tick = (ms = 100) => new Promise((r) => setTimeout(r, ms));

const rooms = async (member: Member) => json<any[]>(await as(member)(`${base}/books/${edition}/rooms`));
const setProgress = (member: Member, body: Record<string, unknown>) => as(member)(`${base}/books/${edition}/progress`, { method: "PUT", body });

describe("discussion rooms", () => {
  it("auto-creates chapter rooms and a reflection room (admin only), idempotently", async () => {
    expect((await as(bob)(`${base}/books/${edition}/rooms/auto`, { body: { chapters: 3 } })).status).toBe(403);
    const list = await rooms(alice);
    expect(list.map((r) => [r.kind, r.title, r.gateType, r.gateValue, r.position])).toEqual([
      ["chapter", "Chapter 1", "chapter", 1, 1],
      ["chapter", "Chapter 2", "chapter", 2, 2],
      ["chapter", "Chapter 3", "chapter", 3, 3],
      ["reflection", "Finished the book", "finished", null, 4],
    ]);
    expect(list.every((r) => r.unlocked === false && r.membersInside === 0 && r.messageCount === 0 && r.questions.length === 0)).toBe(true);
    expect(list[0].edition.id).toBe(edition);
    expect(list[0].conversationId).toBeTruthy();
    // Running it again adds nothing.
    const again = await as(alice)(`${base}/books/${edition}/rooms/auto`, { body: { chapters: 3 } });
    expect(again.status).toBe(200);
    expect(await json<any[]>(again)).toHaveLength(4);
    // Room conversations are kind 'direct' with direct_key room:<id>, room_id set, and every member a participant.
    const conv = await testEnv.DB.prepare("SELECT kind, direct_key, room_id FROM conversations WHERE id = ?").bind(list[0].conversationId).first<any>();
    expect(conv).toEqual({ kind: "direct", direct_key: `room:${list[0].id}`, room_id: list[0].id });
    const parts = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM conversation_participants WHERE conversation_id = ?").bind(list[0].conversationId).first<{ n: number }>();
    expect(parts?.n).toBe(3);
    // Rooms never appear in the conversations list.
    const convs = await json<any[]>(await as(alice)(`${base}/conversations`));
    expect(convs.some((c) => c.id === list[0].conversationId)).toBe(false);
  });

  it("locks and unlocks rooms as progress changes, for admins too", async () => {
    const list = await rooms(alice);
    const [ch1, ch2, ch3, reflection] = list;
    const locked = await as(alice)(`${base}/rooms/${ch1.id}`);
    expect(locked.status).toBe(403);
    const err = (await json(locked)).error;
    expect(err.code).toBe("room_locked");
    expect(err.gate).toEqual({ type: "chapter", value: 1 });
    expect(err.progress).toEqual({ chapter: null, page: null, percent: null, finished: false, updatedAt: null });
    // Reading or posting in a locked room is refused the same way.
    expect((await as(alice)(`${base}/conversations/${ch1.conversationId}/messages`)).status).toBe(403);
    expect((await as(alice)(`${base}/conversations/${ch1.conversationId}/messages`, { body: { body: "early" } })).status).toBe(403);
    expect((await as(alice)(`${base}/scheduled`, { body: { conversationId: ch1.conversationId, body: "later", sendAt: new Date(Date.now() + 600_000).toISOString() } })).status).toBe(403);

    const progress = await json(await setProgress(alice, { chapter: 2, page: 80 }));
    expect(progress).toMatchObject({ chapter: 2, page: 80, percent: null, finished: false });
    expect(await json(await as(alice)(`${base}/books/${edition}/progress`))).toMatchObject({ chapter: 2, page: 80 });
    const after = await rooms(alice);
    expect(after.map((r) => r.unlocked)).toEqual([true, true, false, false]);
    expect(after.map((r) => r.membersInside)).toEqual([1, 1, 0, 0]);
    const room = await json(await as(alice)(`${base}/rooms/${ch1.id}`));
    expect(room.unlocked).toBe(true);
    expect(room.conversationId).toBe(ch1.conversationId);

    const bobSock = await openSocket(bob);
    const carolSock = await openSocket(carol);
    await tick();
    // Carol is far ahead; Bob has not started.
    await setProgress(carol, { chapter: 3 });
    const posted = await json(await as(alice)(`${base}/conversations/${ch2.conversationId}/messages`, { body: { body: "Chapter two twist!" } }));
    expect(posted.conversationId).toBe(ch2.conversationId);
    await tick(150);
    expect(carolSock.events.some((e) => e.type === "message.created" && (e as any).message.id === posted.id)).toBe(true);
    expect(bobSock.events.some((e) => e.type === "message.created")).toBe(false);
    expect(bobSock.events.some((e) => e.type === "progress.updated" && (e as any).userId === carol.id)).toBe(true);
    bobSock.ws.close();
    carolSock.ws.close();
    expect((await as(bob)(`${base}/conversations/${ch2.conversationId}/messages`)).status).toBe(403);
    expect((await as(alice)(`${base}/conversations/${ch3.conversationId}/messages`, { body: { body: "too far" } })).status).toBe(403);
    // Unread counts never include locked rooms.
    const bobDash = await json(await as(bob)(`${base}/dashboard`));
    expect(bobDash.unreadMessages).toBe(0);
    await setProgress(bob, { chapter: 2 });
    expect((await json(await as(bob)(`${base}/dashboard`))).unreadMessages).toBe(1);
    expect((await as(bob)(`${base}/conversations/${ch2.conversationId}/messages`)).status).toBe(200);
    // A room conversation is described with its room id and title.
    const described = await json(await as(bob)(`${base}/conversations/${ch2.conversationId}`));
    expect(described).toMatchObject({ roomId: ch2.id, title: "Chapter 2", otherMember: null });
    // Locked rooms list only titles; unlocked ones carry counts.
    const bobRooms = await rooms(bob);
    expect(bobRooms[1].messageCount).toBe(1);
    expect(bobRooms[1].lastMessageAt).toBeTruthy();
    expect(bobRooms[2]).toMatchObject({ unlocked: false, messageCount: 0, lastMessageAt: null });
    expect(bobRooms[3]).toMatchObject({ unlocked: false, membersInside: 0 });
    expect(reflection.gateType).toBe("finished");
  });

  it("finishing the book opens the reflection room, marks the library entry and logs reading", async () => {
    const list = await rooms(alice);
    const reflection = list.find((r) => r.kind === "reflection")!;
    expect((await as(alice)(`${base}/rooms/${reflection.id}`)).status).toBe(403);
    const now = new Date().toISOString();
    await testEnv.DB.prepare(
      "INSERT INTO user_books (id, user_id, edition_id, status, started_at, current_page, created_at, updated_at) VALUES (?, ?, ?, 'reading', ?, 80, ?, ?)",
    )
      .bind(`ub_${Math.random().toString(36).slice(2, 10)}`, alice.id, edition, now.slice(0, 10), now, now)
      .run();
    await setProgress(alice, { chapter: 2, page: 80 });
    const progress = await json(await setProgress(alice, { chapter: 3, finished: true }));
    expect(progress).toMatchObject({ chapter: 3, finished: true, percent: 100, page: 300 });
    const after = await rooms(alice);
    expect(after.every((r) => r.unlocked)).toBe(true);
    expect(after.find((r) => r.kind === "reflection")!.membersInside).toBe(1);
    expect((await as(alice)(`${base}/rooms/${reflection.id}`)).status).toBe(200);
    expect((await as(alice)(`${base}/conversations/${reflection.conversationId}/messages`, { body: { body: "What an ending" } })).status).toBe(201);
    const ub = await testEnv.DB.prepare("SELECT status, finished_at, progress_percent FROM user_books WHERE user_id = ? AND edition_id = ?").bind(alice.id, edition).first<any>();
    expect(ub.status).toBe("finished");
    expect(ub.finished_at).toBeTruthy();
    expect(ub.progress_percent).toBe(100);
    const log = await testEnv.DB.prepare("SELECT pages, edition_id FROM reading_log WHERE user_id = ? ORDER BY day DESC LIMIT 1").bind(alice.id).first<any>();
    expect(log.pages).toBe(300); // 80 logged when the page was set, then the remaining 220 on finishing
    expect(log.edition_id).toBe(edition);
  });

  it("shows everyone's position and nothing else", async () => {
    await setProgress(alice, { finished: true });
    await setProgress(carol, { chapter: 1 });
    const all = await json<any[]>(await as(bob)(`${base}/books/${edition}/progress/all`));
    expect(all).toHaveLength(3);
    const mine = all.find((m) => m.id === alice.id);
    expect(Object.keys(mine).sort()).toEqual(["avatarUrl", "displayName", "id", "progress", "username"]);
    expect(Object.keys(mine.progress).sort()).toEqual(["chapter", "finished", "page", "percent", "updatedAt"]);
    expect(mine.progress.finished).toBe(true);
    expect(all[0].id).toBe(alice.id); // finished readers first
    const dave = await createMember("room_d");
    await addToClub(alice, club, dave);
    const withDave = await json<any[]>(await as(dave)(`${base}/books/${edition}/progress/all`));
    expect(withDave.find((m) => m.id === dave.id).progress).toEqual({ chapter: null, page: null, percent: null, finished: false, updatedAt: null });
    // A later joiner is added to room conversations when they first open one.
    await setProgress(dave, { chapter: 1 });
    const ch1 = (await rooms(dave))[0];
    expect((await as(dave)(`${base}/conversations/${ch1.conversationId}/messages`)).status).toBe(200);
    const part = await testEnv.DB.prepare("SELECT 1 AS n FROM conversation_participants WHERE conversation_id = ? AND user_id = ?").bind(ch1.conversationId, dave.id).first();
    expect(part).toBeTruthy();
  });

  it("admins can add and archive rooms with explicit gates", async () => {
    const res = await as(alice)(`${base}/books/${edition}/rooms`, { body: { kind: "milestone", title: "Halfway there", gateType: "percent", gateValue: 50 } });
    expect(res.status).toBe(201);
    const room = await json(res);
    expect(room).toMatchObject({ kind: "milestone", gateType: "percent", gateValue: 50, position: 5 });
    expect((await as(alice)(`${base}/books/${edition}/rooms`, { body: { kind: "milestone", title: "No gate value", gateType: "page" } })).status).toBe(400);
    expect((await as(bob)(`${base}/rooms/${room.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await as(alice)(`${base}/rooms/${room.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(alice)(`${base}/rooms/${room.id}`)).status).toBe(404);
    expect((await as(alice)(`${base}/conversations/${room.conversationId}/messages`)).status).toBe(404);
    expect(await rooms(alice)).toHaveLength(4);
  });
});

describe("discussion guides", () => {
  it("generates a template guide mapped to rooms, allows manual edits with versions, and reports AI as unavailable without a key", async () => {
    expect((await as(alice)(`${base}/books/${edition}/guide`)).status).toBe(404);
    expect((await as(bob)(`${base}/books/${edition}/guide/generate`, { body: { source: "template" } })).status).toBe(403);
    const res = await as(alice)(`${base}/books/${edition}/guide/generate`, { body: { source: "template" } });
    expect(res.status).toBe(201);
    const guide = await json(res);
    expect(guide.source).toBe("template");
    expect(guide.version).toBe(1);
    expect(guide.edition.id).toBe(edition);
    expect(guide.sections.map((s: any) => s.title)).toEqual(["Before you start", "While reading", "At the end", "Beyond the book"]);
    const questions = guide.sections.flatMap((s: any) => s.questions);
    expect(questions.length).toBeGreaterThanOrEqual(12);
    expect(questions.length).toBeLessThanOrEqual(18);
    expect(new Set(questions.map((q: any) => q.id)).size).toBe(questions.length);
    expect(questions.every((q: any) => typeof q.text === "string" && q.text.length > 10)).toBe(true);
    // Genre-aware: the description says "mystery", so mystery questions appear.
    expect(questions.some((q: any) => /suspect|clue|solution/i.test(q.text))).toBe(true);
    expect(questions.some((q: any) => /\{title\}|\{author\}/.test(q.text))).toBe(false);
    const list = await rooms(alice);
    const chapterRoomIds = list.filter((r) => r.kind === "chapter").map((r) => r.id);
    const reflection = list.find((r) => r.kind === "reflection")!;
    const whileReading = guide.sections[1].questions;
    expect(whileReading.every((q: any) => q.roomId === null || chapterRoomIds.includes(q.roomId))).toBe(true);
    expect(whileReading.some((q: any) => chapterRoomIds.includes(q.roomId))).toBe(true);
    expect(whileReading[0].text.startsWith("Chapter")).toBe(true);
    expect(guide.sections[2].questions.every((q: any) => q.roomId === reflection.id)).toBe(true);
    expect(guide.sections[0].questions.every((q: any) => q.roomId === null)).toBe(true);
    // Deterministic.
    const again = await json(await as(alice)(`${base}/books/${edition}/guide/generate`, { body: { source: "template" } }));
    expect(again.version).toBe(2);
    expect(again.sections).toEqual(guide.sections);
    // Pinned questions appear on the room once the viewer has unlocked it.
    await setProgress(alice, { finished: true });
    const room = await json(await as(alice)(`${base}/rooms/${reflection.id}`));
    expect(room.questions.length).toBe(guide.sections[2].questions.length);

    // Manual edit with optimistic concurrency.
    const edited = await as(alice)(`${base}/books/${edition}/guide`, {
      method: "PUT",
      body: { sections: [{ title: "Our questions", questions: [{ text: "Who did it?", roomId: reflection.id }, { id: "keep-me", text: "Why the garden?" }] }], expectedVersion: 2 },
    });
    expect(edited.status).toBe(200);
    const manual = await json(edited);
    expect(manual.source).toBe("manual");
    expect(manual.version).toBe(3);
    expect(manual.updatedBy.id).toBe(alice.id);
    expect(manual.sections[0].questions[1].id).toBe("keep-me");
    expect(manual.sections[0].questions[0].id).toBeTruthy();
    const stale = await as(alice)(`${base}/books/${edition}/guide`, { method: "PUT", body: { sections: [], expectedVersion: 2 } });
    expect(stale.status).toBe(409);
    expect((await json(stale)).error.current.version).toBe(3);
    expect((await as(alice)(`${base}/books/${edition}/guide`, { method: "PUT", body: { sections: [{ title: "x", questions: [{ text: "y", roomId: "nope" }] }] } })).status).toBe(400);
    expect((await as(bob)(`${base}/books/${edition}/guide`, { method: "PUT", body: { sections: [] } })).status).toBe(403);
    expect((await json(await as(bob)(`${base}/books/${edition}/guide`))).version).toBe(3);

    const ai = await as(alice)(`${base}/books/${edition}/guide/generate`, { body: { source: "ai" } });
    expect(ai.status).toBe(409);
    expect(await json(ai)).toEqual({ error: { code: "ai_unavailable", message: "AI guides need an API key; the template guide works without one." } });
  });

  it("calls the Claude Messages API when a key is present and rejects bad replies", async () => {
    vi.restoreAllMocks();
    const calls: { url: string; init?: RequestInit }[] = [];
    let reply: Response | (() => Response) = () =>
      Response.json({
        content: [
          {
            type: "text",
            text: '```json\n{"sections":[{"title":"Before you start","questions":["What do you expect from a garden mystery?"]},{"title":"At the end","questions":["Was the solution fair?","Who changed most?"]}]}\n```',
          },
        ],
      });
    installFetchMock((url, init) => {
      if (url === "https://api.anthropic.com/v1/messages") {
        calls.push({ url, init });
        return typeof reply === "function" ? reply() : reply;
      }
      return undefined;
    });
    const envWithKey = { ...testEnv, ANTHROPIC_API_KEY: "sk-test" };
    const { generateGuideWithAi } = await import("../../worker/lib/ai");
    const sections = await generateGuideWithAi(envWithKey as any, { title: "The Gated Garden Mystery", authors: ["Test Author"], description: null, genres: ["Mystery"], chapters: 3 });
    expect(sections).toEqual([
      { title: "Before you start", questions: [{ id: "ai1", text: "What do you expect from a garden mystery?", roomId: null }] },
      { title: "At the end", questions: [{ id: "ai2", text: "Was the solution fair?", roomId: null }, { id: "ai3", text: "Who changed most?", roomId: null }] },
    ]);
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("x-api-key")).toBe("sk-test");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.max_tokens).toBe(1500);
    expect(body.messages[0].content).toContain("The Gated Garden Mystery");
    reply = () => Response.json({ content: [{ type: "text", text: "Sorry, I cannot help with that." }] });
    await expect(generateGuideWithAi(envWithKey as any, { title: "x", authors: [], description: null, genres: [], chapters: null })).rejects.toMatchObject({ status: 502, code: "ai_failed" });
    reply = () => new Response("overloaded", { status: 529 });
    await expect(generateGuideWithAi(envWithKey as any, { title: "x", authors: [], description: null, genres: [], chapters: null })).rejects.toMatchObject({ status: 502, code: "ai_failed" });
  });
});

describe("isolation", () => {
  it("rooms, progress and guides never cross club boundaries", async () => {
    const other = await createClub(alice, "Other Club");
    const otherBase = `/api/clubs/${other.id}`;
    expect(await json(await as(alice)(`${otherBase}/books/${edition}/rooms`))).toEqual([]);
    expect((await as(alice)(`${otherBase}/books/${edition}/guide`)).status).toBe(404);
    expect(await json(await as(alice)(`${otherBase}/books/${edition}/progress`))).toEqual({ chapter: null, page: null, percent: null, finished: false, updatedAt: null });
    const list = await rooms(alice);
    expect((await as(alice)(`${otherBase}/rooms/${list[0].id}`)).status).toBe(404);
    expect((await as(alice)(`${otherBase}/conversations/${list[0].conversationId}/messages`)).status).toBe(404);
    expect((await as(alice)(`${otherBase}/rooms/${list[0].id}`, { method: "DELETE" })).status).toBe(404);
    // Members of the other club alone see nothing of this club's rooms.
    const stranger = await createMember("room_stranger");
    await addToClub(alice, other, stranger);
    expect((await as(stranger)(`${base}/books/${edition}/rooms`)).status).toBe(403);
    expect((await as(stranger)(`${base}/rooms/${list[0].id}`)).status).toBe(403);
    expect((await json<any[]>(await as(stranger)(`${otherBase}/books/${edition}/progress/all`))).map((m) => m.id).sort()).toEqual([alice.id, stranger.id].sort());
    expect((await as(alice)(`${base}/books/no_such_edition/rooms/auto`, { body: { chapters: 2 } })).status).toBe(404);
  });
});
