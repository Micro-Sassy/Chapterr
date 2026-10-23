import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addToClub, as, createClub, createMember, installFetchMock, json, seedEdition, type Member, type TestClub } from "./helpers";

let alice: Member;
let bob: Member;
let club: TestClub;
let base: string;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  installFetchMock();
  alice = await createMember("club_a");
  bob = await createMember("club_b");
  club = await createClub(alice, "Shared Data Club");
  await addToClub(alice, club, bob);
  base = `/api/clubs/${club.id}`;
  vi.restoreAllMocks();
});

describe("shared club data", () => {
  it("any member can edit another member's shared records, with audit fields", async () => {
    const ed = await seedEdition("Club Pick");
    const meeting = await json(
      await as(alice)(`${base}/meetings`, { body: { title: "March meeting", startsAt: "2030-03-10T18:00:00Z", location: "Library" } }),
    );
    expect(meeting.createdBy.id).toBe(alice.id);
    const updated = await json(
      await as(bob)(`${base}/meetings/${meeting.id}`, {
        method: "PUT",
        body: { title: "March meeting (moved)", startsAt: "2030-03-11T18:00:00Z", location: "Cafe", editionId: ed, expectedVersion: meeting.version },
      }),
    );
    expect(updated.title).toBe("March meeting (moved)");
    expect(updated.updatedBy.id).toBe(bob.id);
    expect(updated.createdBy.id).toBe(alice.id);
    expect(updated.version).toBe(meeting.version + 1);
    // Everyone else was notified in-app, and the notification names the club.
    const notes = await json<{ items: any[] }>(await as(bob)("/api/notifications"));
    const note = notes.items.find((n) => n.kind === "club_meeting");
    expect(note).toBeTruthy();
    expect(note.clubId).toBe(club.id);
    expect(note.clubName).toBe(club.name);
    expect(note.link).toBe(`/c/${club.id}/meetings`);
  });

  it("detects concurrent edits with 409 and returns the latest copy", async () => {
    const ed = await seedEdition("Concurrency Book");
    const a = await json(await as(alice)(`${base}/assignments`, { body: { editionId: ed, dueDate: "2030-01-31", readingScope: "Ch. 1-5" } }));
    const first = await as(alice)(`${base}/assignments/${a.id}`, {
      method: "PUT",
      body: { editionId: ed, dueDate: "2030-02-01", readingScope: "Ch. 1-6", expectedVersion: a.version },
    });
    expect(first.status).toBe(200);
    const stale = await as(bob)(`${base}/assignments/${a.id}`, {
      method: "PUT",
      body: { editionId: ed, dueDate: "2030-02-02", readingScope: "Ch. 1-7", expectedVersion: a.version },
    });
    expect(stale.status).toBe(409);
    const body = await json(stale);
    expect(body.error.current.readingScope).toBe("Ch. 1-6");
  });

  it("annual list: add, reorder, conflict on changed set, archive and restore", async () => {
    const year = 2031;
    const e1 = await seedEdition("List One");
    const e2 = await seedEdition("List Two");
    const b1 = await json(await as(alice)(`${base}/books`, { body: { year, editionId: e1 } }));
    const b2 = await json(await as(bob)(`${base}/books`, { body: { year, editionId: e2 } }));
    expect((await as(bob)(`${base}/books`, { body: { year, editionId: e2 } })).status).toBe(409);

    const reordered = await json<any[]>(await as(bob)(`${base}/books/reorder`, { body: { year, orderedIds: [b2.id, b1.id] } }));
    expect(reordered.map((b) => b.id)).toEqual([b2.id, b1.id]);
    const stale = await as(alice)(`${base}/books/reorder`, { body: { year, orderedIds: [b1.id] } });
    expect(stale.status).toBe(409);

    const latest = (await json<any[]>(await as(alice)(`${base}/books?year=${year}`))).find((b) => b.id === b1.id);
    const archived = await json(await as(alice)(`${base}/books/${b1.id}/archive`, { body: { expectedVersion: latest.version } }));
    expect(archived.archivedAt).toBeTruthy();
    expect((await json<any[]>(await as(bob)(`${base}/books?year=${year}`))).map((b) => b.id)).toEqual([b2.id]);
    const restored = await json(await as(bob)(`${base}/books/${b1.id}/restore`, { body: { expectedVersion: archived.version } }));
    expect(restored.archivedAt).toBeNull();

    // Completing a book counts toward the club goal.
    await as(alice)(`${base}/goal`, { method: "PUT", body: { year, target: 10 } });
    const current = (await json<any[]>(await as(bob)(`${base}/books?year=${year}`))).find((b) => b.id === b2.id);
    await as(bob)(`${base}/books/${b2.id}`, { method: "PUT", body: { status: "completed", expectedVersion: current.version } });
    const goal = await json(await as(bob)(`${base}/goal?year=${year}`));
    expect(goal.goal.target).toBe(10);
    expect(goal.completed).toBe(1);
    // Setting an existing goal without the version is a conflict.
    expect((await as(bob)(`${base}/goal`, { method: "PUT", body: { year, target: 11 } })).status).toBe(409);
    expect((await as(bob)(`${base}/goal`, { method: "PUT", body: { year, target: 11, expectedVersion: goal.goal.version } })).status).toBe(200);
    expect(await json(await as(alice)(`${base}/books/years`))).toContain(year);
  });

  it("genres are per club and case-insensitively unique", async () => {
    const g = await json(await as(alice)(`${base}/genres`, { body: { name: "Historical Fiction" } }));
    expect((await as(bob)(`${base}/genres`, { body: { name: "historical fiction" } })).status).toBe(409);
    const renamed = await json(await as(bob)(`${base}/genres/${g.id}`, { method: "PUT", body: { name: "Historical", expectedVersion: g.version } }));
    expect(renamed.name).toBe("Historical");
    const ed = await seedEdition("Tagged Book");
    const detail = await json(await as(alice)(`/api/books/editions/${ed}`));
    const tagged = await json<any[]>(await as(bob)(`${base}/works/${detail.edition.bookId}/genres`, { method: "PUT", body: { genreIds: [g.id] } }));
    expect(tagged.map((t) => t.id)).toEqual([g.id]);
    // The book page shows the tag with its club.
    const again = await json(await as(alice)(`/api/books/editions/${ed}`));
    expect(again.edition.genres.map((t: any) => t.id)).toEqual([g.id]);
    expect(again.edition.genres[0].clubName).toBe(club.name);

    // Another club can use the same genre name; its tags do not leak into this club.
    const other = await createClub(alice, "Other Genre Club");
    const g2 = await json(await as(alice)(`/api/clubs/${other.id}/genres`, { body: { name: "Historical" } }));
    expect(g2.id).not.toBe(g.id);
    expect((await json<any[]>(await as(alice)(`/api/clubs/${other.id}/genres`))).map((x) => x.id)).toEqual([g2.id]);
    // A genre from another club cannot be attached here.
    expect((await as(alice)(`${base}/works/${detail.edition.bookId}/genres`, { method: "PUT", body: { genreIds: [g2.id] } })).status).toBe(400);
  });

  it("activities can be created, edited by others and archived", async () => {
    const act = await json(await as(alice)(`${base}/activities`, { body: { title: "Summer reading bingo", kind: "challenge" } }));
    const edited = await json(
      await as(bob)(`${base}/activities/${act.id}`, { method: "PUT", body: { title: "Summer bingo", kind: "challenge", expectedVersion: act.version } }),
    );
    const archived = await json(await as(alice)(`${base}/activities/${act.id}/archive`, { body: { expectedVersion: edited.version } }));
    expect(archived.archivedAt).toBeTruthy();
  });

  it("dashboard and activity feed are scoped to the club", async () => {
    const dash = await json(await as(bob)(`${base}/dashboard`));
    expect(dash.club.id).toBe(club.id);
    expect(dash.memberCount).toBe(2);
    expect(dash.activity.some((a: any) => a.kind === "meeting")).toBe(true);
    const feed = await json(await as(bob)(`${base}/activity?limit=2`));
    expect(feed.items).toHaveLength(2);
    expect(feed.nextCursor).toBeTruthy();
    const next = await json(await as(bob)(`${base}/activity?limit=2&cursor=${encodeURIComponent(feed.nextCursor)}`));
    expect(next.items.every((i: any) => i.createdAt < feed.nextCursor)).toBe(true);
  });
});

describe("quick add to library", () => {
  it("shelves a book as To Be Read once and never resets an existing entry", async () => {
    const m = await createMember("quick");
    const req = as(m);
    const editionId = await seedEdition("Quick Add Book");
    const first = await req(`/api/library/editions/${editionId}/quick-add`, { method: "POST" });
    expect(first.status).toBe(201);
    const body = await json<{ added: boolean; book: { status: string; visibility: string } }>(first);
    expect(body.added).toBe(true);
    expect(body.book.status).toBe("tbr");

    // Mark it finished, then quick-add again: nothing changes.
    await req(`/api/library/editions/${editionId}`, { method: "PUT", body: { editionId, status: "finished" } });
    const again = await req(`/api/library/editions/${editionId}/quick-add`, { method: "POST" });
    expect(again.status).toBe(200);
    const b2 = await json<{ added: boolean; book: { status: string } }>(again);
    expect(b2.added).toBe(false);
    expect(b2.book.status).toBe("finished");

    expect((await req(`/api/library/editions/missing-edition-id/quick-add`, { method: "POST" })).status).toBe(404);
  });
});
