import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "../../shared/types";
import { as, call, createMember, installFetchMock, json, type Member } from "./helpers";

let alice: Member;
let bob: Member;
let carol: Member;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  installFetchMock();
  alice = await createMember("msg_a");
  bob = await createMember("msg_b");
  carol = await createMember("msg_c");
  vi.restoreAllMocks();
});

async function openSocket(member: Member): Promise<{ ws: WebSocket; events: RealtimeEvent[] }> {
  const res = await as(member)("/api/realtime", { headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const events: RealtimeEvent[] = [];
  ws.addEventListener("message", (e) => events.push(JSON.parse(e.data as string)));
  ws.accept();
  return { ws, events };
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("club conversation", () => {
  it("all members can read and post; sender alone can edit and remove", async () => {
    const posted = await json(await as(alice)("/api/conversations/club/messages", { body: { body: "Hello club" } }));
    expect(posted.sender.id).toBe(alice.id);
    const list = await json(await as(bob)("/api/conversations/club/messages"));
    expect(list.messages.some((m: any) => m.id === posted.id)).toBe(true);

    expect((await as(bob)(`/api/messages/${posted.id}`, { method: "PATCH", body: { body: "tampered" } })).status).toBe(403);
    expect((await as(bob)(`/api/messages/${posted.id}`, { method: "DELETE" })).status).toBe(403);

    const edited = await json(await as(alice)(`/api/messages/${posted.id}`, { method: "PATCH", body: { body: "Hello club!" } }));
    expect(edited.editedAt).toBeTruthy();
    const removed = await json(await as(alice)(`/api/messages/${posted.id}`, { method: "DELETE" }));
    expect(removed.body).toBeNull();
    expect(removed.deletedAt).toBeTruthy();
    const after = await json(await as(bob)("/api/conversations/club/messages"));
    const m = after.messages.find((x: any) => x.id === posted.id);
    expect(m.body).toBeNull();
    // The removed text is not retained in the database.
    const { env } = await import("cloudflare:test");
    const row = await env.DB.prepare("SELECT body FROM messages WHERE id = ?").bind(posted.id).first<{ body: string | null }>();
    expect(row?.body).toBeNull();
  });

  it("requires authentication", async () => {
    expect((await call("/api/conversations/club/messages")).status).toBe(401);
    expect((await call("/api/realtime", { headers: { Upgrade: "websocket" } })).status).toBe(401);
  });
});

describe("direct conversations", () => {
  it("only the two participants can read or post", async () => {
    const { id } = await json(await as(alice)("/api/conversations/direct", { body: { userId: bob.id } }));
    const again = await json(await as(bob)("/api/conversations/direct", { body: { userId: alice.id } }));
    expect(again.id).toBe(id);

    await as(alice)(`/api/conversations/${id}/messages`, { body: { body: "Just for Bob" } });
    expect((await as(bob)(`/api/conversations/${id}/messages`)).status).toBe(200);
    expect((await as(carol)(`/api/conversations/${id}/messages`)).status).toBe(404);
    expect((await as(carol)(`/api/conversations/${id}/messages`, { body: { body: "intrude" } })).status).toBe(404);
    const carolList = await json<any[]>(await as(carol)("/api/conversations"));
    expect(carolList.find((c) => c.id === id)).toBeUndefined();
    const bobList = await json<any[]>(await as(bob)("/api/conversations"));
    const conv = bobList.find((c) => c.id === id);
    expect(conv.unreadCount).toBe(1);
    expect(conv.otherMember.id).toBe(alice.id);
    await as(bob)(`/api/conversations/${id}/read`, { body: {} });
    expect((await json<any[]>(await as(bob)("/api/conversations"))).find((c) => c.id === id).unreadCount).toBe(0);
  });

  it("delivers realtime events only to participants", async () => {
    const { id } = await json(await as(alice)("/api/conversations/direct", { body: { userId: carol.id } }));
    const bobSock = await openSocket(bob);
    const carolSock = await openSocket(carol);
    await tick();
    await as(alice)(`/api/conversations/${id}/messages`, { body: { body: "secret for carol" } });
    await tick(150);
    const carolGot = carolSock.events.filter((e) => e.type === "message.created");
    const bobGot = bobSock.events.filter((e) => e.type === "message.created");
    expect(carolGot.some((e) => e.type === "message.created" && e.message.body === "secret for carol")).toBe(true);
    expect(bobGot.some((e) => e.type === "message.created" && e.message.body === "secret for carol")).toBe(false);

    // Club messages reach everyone connected.
    await as(alice)("/api/conversations/club/messages", { body: { body: "club broadcast" } });
    await tick(150);
    expect(bobSock.events.some((e) => e.type === "message.created" && e.message.body === "club broadcast")).toBe(true);
    bobSock.ws.close();
    carolSock.ws.close();
  });

  it("rejects cross-origin WebSocket upgrades", async () => {
    const res = await as(bob)("/api/realtime", { headers: { Upgrade: "websocket" }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});
