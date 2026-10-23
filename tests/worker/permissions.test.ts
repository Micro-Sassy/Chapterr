import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addToClub, as, createClub, createMember, installFetchMock, json, seedEdition, type Member, type TestClub } from "./helpers";

let alice: Member;
let bob: Member;
let club: TestClub;
let editionId: string;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());

beforeAll(async () => {
  installFetchMock();
  alice = await createMember("alice");
  bob = await createMember("bob");
  club = await createClub(alice, "Permissions Club");
  await addToClub(alice, club, bob);
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

    // Bob (same club) sees the club-visible entry but never Alice's personal notes.
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
    // Alice got an in-app notification about the reaction (account-level: no club).
    const notes = await json<{ items: any[] }>(await as(alice)("/api/notifications"));
    const note = notes.items.find((n) => n.kind === "review_reaction");
    expect(note).toBeTruthy();
    expect(note.clubId).toBeNull();
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

  it("club-visible reviews are only visible to members who share a club with the author", async () => {
    const stranger = await createMember("stranger");
    const ed = await seedEdition("Cross Club Book");
    const review = await json(await as(alice)("/api/reviews", { body: { editionId: ed, body: "For my clubs", sentiment: "liked", visibility: "club" } }));
    const quote = await json(await as(alice)("/api/quotes", { body: { editionId: ed, text: "Shared line", visibility: "club" } }));
    // Bob shares a club with Alice.
    expect((await json<any[]>(await as(bob)(`/api/reviews?editionId=${ed}`))).some((r) => r.id === review.id)).toBe(true);
    expect((await json<any[]>(await as(bob)(`/api/quotes?editionId=${ed}`))).some((q) => q.id === quote.id)).toBe(true);
    // The stranger does not: nothing is visible, reactions are refused, the profile is hidden.
    expect((await json<any[]>(await as(stranger)(`/api/reviews?editionId=${ed}`))).some((r) => r.id === review.id)).toBe(false);
    expect((await json<any[]>(await as(stranger)(`/api/quotes?editionId=${ed}`))).some((q) => q.id === quote.id)).toBe(false);
    expect((await as(stranger)(`/api/reviews/${review.id}/reactions`, { body: { reaction: "like" } })).status).toBe(404);
    expect((await as(stranger)(`/api/members/${alice.username}`)).status).toBe(404);
    expect((await as(stranger)(`/api/members/${alice.username}/books`)).status).toBe(404);
    // Once the stranger joins one of Alice's clubs, everything club-visible appears.
    const other = await createClub(alice, "Bridge Club");
    await addToClub(alice, other, stranger);
    expect((await json<any[]>(await as(stranger)(`/api/reviews?editionId=${ed}`))).some((r) => r.id === review.id)).toBe(true);
    const profile = await json(await as(stranger)(`/api/members/${alice.username}`));
    expect(profile.sharedClubs.map((s: any) => s.id)).toEqual([other.id]);
    expect(profile.sharedClubs[0].role).toBe("owner");
    // The club feed shows the review to members of that club.
    const feed = await json(await as(stranger)(`/api/clubs/${other.id}/reviews`));
    expect(feed.items.some((r: any) => r.id === review.id)).toBe(true);
    const quotes = await json(await as(stranger)(`/api/clubs/${other.id}/quotes`));
    expect(quotes.items.some((q: any) => q.id === quote.id)).toBe(true);
  });
});

describe("profiles", () => {
  it("members edit only their own profile; no global member list", async () => {
    const res = await as(alice)("/api/account/profile", { method: "PUT", body: { displayName: "Alice A.", bio: "Reads a lot" } });
    expect(res.status).toBe(200);
    const bobSees = await json(await as(bob)(`/api/members/${alice.username}`));
    expect(bobSees.displayName).toBe("Alice A.");
    expect(bobSees.profile.bio).toBe("Reads a lot");
    expect(bobSees.sharedClubs.map((s: any) => s.id)).toContain(club.id);
    expect(bobSees).not.toHaveProperty("email");
    expect((await as(bob)("/api/members")).status).toBe(404);
  });
});

describe("recommendations", () => {
  it("are made inside a club; direct ones are visible only to sender and recipient", async () => {
    const carol = await createMember("carol");
    await addToClub(alice, club, carol);
    const base = `/api/clubs/${club.id}/recommendations`;
    const rec = await json(await as(alice)(base, { body: { editionId, recipientUserId: bob.id, note: "for you" } }));
    expect(rec.clubId).toBe(club.id);
    expect((await json<any[]>(await as(bob)(`${base}?scope=received`))).some((r) => r.id === rec.id)).toBe(true);
    expect((await json<any[]>(await as(carol)(base))).some((r) => r.id === rec.id)).toBe(false);
    expect((await as(bob)(`${base}/${rec.id}`, { method: "DELETE" })).status).toBe(403);
    // The recipient must belong to the club.
    const outsider = await createMember("rec_out");
    expect((await as(alice)(base, { body: { editionId, recipientUserId: outsider.id } })).status).toBe(404);
    // Club-wide recommendations notify the club and show in the club feed, not in other clubs.
    const wide = await json(await as(alice)(base, { body: { editionId, note: "everyone" } }));
    expect((await json<any[]>(await as(carol)(`${base}?scope=club`))).some((r) => r.id === wide.id)).toBe(true);
    const other = await createClub(bob, "Bob's Club");
    expect((await json<any[]>(await as(bob)(`/api/clubs/${other.id}/recommendations`))).some((r) => r.id === wide.id)).toBe(false);
    const notes = await json<{ items: any[] }>(await as(carol)("/api/notifications"));
    expect(notes.items.some((n) => n.kind === "recommendation" && n.clubId === club.id)).toBe(true);
  });
});
