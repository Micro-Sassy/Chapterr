import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "../../shared/types";
import { addToClub, as, call, createClub, createMember, installFetchMock, json, mainConversation, type Member, type TestClub } from "./helpers";

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

async function openSocket(member: Member, clubId = club.id): Promise<{ ws: WebSocket; events: RealtimeEvent[] }> {
  const res = await as(member)(`/api/clubs/${clubId}/realtime`, { headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const events: RealtimeEvent[] = [];
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
