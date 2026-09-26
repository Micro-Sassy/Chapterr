import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { as, call, createMember, installFetchMock, json, seedEdition, testEnv, type Member } from "./helpers";

let alice: Member;
let bob: Member;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  installFetchMock();
  alice = await createMember("share_a");
  bob = await createMember("share_b");
  vi.restoreAllMocks();
});

const token = (url: string) => url.split("/s/")[1]!;

describe("public share links", () => {
  it("creates a Turnstile-protected link that exposes only the shared review", async () => {
    const ed = await seedEdition("Shareable Book");
    const review = await json(await as(alice)("/api/reviews", { body: { editionId: ed, body: "Loved every page", sentiment: "loved", visibility: "private" } }));
    expect((await as(alice)("/api/shares", { body: { resourceType: "review", resourceId: review.id } })).status).toBe(403);
    const link = await json(
      await as(alice)("/api/shares", { body: { resourceType: "review", resourceId: review.id }, headers: { "x-turnstile-token": "ok" } }),
    );
    expect(link.url).toMatch(/\/s\/[A-Za-z0-9_-]{40,}$/);

    // The token itself is not stored.
    const stored = await testEnv.DB.prepare("SELECT token_hash FROM share_links WHERE id = ?").bind(link.id).first<{ token_hash: string }>();
    expect(stored?.token_hash).not.toBe(token(link.url));

    const pub = await call(`/api/public/shares/${token(link.url)}`, { origin: null });
    expect(pub.status).toBe(200);
    const body = await json(pub);
    expect(body).toMatchObject({ type: "review", body: "Loved every page", sentiment: "loved" });
    expect(JSON.stringify(body)).not.toContain(alice.email);
    expect(JSON.stringify(body)).not.toContain(alice.id);
  });

  it("members cannot share someone else's review", async () => {
    const ed = await seedEdition("Not Yours");
    const review = await json(await as(alice)("/api/reviews", { body: { editionId: ed, body: "Mine", sentiment: "liked", visibility: "club" } }));
    const res = await as(bob)("/api/shares", { body: { resourceType: "review", resourceId: review.id }, headers: { "x-turnstile-token": "ok" } });
    expect(res.status).toBe(404);
  });

  it("chats can never be shared", async () => {
    const res = await as(alice)("/api/shares", {
      body: { resourceType: "conversation", resourceId: "club" },
      headers: { "x-turnstile-token": "ok" },
    });
    expect(res.status).toBe(422);
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO share_links (id, token_hash, created_by, resource_type, resource_id, created_at) VALUES ('x', 'y', ?, 'message', 'club', '2026')",
      )
        .bind(alice.id)
        .run(),
    ).rejects.toThrow();
  });

  it("revoked and expired links stop working; unknown tokens 404", async () => {
    const ed = await seedEdition("Quote Source");
    const quote = await json(await as(alice)("/api/quotes", { body: { editionId: ed, text: "So it goes.", visibility: "club" } }));
    const link = await json(await as(alice)("/api/shares", { body: { resourceType: "quote", resourceId: quote.id }, headers: { "x-turnstile-token": "ok" } }));
    expect((await call(`/api/public/shares/${token(link.url)}`)).status).toBe(200);
    expect((await as(bob)(`/api/shares/${link.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await as(alice)(`/api/shares/${link.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await call(`/api/public/shares/${token(link.url)}`)).status).toBe(404);
    expect((await call(`/api/public/shares/${"a".repeat(43)}`)).status).toBe(404);

    const exp = await json(await as(alice)("/api/shares", { body: { resourceType: "quote", resourceId: quote.id, expiresInDays: 1 }, headers: { "x-turnstile-token": "ok" } }));
    await testEnv.DB.prepare("UPDATE share_links SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(exp.id).run();
    expect((await call(`/api/public/shares/${token(exp.url)}`)).status).toBe(404);
  });

  it("reading-list shares include only club-visible items", async () => {
    const pub = await seedEdition("Public Finish");
    const priv = await seedEdition("Private Finish");
    await as(bob)(`/api/library/editions/${pub}`, { method: "PUT", body: { editionId: pub, status: "finished", visibility: "club" } });
    await as(bob)(`/api/library/editions/${priv}`, { method: "PUT", body: { editionId: priv, status: "finished", visibility: "private" } });
    const link = await json(await as(bob)("/api/shares", { body: { resourceType: "reading_list", status: "finished" }, headers: { "x-turnstile-token": "ok" } }));
    const body = await json(await call(`/api/public/shares/${token(link.url)}`));
    const titles = body.items.map((i: any) => i.edition.title);
    expect(titles).toContain("Public Finish");
    expect(titles).not.toContain("Private Finish");
  });
});
