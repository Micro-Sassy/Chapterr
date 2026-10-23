import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "../../shared/types";
import type { RealtimeEventWave2 } from "../../shared/types-chat";
import { runCatchUpDigests, runScheduledMessages } from "../../worker/lib/digest";
import { postWelcome } from "../../worker/lib/welcome";
import { addToClub, as, call, createClub, createMember, installFetchMock, json, latestEmail, mainConversation, testEnv, type Member, type TestClub } from "./helpers";

type AnyEvent = RealtimeEvent | RealtimeEventWave2;

let alice: Member;
let bob: Member;
let carol: Member;
let club: TestClub;
let base: string;
let clubConv: string;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  installFetchMock();
  alice = await createMember("msg_a");
  bob = await createMember("msg_b");
  carol = await createMember("msg_c");
  club = await createClub(alice, "Chatty Club");
  await addToClub(alice, club, bob);
  await addToClub(alice, club, carol);
  base = `/api/clubs/${club.id}`;
  clubConv = await mainConversation(alice, club.id);
  vi.restoreAllMocks();
});

async function openSocket(member: Member, clubId = club.id): Promise<{ ws: WebSocket; events: AnyEvent[] }> {
  const res = await as(member)(`/api/clubs/${clubId}/realtime`, { headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const events: AnyEvent[] = [];
  ws.addEventListener("message", (e) => {
    events.push(JSON.parse(e.data as string));
  });
  ws.accept();
  return { ws, events };
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("club conversation", () => {
  it("all members can read and post; sender alone can edit and remove", async () => {
    const posted = await json(await as(alice)(`${base}/conversations/${clubConv}/messages`, { body: { body: "Hello club" } }));
    expect(posted.sender.id).toBe(alice.id);
    const list = await json(await as(bob)(`${base}/conversations/${clubConv}/messages`));
    expect(list.items.some((m: any) => m.id === posted.id)).toBe(true);
    expect(list.nextCursor).toBeNull();

    expect((await as(bob)(`${base}/messages/${posted.id}`, { method: "PATCH", body: { body: "tampered" } })).status).toBe(403);
    expect((await as(bob)(`${base}/messages/${posted.id}`, { method: "DELETE" })).status).toBe(403);

    const edited = await json(await as(alice)(`${base}/messages/${posted.id}`, { method: "PUT", body: { body: "Hello club again" } }));
    expect(edited.editedAt).toBeTruthy();
    const removed = await json(await as(alice)(`${base}/messages/${posted.id}`, { method: "DELETE" }));
    expect(removed.body).toBeNull();
    expect(removed.deletedAt).toBeTruthy();
    const after = await json(await as(bob)(`${base}/conversations/${clubConv}/messages`));
    const m = after.items.find((x: any) => x.id === posted.id);
    expect(m.body).toBeNull();
    // The removed text is not retained in the database.
    const { env } = await import("cloudflare:test");
    const row = await env.DB.prepare("SELECT body FROM messages WHERE id = ?").bind(posted.id).first<{ body: string | null }>();
    expect(row?.body).toBeNull();
  });

  it("pages messages newest-first with a timestamp cursor", async () => {
    for (let i = 0; i < 5; i++) await as(bob)(`${base}/conversations/${clubConv}/messages`, { body: { body: `page ${i}` } });
    const page1 = await json(await as(alice)(`${base}/conversations/${clubConv}/messages?limit=3`));
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).toBeTruthy();
    // Items within a page are chronological; the cursor fetches older ones.
    expect(page1.items[0].createdAt <= page1.items[2].createdAt).toBe(true);
    const page2 = await json(await as(alice)(`${base}/conversations/${clubConv}/messages?limit=3&cursor=${encodeURIComponent(page1.nextCursor)}`));
    expect(page2.items.every((m: any) => m.createdAt < page1.nextCursor)).toBe(true);
    expect((await as(alice)(`${base}/conversations/${clubConv}/messages?cursor=garbage`)).status).toBe(400);
  });

  it("requires authentication and membership", async () => {
    expect((await call(`${base}/conversations/${clubConv}/messages`)).status).toBe(401);
    expect((await call(`${base}/realtime`, { headers: { Upgrade: "websocket" } })).status).toBe(401);
    const outsider = await createMember("msg_out");
    expect((await as(outsider)(`${base}/conversations`)).status).toBe(403);
    expect((await as(outsider)(`${base}/conversations/${clubConv}/messages`, { body: { body: "intrude" } })).status).toBe(403);
    expect((await as(outsider)(`${base}/realtime`, { headers: { Upgrade: "websocket" } })).status).toBe(403);
  });
});

describe("direct conversations", () => {
  it("only the two participants can read or post", async () => {
    const { id } = await json(await as(alice)(`${base}/conversations/direct`, { body: { userId: bob.id } }));
    const again = await json(await as(bob)(`${base}/conversations/direct`, { body: { userId: alice.id } }));
    expect(again.id).toBe(id);

    await as(alice)(`${base}/conversations/${id}/messages`, { body: { body: "Just for Bob" } });
    expect((await as(bob)(`${base}/conversations/${id}/messages`)).status).toBe(200);
    expect((await as(carol)(`${base}/conversations/${id}/messages`)).status).toBe(404);
    expect((await as(carol)(`${base}/conversations/${id}/messages`, { body: { body: "intrude" } })).status).toBe(404);
    const carolList = await json<any[]>(await as(carol)(`${base}/conversations`));
    expect(carolList.find((c) => c.id === id)).toBeUndefined();
    const bobList = await json<any[]>(await as(bob)(`${base}/conversations`));
    const conv = bobList.find((c) => c.id === id);
    expect(conv.unreadCount).toBe(1);
    expect(conv.clubId).toBe(club.id);
    expect(conv.otherMember.id).toBe(alice.id);
    await as(bob)(`${base}/conversations/${id}/read`, { body: {} });
    expect((await json<any[]>(await as(bob)(`${base}/conversations`))).find((c) => c.id === id).unreadCount).toBe(0);
    // Bob was notified about the DM, inside this club.
    const notes = await json<{ items: any[] }>(await as(bob)("/api/notifications"));
    const dm = notes.items.find((n) => n.kind === "direct_message");
    expect(dm.clubId).toBe(club.id);
    expect(dm.link).toBe(`/c/${club.id}/messages/${id}`);
  });

  it("direct conversations are per club and only with members of that club", async () => {
    const second = await createClub(alice, "Second Club");
    await addToClub(alice, second, bob);
    const a = await json(await as(alice)(`${base}/conversations/direct`, { body: { userId: bob.id } }));
    const b = await json(await as(alice)(`/api/clubs/${second.id}/conversations/direct`, { body: { userId: bob.id } }));
    expect(a.id).not.toBe(b.id);
    // Carol is not in the second club: no DM possible there, and the first club's DM is invisible there.
    expect((await as(alice)(`/api/clubs/${second.id}/conversations/direct`, { body: { userId: carol.id } })).status).toBe(404);
    expect((await as(alice)(`/api/clubs/${second.id}/conversations/${a.id}/messages`)).status).toBe(404);
  });

  it("delivers realtime events only to participants, on the club's channel", async () => {
    const { id } = await json(await as(alice)(`${base}/conversations/direct`, { body: { userId: carol.id } }));
    const bobSock = await openSocket(bob);
    const carolSock = await openSocket(carol);
    await tick();
    expect(carolSock.events.some((e) => e.type === "hello" && e.clubId === club.id && e.userId === carol.id)).toBe(true);
    await as(alice)(`${base}/conversations/${id}/messages`, { body: { body: "secret for carol" } });
    await tick(150);
    const carolGot = carolSock.events.filter((e) => e.type === "message.created");
    const bobGot = bobSock.events.filter((e) => e.type === "message.created");
    expect(carolGot.some((e) => e.type === "message.created" && e.message.body === "secret for carol")).toBe(true);
    expect(bobGot.some((e) => e.type === "message.created" && e.message.body === "secret for carol")).toBe(false);

    // Club messages reach everyone connected to this club.
    await as(alice)(`${base}/conversations/${clubConv}/messages`, { body: { body: "club broadcast" } });
    await tick(150);
    expect(bobSock.events.some((e) => e.type === "message.created" && e.message.body === "club broadcast")).toBe(true);
    bobSock.ws.close();
    carolSock.ws.close();
  });

  it("closes a removed member's sockets after telling them the membership ended", async () => {
    const dave = await createMember("msg_d");
    await addToClub(alice, club, dave);
    const sock = await openSocket(dave);
    await tick();
    let closed = false;
    sock.ws.addEventListener("close", () => {
      closed = true;
    });
    expect((await as(alice)(`${base}/members/${dave.id}`, { method: "DELETE" })).status).toBe(200);
    await tick(200);
    expect(sock.events.some((e) => e.type === "membership.ended" && e.clubId === club.id)).toBe(true);
    expect(closed).toBe(true);
    expect((await as(dave)(`${base}/conversations`)).status).toBe(403);
  });

  it("rejects cross-origin WebSocket upgrades", async () => {
    const res = await as(bob)(`${base}/realtime`, { headers: { Upgrade: "websocket" }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Feature wave 2 (W2): mentions, threads, reactions, attachments, scheduled, welcome, digest
// ---------------------------------------------------------------------------

async function post(member: Member, conversationId: string, body: Record<string, unknown>, clubId = club.id) {
  return as(member)(`/api/clubs/${clubId}/conversations/${conversationId}/messages`, { body });
}

async function notificationsOf(member: Member, kind: string) {
  const notes = await json<{ items: any[] }>(await as(member)("/api/notifications?limit=100"));
  return notes.items.filter((n) => n.kind === kind);
}

async function seedAttachment(ownerId: string, clubId: string, kind = "attachment"): Promise<string> {
  const id = `file_${Math.random().toString(36).slice(2, 12)}`;
  await testEnv.DB.prepare(
    "INSERT INTO files (id, club_id, owner_id, kind, title, content_type, size, storage, created_at) VALUES (?, ?, ?, ?, 'photo.jpg', 'image/jpeg', 1234, 'd1', ?)",
  )
    .bind(id, clubId, ownerId, kind, new Date().toISOString())
    .run();
  return id;
}

describe("mentions", () => {
  it("resolves @username tokens to club members, case-insensitively, and notifies them", async () => {
    const before = (await notificationsOf(alice, "mention")).length;
    const body = `Hey @${alice.username.toUpperCase()} and @nobody_here_123, look at this`;
    const msg = await json(await post(bob, clubConv, { body }));
    expect(msg.kind).toBe("user");
    expect(msg.mentions.map((m: any) => m.id)).toEqual([alice.id]);
    expect(msg.reactions).toEqual([]);
    expect(msg.attachments).toEqual([]);
    expect(msg.replyCount).toBe(0);
    expect(msg.parentId).toBeNull();
    const notes = await notificationsOf(alice, "mention");
    expect(notes.length).toBe(before + 1);
    expect(notes[0].link).toBe(`/c/${club.id}/messages/${clubConv}?message=${msg.id}`);
    expect(notes[0].actor.id).toBe(bob.id);
    // Mentioning yourself does not notify you.
    const selfBefore = (await notificationsOf(bob, "mention")).length;
    await post(bob, clubConv, { body: `note to self @${bob.username}` });
    expect((await notificationsOf(bob, "mention")).length).toBe(selfBefore);
    // Members of other clubs are never resolved.
    const outsider = await createMember("msg_mention_out");
    const m2 = await json(await post(bob, clubConv, { body: `@${outsider.username} are you there` }));
    expect(m2.mentions).toEqual([]);
  });
});

describe("threads", () => {
  it("replies hang off a top-level message, bump its count and are listed chronologically", async () => {
    const parent = await json(await post(alice, clubConv, { body: "Thread starter" }));
    const carolSock = await openSocket(carol);
    await tick();
    const r1 = await json(await post(bob, clubConv, { body: "first reply", parentId: parent.id }));
    expect(r1.parentId).toBe(parent.id);
    const r2 = await json(await post(carol, clubConv, { body: "second reply", parentId: parent.id }));
    await tick(150);
    // A reply to a reply is not allowed; replies must be in the same conversation.
    expect((await post(bob, clubConv, { body: "nested", parentId: r1.id })).status).toBe(400);
    const { id: dm } = await json(await as(alice)(`${base}/conversations/direct`, { body: { userId: bob.id } }));
    expect((await post(alice, dm, { body: "wrong conversation", parentId: parent.id })).status).toBe(404);

    const list = await json(await as(alice)(`${base}/conversations/${clubConv}/messages?limit=100`));
    const top = list.items.find((m: any) => m.id === parent.id);
    expect(top.replyCount).toBe(2);
    expect(list.items.some((m: any) => m.id === r1.id || m.id === r2.id)).toBe(false);

    const thread = await json(await as(alice)(`${base}/messages/${parent.id}/thread`));
    expect(thread.parent.id).toBe(parent.id);
    expect(thread.items.map((m: any) => m.id)).toEqual([r1.id, r2.id]);
    expect(thread.nextCursor).toBeNull();
    const page1 = await json(await as(alice)(`${base}/messages/${parent.id}/thread?limit=1`));
    expect(page1.items.map((m: any) => m.id)).toEqual([r1.id]);
    const page2 = await json(await as(alice)(`${base}/messages/${parent.id}/thread?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`));
    expect(page2.items.map((m: any) => m.id)).toEqual([r2.id]);

    const replyEvents = carolSock.events.filter((e): e is Extract<AnyEvent, { type: "thread.reply" }> => e.type === "thread.reply");
    expect(replyEvents.some((e) => e.parentId === parent.id && e.replyCount === 1 && e.message.id === r1.id)).toBe(true);
    expect(carolSock.events.some((e) => e.type === "message.created" && (e as any).message.id === r1.id)).toBe(false);
    carolSock.ws.close();
    // The parent's author hears about replies from others.
    const notes = await notificationsOf(alice, "thread_reply");
    expect(notes.some((n) => n.actor.id === bob.id && n.link.includes(`message=${r1.id}`))).toBe(true);
  });
});

describe("reactions", () => {
  it("toggles per member, summarises counts and notifies the author once per hour", async () => {
    const msg = await json(await post(alice, clubConv, { body: "React to me" }));
    const bobSock = await openSocket(bob);
    await tick();
    const on = await json(await as(bob)(`${base}/messages/${msg.id}/reactions`, { method: "PUT", body: { emoji: "📚" } }));
    expect(on.mine).toBe(true);
    expect(on.reactions).toEqual([{ emoji: "📚", count: 1, mine: true }]);
    await as(carol)(`${base}/messages/${msg.id}/reactions`, { method: "PUT", body: { emoji: "📚" } });
    await as(carol)(`${base}/messages/${msg.id}/reactions`, { method: "PUT", body: { emoji: "🔥" } });
    const seen = await json(await as(alice)(`${base}/conversations/${clubConv}/messages?limit=100`));
    const m = seen.items.find((x: any) => x.id === msg.id);
    expect(m.reactions).toEqual([
      { emoji: "📚", count: 2, mine: false },
      { emoji: "🔥", count: 1, mine: false },
    ]);
    const off = await json(await as(bob)(`${base}/messages/${msg.id}/reactions`, { method: "PUT", body: { emoji: "📚" } }));
    expect(off.mine).toBe(false);
    expect(off.reactions.find((r: any) => r.emoji === "📚")).toEqual({ emoji: "📚", count: 1, mine: false });
    expect((await as(bob)(`${base}/messages/${msg.id}/reactions`, { method: "PUT", body: { emoji: "🦄" } })).status).toBe(422);
    await tick(150);
    const events = bobSock.events.filter((e): e is Extract<AnyEvent, { type: "message.reaction" }> => e.type === "message.reaction");
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[events.length - 1]!.messageId).toBe(msg.id);
    bobSock.ws.close();
    // Three reactions from two people, but a single notice for the author within the hour.
    const notes = (await notificationsOf(alice, "reaction")).filter((n) => n.link.includes(`message=${msg.id}`));
    expect(notes).toHaveLength(1);
    // Removed messages cannot be reacted to.
    const gone = await json(await post(alice, clubConv, { body: "going away" }));
    await as(alice)(`${base}/messages/${gone.id}`, { method: "DELETE" });
    expect((await as(bob)(`${base}/messages/${gone.id}/reactions`, { method: "PUT", body: { emoji: "👍" } })).status).toBe(400);
  });
});

describe("attachments", () => {
  it("accepts only the sender's own attachment files from this club", async () => {
    const fileId = await seedAttachment(bob.id, club.id);
    const msg = await json(await post(bob, clubConv, { body: "", attachmentFileIds: [fileId] }));
    expect(msg.body).toBe("");
    expect(msg.attachments).toEqual([{ fileId, contentType: "image/jpeg", width: null, height: null, title: "photo.jpg", url: `/api/clubs/${club.id}/files/${fileId}/content` }]);
    // Someone else's file, a non-attachment file, a file in another club, an unknown id.
    expect((await post(alice, clubConv, { body: "mine?", attachmentFileIds: [fileId] })).status).toBe(422);
    const photo = await seedAttachment(bob.id, club.id, "photo");
    expect((await post(bob, clubConv, { body: "doc", attachmentFileIds: [photo] })).status).toBe(422);
    const other = await createClub(bob, "Bob's Other Club");
    const elsewhere = await seedAttachment(bob.id, other.id);
    expect((await post(bob, clubConv, { body: "x", attachmentFileIds: [elsewhere] })).status).toBe(422);
    expect((await post(bob, clubConv, { body: "x", attachmentFileIds: ["nope"] })).status).toBe(422);
    // Empty message without an attachment is rejected; too many attachments too.
    expect((await post(bob, clubConv, { body: "   " })).status).toBe(422);
    const many = await Promise.all([1, 2, 3, 4, 5].map(() => seedAttachment(bob.id, club.id)));
    expect((await post(bob, clubConv, { body: "", attachmentFileIds: many })).status).toBe(422);
    // Removing the message drops its attachments.
    const removed = await json(await as(bob)(`${base}/messages/${msg.id}`, { method: "DELETE" }));
    expect(removed.attachments).toEqual([]);
  });
});

describe("scheduled messages", () => {
  it("creates, lists, cancels and sends through the normal path on the cron tick", async () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    expect((await as(bob)(`${base}/scheduled`, { body: { conversationId: clubConv, body: "too soon", sendAt: soon } })).status).toBe(400);
    const far = new Date(Date.now() + 91 * 86_400_000).toISOString();
    expect((await as(bob)(`${base}/scheduled`, { body: { conversationId: clubConv, body: "too far", sendAt: far } })).status).toBe(400);
    const sendAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const created = await json(await as(bob)(`${base}/scheduled`, { body: { conversationId: clubConv, body: `Scheduled hello @${alice.username}`, sendAt } }));
    expect(created.conversationTitle).toBe(club.name);
    expect(created.sendAt).toBe(sendAt);
    const canceled = await json(await as(bob)(`${base}/scheduled`, { body: { conversationId: clubConv, body: "never mind", sendAt } }));
    // Only the owner sees their pending sends.
    expect((await json<any[]>(await as(bob)(`${base}/scheduled`))).map((s) => s.id).sort()).toEqual([created.id, canceled.id].sort());
    expect(await json(await as(alice)(`${base}/scheduled`))).toEqual([]);
    expect((await as(alice)(`${base}/scheduled/${created.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await as(bob)(`${base}/scheduled/${canceled.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(bob)(`${base}/scheduled/${canceled.id}`, { method: "DELETE" })).status).toBe(404);
    // Not yet due: nothing happens.
    await runScheduledMessages(testEnv, new Date());
    expect((await json<any[]>(await as(bob)(`${base}/scheduled`))).map((s) => s.id)).toEqual([created.id]);
    const mentionsBefore = (await notificationsOf(alice, "mention")).length;
    await runScheduledMessages(testEnv, new Date(Date.parse(sendAt) + 1000));
    expect(await json(await as(bob)(`${base}/scheduled`))).toEqual([]);
    const row = await testEnv.DB.prepare("SELECT sent_message_id, sent_at, canceled_at FROM scheduled_messages WHERE id = ?").bind(created.id).first<any>();
    expect(row.sent_message_id).toBeTruthy();
    expect(row.sent_at).toBeTruthy();
    const list = await json(await as(alice)(`${base}/conversations/${clubConv}/messages?limit=100`));
    const sent = list.items.find((m: any) => m.id === row.sent_message_id);
    expect(sent.sender.id).toBe(bob.id);
    expect(sent.mentions.map((m: any) => m.id)).toEqual([alice.id]);
    expect((await notificationsOf(alice, "mention")).length).toBe(mentionsBefore + 1);
    // Running the tick again sends nothing twice; the canceled one stays canceled.
    await runScheduledMessages(testEnv, new Date(Date.parse(sendAt) + 2000));
    const n = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND body = ?").bind(bob.id, `Scheduled hello @${alice.username}`).first<{ n: number }>();
    expect(n?.n).toBe(1);
    const c2 = await testEnv.DB.prepare("SELECT sent_at, canceled_at FROM scheduled_messages WHERE id = ?").bind(canceled.id).first<any>();
    expect(c2.sent_at).toBeNull();
    expect(c2.canceled_at).toBeTruthy();
  });

  it("cancels sends from members who left and enforces the pending limit", async () => {
    const dave = await createMember("msg_sched_d");
    await addToClub(alice, club, dave);
    const sendAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const s = await json(await as(dave)(`${base}/scheduled`, { body: { conversationId: clubConv, body: "from dave", sendAt } }));
    expect((await as(alice)(`${base}/members/${dave.id}`, { method: "DELETE" })).status).toBe(200);
    await runScheduledMessages(testEnv, new Date(Date.parse(sendAt) + 1000));
    const row = await testEnv.DB.prepare("SELECT sent_message_id, canceled_at FROM scheduled_messages WHERE id = ?").bind(s.id).first<any>();
    expect(row.sent_message_id).toBeNull();
    expect(row.canceled_at).toBeTruthy();

    const erin = await createMember("msg_sched_e");
    await addToClub(alice, club, erin);
    for (let i = 0; i < 20; i++) {
      expect((await as(erin)(`${base}/scheduled`, { body: { conversationId: clubConv, body: `queued ${i}`, sendAt } })).status).toBe(201);
    }
    const over = await as(erin)(`${base}/scheduled`, { body: { conversationId: clubConv, body: "one too many", sendAt } });
    expect(over.status).toBe(409);
    expect((await json(over)).error.code).toBe("limit_reached");
    // Cannot schedule into a conversation you cannot read.
    const { id: dm } = await json(await as(alice)(`${base}/conversations/direct`, { body: { userId: bob.id } }));
    expect((await as(erin)(`${base}/scheduled`, { body: { conversationId: dm, body: "sneaky", sendAt } })).status).toBe(404);
  });
});

describe("welcome message", () => {
  it("posts a welcome into the club chat addressed to the newcomer and DMs them from the owner", async () => {
    // The join flow calls postWelcome itself; add the member before the message is set so this test exercises one explicit call.
    const warm = await createClub(alice, "Warm Club");
    const newbie = await createMember("msg_newbie");
    await addToClub(alice, warm, newbie);
    await testEnv.DB.prepare("UPDATE clubs SET welcome_message = ? WHERE id = ?").bind("So glad you are here. Say hello and tell us what you are reading.", warm.id).run();
    await postWelcome(testEnv, warm.id, newbie.id);
    const conv = await mainConversation(alice, warm.id);
    const list = await json(await as(newbie)(`/api/clubs/${warm.id}/conversations/${conv}/messages`));
    const welcome = list.items.find((m: any) => m.kind === "welcome");
    expect(welcome).toBeTruthy();
    expect(welcome.sender.id).toBe(alice.id);
    expect(welcome.body).toBe(`@${newbie.username} So glad you are here. Say hello and tell us what you are reading.`);
    expect(welcome.mentions.map((m: any) => m.id)).toEqual([newbie.id]);
    const convs = await json<any[]>(await as(newbie)(`/api/clubs/${warm.id}/conversations`));
    const dm = convs.find((c) => c.kind === "direct");
    expect(dm.otherMember.id).toBe(alice.id);
    expect(dm.lastMessagePreview).toBe("So glad you are here. Say hello and tell us what you are reading.");
    const notes = await json<{ items: any[] }>(await as(newbie)("/api/notifications"));
    expect(notes.items.filter((n) => n.kind === "welcome" && n.clubId === warm.id)).toHaveLength(1);
    expect(notes.items.some((n) => n.kind === "direct_message" && n.clubId === warm.id)).toBe(false);
    // Clubs without a welcome message post nothing.
    const quiet = await createClub(alice, "Quiet Club");
    await addToClub(alice, quiet, newbie);
    await postWelcome(testEnv, quiet.id, newbie.id);
    const quietConv = await mainConversation(alice, quiet.id);
    expect((await json(await as(newbie)(`/api/clubs/${quiet.id}/conversations/${quietConv}/messages`))).items).toEqual([]);
  });
});

describe("catch-up digest", () => {
  it("notifies members with 10+ unread messages once a day, with an email when club updates are on", async () => {
    const busy = await createClub(alice, "Busy Club");
    await addToClub(alice, busy, bob);
    await addToClub(alice, busy, carol);
    const conv = await mainConversation(alice, busy.id);
    await testEnv.DB.prepare(
      "INSERT INTO notification_preferences (user_id, email_club_updates, updated_at) VALUES (?, 1, ?) ON CONFLICT (user_id) DO UPDATE SET email_club_updates = 1",
    )
      .bind(alice.id, new Date().toISOString())
      .run();
    for (let i = 0; i < 9; i++) await post(bob, conv, { body: `chatter ${i}` }, busy.id);
    const now = new Date();
    await runCatchUpDigests(testEnv, now);
    const none = (await notificationsOf(alice, "digest")).filter((n) => n.clubId === busy.id);
    expect(none).toHaveLength(0);
    const loud = await json(await post(bob, conv, { body: "the tenth message, much loved" }, busy.id));
    await as(carol)(`/api/clubs/${busy.id}/messages/${loud.id}/reactions`, { method: "PUT", body: { emoji: "❤️" } });
    // Carol has read everything; Bob wrote it all.
    await as(carol)(`/api/clubs/${busy.id}/conversations/${conv}/read`, { body: {} });
    await runCatchUpDigests(testEnv, now);
    const notes = (await notificationsOf(alice, "digest")).filter((n) => n.clubId === busy.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Catch up on Busy Club");
    expect(notes[0].body).toContain("10 new messages");
    expect(notes[0].link).toBe(`/c/${busy.id}/messages/${conv}`);
    expect((await notificationsOf(bob, "digest")).filter((n) => n.clubId === busy.id)).toHaveLength(0);
    expect((await notificationsOf(carol, "digest")).filter((n) => n.clubId === busy.id)).toHaveLength(0);
    const mail = await latestEmail(alice.email);
    expect(mail?.subject).toContain("Busy Club: what you missed");
    expect(mail?.text_body).toContain("the tenth message, much loved");
    expect(mail?.text_body).toContain("1 reaction");
    // Same tick again, or a tick later the same day: nothing new.
    await runCatchUpDigests(testEnv, now);
    await runCatchUpDigests(testEnv, new Date(now.getTime() + 3600_000));
    expect((await notificationsOf(alice, "digest")).filter((n) => n.clubId === busy.id)).toHaveLength(1);
    // A day later with no new messages: still nothing (already digested through the last message).
    await runCatchUpDigests(testEnv, new Date(now.getTime() + 25 * 3600_000));
    expect((await notificationsOf(alice, "digest")).filter((n) => n.clubId === busy.id)).toHaveLength(1);
    const delivered = await testEnv.DB.prepare("SELECT through_message_id FROM digest_deliveries WHERE user_id = ? AND conversation_id = ?").bind(alice.id, conv).first<any>();
    expect(delivered.through_message_id).toBe(loud.id);
  });
});
