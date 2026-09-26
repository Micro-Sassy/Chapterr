import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { as, createMember, installFetchMock, json, seedEdition, type Member } from "./helpers";

let alice: Member;
let bob: Member;
let editionId: string;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());

beforeAll(async () => {
  installFetchMock();
  alice = await createMember("alice");
  bob = await createMember("bob");
  editionId = await seedEdition("Permissions Primer");
  vi.restoreAllMocks();
});

describe("personal library", () => {
  it("members can only change their own shelf entries", async () => {
    const res = await as(alice)(`/api/library/editions/${editionId}`, {
      method: "PUT",
      body: { editionId, status: "reading", visibility: "club", notes: "my secret notes" },
    });
    expect(res.status).toBe(200);
    const entry = await json(res);
    expect(entry.startedAt).toBeTruthy();

    expect((await as(bob)(`/api/library/${entry.id}/progress`, { method: "PATCH", body: { currentPage: 5 } })).status).toBe(403);
    expect((await as(bob)(`/api/library/${entry.id}`, { method: "DELETE" })).status).toBe(403);

    // Bob sees the club-visible entry but never Alice's personal notes.
    const bobView = await json(await as(bob)(`/api/members/${alice.username}/books`));
    expect(bobView).toHaveLength(1);
    expect(bobView[0].notes).toBeNull();
    const aliceView = await json(await as(alice)(`/api/library`));
    expect(aliceView[0].notes).toBe("my secret notes");
  });

  it("private entries are invisible to other members", async () => {
    const privateEd = await seedEdition("Secret Diary");
    await as(alice)(`/api/library/editions/${privateEd}`, { method: "PUT", body: { editionId: privateEd, status: "tbr", visibility: "private" } });
    const bobView = await json<any[]>(await as(bob)(`/api/members/${alice.username}/books`));
    expect(bobView.find((b) => b.edition.id === privateEd)).toBeUndefined();
  });

  it("finishing a book counts toward the personal goal", async () => {
    await as(alice)("/api/goals", { method: "PUT", body: { year: new Date().getUTCFullYear(), target: 12 } });
    await as(alice)(`/api/library/editions/${editionId}`, { method: "PUT", body: { editionId, status: "finished" } });
    const goal = await json(await as(alice)("/api/goals"));
    expect(goal.target).toBe(12);
    expect(goal.completed).toBeGreaterThanOrEqual(1);
  });
});

describe("reviews and quotes", () => {
  it("only the author can edit or delete; others may react", async () => {
    const created = await json(
      await as(alice)("/api/reviews", { body: { editionId, body: "Wonderful", sentiment: "loved", visibility: "club", containsSpoilers: false } }),
    );
    expect(created.isOwn).toBe(true);
    const edit = await as(bob)(`/api/reviews/${created.id}`, { method: "PUT", body: { body: "hacked", sentiment: "hated", visibility: "club" } });
    expect(edit.status).toBe(403);
    expect((await as(bob)(`/api/reviews/${created.id}`, { method: "DELETE" })).status).toBe(403);
    const reacted = await json(await as(bob)(`/api/reviews/${created.id}/reactions`, { body: { reaction: "insightful" } }));
    expect(reacted.reactions.find((r: any) => r.reaction === "insightful")).toMatchObject({ count: 1, mine: true });
    // Alice got an in-app notification about the reaction.
    const notes = await json<any[]>(await as(alice)("/api/notifications"));
    expect(notes.some((n) => n.kind === "review_reaction")).toBe(true);
  });

  it("private reviews and quotes are hidden from others", async () => {
    const ed = await seedEdition("Private Thoughts");
    const review = await json(await as(alice)("/api/reviews", { body: { editionId: ed, body: "meh", sentiment: "mixed", visibility: "private" } }));
    const quote = await json(await as(alice)("/api/quotes", { body: { editionId: ed, text: "A line", visibility: "private" } }));
    const bobReviews = await json<any[]>(await as(bob)(`/api/reviews?editionId=${ed}`));
    expect(bobReviews.find((r) => r.id === review.id)).toBeUndefined();
    const bobQuotes = await json<any[]>(await as(bob)(`/api/quotes?editionId=${ed}`));
    expect(bobQuotes.find((q) => q.id === quote.id)).toBeUndefined();
    expect((await as(bob)(`/api/reviews/${review.id}/reactions`, { body: { reaction: "like" } })).status).toBe(404);
    expect((await as(bob)(`/api/quotes/${quote.id}`, { method: "PUT", body: { text: "x", visibility: "club" } })).status).toBe(403);
  });
});

describe("profiles", () => {
  it("members edit only their own profile", async () => {
    const res = await as(alice)("/api/account/profile", { method: "PUT", body: { displayName: "Alice A.", bio: "Reads a lot" } });
    expect(res.status).toBe(200);
    const bobSees = await json(await as(bob)(`/api/members/${alice.username}`));
    expect(bobSees.displayName).toBe("Alice A.");
    expect(bobSees.profile.bio).toBe("Reads a lot");
    expect(bobSees).not.toHaveProperty("email");
  });
});

describe("recommendations", () => {
  it("direct recommendations are visible only to sender and recipient", async () => {
    const carol = await createMember("carol");
    const rec = await json(await as(alice)("/api/recommendations", { body: { editionId, recipientUserId: bob.id, note: "for you" } }));
    expect((await json<any[]>(await as(bob)("/api/recommendations?scope=received"))).some((r) => r.id === rec.id)).toBe(true);
    expect((await json<any[]>(await as(carol)("/api/recommendations"))).some((r) => r.id === rec.id)).toBe(false);
    expect((await as(bob)(`/api/recommendations/${rec.id}`, { method: "DELETE" })).status).toBe(403);
  });
});
