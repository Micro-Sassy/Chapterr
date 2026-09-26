import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { as, createMember, installFetchMock, json, seedEdition, type Member } from "./helpers";

let alice: Member;
let bob: Member;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  installFetchMock();
  alice = await createMember("club_a");
  bob = await createMember("club_b");
  vi.restoreAllMocks();
});

describe("shared club data", () => {
  it("any member can edit another member's shared records, with audit fields", async () => {
    const ed = await seedEdition("Club Pick");
    const meeting = await json(
      await as(alice)("/api/club/meetings", { body: { title: "March meeting", startsAt: "2030-03-10T18:00:00Z", location: "Library" } }),
    );
    expect(meeting.createdBy.id).toBe(alice.id);
    const updated = await json(
      await as(bob)(`/api/club/meetings/${meeting.id}`, {
        method: "PUT",
        body: { title: "March meeting (moved)", startsAt: "2030-03-11T18:00:00Z", location: "Cafe", editionId: ed, expectedVersion: meeting.version },
      }),
    );
    expect(updated.title).toBe("March meeting (moved)");
    expect(updated.updatedBy.id).toBe(bob.id);
    expect(updated.createdBy.id).toBe(alice.id);
    expect(updated.version).toBe(meeting.version + 1);
    // Everyone else was notified in-app.
    const notes = await json<any[]>(await as(bob)("/api/notifications"));
    expect(notes.some((n) => n.kind === "club_meeting")).toBe(true);
  });

  it("detects concurrent edits with 409 and returns the latest copy", async () => {
    const ed = await seedEdition("Concurrency Book");
    const a = await json(await as(alice)("/api/club/assignments", { body: { editionId: ed, dueDate: "2030-01-31", readingScope: "Ch. 1-5" } }));
    const first = await as(alice)(`/api/club/assignments/${a.id}`, {
      method: "PUT",
      body: { editionId: ed, dueDate: "2030-02-01", readingScope: "Ch. 1-6", expectedVersion: a.version },
    });
    expect(first.status).toBe(200);
    const stale = await as(bob)(`/api/club/assignments/${a.id}`, {
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
    const b1 = await json(await as(alice)("/api/club/books", { body: { year, editionId: e1 } }));
    const b2 = await json(await as(bob)("/api/club/books", { body: { year, editionId: e2 } }));
    expect((await as(bob)("/api/club/books", { body: { year, editionId: e2 } })).status).toBe(409);

    const reordered = await json<any[]>(await as(bob)("/api/club/books/reorder", { body: { year, orderedIds: [b2.id, b1.id] } }));
    expect(reordered.map((b) => b.id)).toEqual([b2.id, b1.id]);
    const stale = await as(alice)("/api/club/books/reorder", { body: { year, orderedIds: [b1.id] } });
    expect(stale.status).toBe(409);

    const latest = (await json<any[]>(await as(alice)(`/api/club/books?year=${year}`))).find((b) => b.id === b1.id);
    const archived = await json(await as(alice)(`/api/club/books/${b1.id}/archive`, { body: { expectedVersion: latest.version } }));
    expect(archived.archivedAt).toBeTruthy();
    expect((await json<any[]>(await as(bob)(`/api/club/books?year=${year}`))).map((b) => b.id)).toEqual([b2.id]);
    const restored = await json(await as(bob)(`/api/club/books/${b1.id}/restore`, { body: { expectedVersion: archived.version } }));
    expect(restored.archivedAt).toBeNull();

    // Completing a book counts toward the club goal.
    await as(alice)("/api/club/goal", { method: "PUT", body: { year, target: 10 } });
    await as(bob)(`/api/club/books/${b2.id}`, { method: "PUT", body: { status: "completed", expectedVersion: (await json<any[]>(await as(bob)(`/api/club/books?year=${year}`))).find((b) => b.id === b2.id).version } });
    const goal = await json(await as(bob)(`/api/club/goal?year=${year}`));
    expect(goal.goal.target).toBe(10);
    expect(goal.completed).toBe(1);
    // Setting an existing goal without the version is a conflict.
    expect((await as(bob)("/api/club/goal", { method: "PUT", body: { year, target: 11 } })).status).toBe(409);
    expect((await as(bob)("/api/club/goal", { method: "PUT", body: { year, target: 11, expectedVersion: goal.goal.version } })).status).toBe(200);
  });

  it("genres are shared and case-insensitively unique", async () => {
    const g = await json(await as(alice)("/api/genres", { body: { name: "Historical Fiction" } }));
    expect((await as(bob)("/api/genres", { body: { name: "historical fiction" } })).status).toBe(409);
    const renamed = await json(await as(bob)(`/api/genres/${g.id}`, { method: "PUT", body: { name: "Historical", expectedVersion: g.version } }));
    expect(renamed.name).toBe("Historical");
    const ed = await seedEdition("Tagged Book");
    const detail = await json(await as(alice)(`/api/books/editions/${ed}`));
    const tagged = await json<any[]>(await as(bob)(`/api/books/works/${detail.edition.bookId}/genres`, { method: "PUT", body: { genreIds: [g.id] } }));
    expect(tagged.map((t) => t.id)).toEqual([g.id]);
  });

  it("activities can be created, edited by others and archived", async () => {
    const act = await json(await as(alice)("/api/club/activities", { body: { title: "Summer reading bingo", kind: "challenge" } }));
    const edited = await json(
      await as(bob)(`/api/club/activities/${act.id}`, { method: "PUT", body: { title: "Summer bingo", kind: "challenge", expectedVersion: act.version } }),
    );
    const archived = await json(await as(alice)(`/api/club/activities/${act.id}/archive`, { body: { expectedVersion: edited.version } }));
    expect(archived.archivedAt).toBeTruthy();
  });
});
