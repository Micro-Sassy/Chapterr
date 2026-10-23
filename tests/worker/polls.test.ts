import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runMeetingReminders } from "../../worker/lib/reminders";
import { addToClub, as, createClub, createMember, installFetchMock, json, seedEdition, testEnv, type Member, type TestClub } from "./helpers";

let alice: Member; // owner
let bob: Member;
let carol: Member;
let dave: Member; // not a member
let club: TestClub;
let base: string;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  installFetchMock();
  alice = await createMember("poll_a");
  bob = await createMember("poll_b");
  carol = await createMember("poll_c");
  dave = await createMember("poll_d");
  club = await createClub(alice, "Polls Club");
  await addToClub(alice, club, bob);
  await addToClub(alice, club, carol);
  base = `/api/clubs/${club.id}`;
  vi.restoreAllMocks();
});

async function createPoll(by: Member, body: Record<string, unknown>) {
  const res = await as(by)(`${base}/polls`, { body });
  if (res.status !== 201) throw new Error(`create poll failed ${res.status}: ${await res.text()}`);
  return json<any>(res);
}

describe("polls", () => {
  it("creates a custom poll, replaces votes, closes with the earliest option winning ties", async () => {
    const poll = await createPoll(bob, { kind: "custom", title: "Snacks?", options: [{ label: "Sweet" }, { label: "Savoury" }, { label: "Both" }] });
    expect(poll.status).toBe("open");
    expect(poll.options.map((o: any) => o.label)).toEqual(["Sweet", "Savoury", "Both"]);
    expect(poll.createdBy.id).toBe(bob.id);
    // Everyone else was told.
    const notes = await json<{ items: any[] }>(await as(carol)("/api/notifications"));
    expect(notes.items.find((n) => n.kind === "poll_opened" && n.link === `/c/${club.id}/polls/${poll.id}`)).toBeTruthy();

    const [sweet, savoury] = poll.options;
    // Single choice: two options rejected.
    expect((await as(alice)(`${base}/polls/${poll.id}/vote`, { method: "PUT", body: { optionIds: [sweet.id, savoury.id] } })).status).toBe(400);
    let v = await json<any>(await as(alice)(`${base}/polls/${poll.id}/vote`, { method: "PUT", body: { optionIds: [sweet.id] } }));
    expect(v.options[0]).toMatchObject({ votes: 1, mine: true });
    expect(v.options[0].voters[0].id).toBe(alice.id);
    // Replace: Alice changes her mind.
    v = await json<any>(await as(alice)(`${base}/polls/${poll.id}/vote`, { method: "PUT", body: { optionIds: [savoury.id] } }));
    expect(v.options[0].votes).toBe(0);
    expect(v.options[1]).toMatchObject({ votes: 1, mine: true });
    await as(carol)(`${base}/polls/${poll.id}/vote`, { method: "PUT", body: { optionIds: [sweet.id] } });
    const tied = await json<any>(await as(bob)(`${base}/polls/${poll.id}`));
    expect(tied.totalVoters).toBe(2);
    expect(tied.options[0].mine).toBe(false);

    // Carol (plain member, not the creator) cannot close; the creator can.
    expect((await as(carol)(`${base}/polls/${poll.id}/close`, { method: "POST", body: {} })).status).toBe(403);
    const closed = await json<any>(await as(bob)(`${base}/polls/${poll.id}/close`, { method: "POST", body: {} }));
    expect(closed.status).toBe("closed");
    expect(closed.winnerOptionId).toBe(sweet.id); // 1-1 tie, earliest option wins
    expect((await as(alice)(`${base}/polls/${poll.id}/vote`, { method: "PUT", body: { optionIds: [sweet.id] } })).status).toBe(409);
    const closedNote = (await json<{ items: any[] }>(await as(alice)("/api/notifications"))).items.find((n) => n.kind === "poll_closed" && n.link === `/c/${club.id}/polls/${poll.id}`);
    expect(closedNote?.body).toBe("Winner: Sweet");

    const list = await json<{ items: any[]; nextCursor: string | null }>(await as(bob)(`${base}/polls?status=closed`));
    expect(list.items.some((p) => p.id === poll.id)).toBe(true);
    expect((await json<{ items: any[] }>(await as(bob)(`${base}/polls?status=open`))).items.some((p) => p.id === poll.id)).toBe(false);
  });

  it("approval voting and anonymous polls", async () => {
    const poll = await createPoll(alice, { kind: "custom", title: "Which nights work?", options: [{ label: "Mon" }, { label: "Tue" }, { label: "Wed" }], allowMultiple: true, anonymous: true });
    const [mon, tue] = poll.options;
    const v = await json<any>(await as(bob)(`${base}/polls/${poll.id}/vote`, { method: "PUT", body: { optionIds: [mon.id, tue.id] } }));
    expect(v.options[0]).toMatchObject({ votes: 1, mine: true, voters: [] });
    expect(v.options[1]).toMatchObject({ votes: 1, mine: true, voters: [] });
    expect(v.totalVoters).toBe(1);
    // Member options are allowed by default while open.
    const added = await json<any>(await as(carol)(`${base}/polls/${poll.id}/options`, { body: { options: [{ label: "Thu" }] } }));
    expect(added.options).toHaveLength(4);
    expect(added.options[3].position).toBe(3);
    const locked = await createPoll(alice, { kind: "custom", title: "Locked", options: [{ label: "A" }, { label: "B" }], allowMemberOptions: false });
    expect((await as(carol)(`${base}/polls/${locked.id}/options`, { body: { options: [{ label: "C" }] } })).status).toBe(403);
    expect((await as(alice)(`${base}/polls/${locked.id}/options`, { body: { options: [{ label: "C" }] } })).status).toBe(201);
  });

  it("book polls need editions; applying adds the winner to the year's list", async () => {
    const e1 = await seedEdition("Poll Book One");
    const e2 = await seedEdition("Poll Book Two");
    expect((await as(alice)(`${base}/polls`, { body: { kind: "book", title: "Next read", options: [{ label: "One" }, { label: "Two", editionId: e2 }] } })).status).toBe(400);
    const poll = await createPoll(alice, { kind: "book", title: "Next read", year: 2034, options: [{ label: "One", editionId: e1 }, { label: "Two", editionId: e2 }] });
    expect(poll.options[0].edition.id).toBe(e1);
    await as(bob)(`${base}/polls/${poll.id}/vote`, { method: "PUT", body: { optionIds: [poll.options[1].id] } });
    await as(carol)(`${base}/polls/${poll.id}/vote`, { method: "PUT", body: { optionIds: [poll.options[1].id] } });
    // Members cannot apply.
    expect((await as(bob)(`${base}/polls/${poll.id}/apply`, { method: "POST" })).status).toBe(403);
    // Applying an open poll closes it first.
    const applied = await json<any>(await as(alice)(`${base}/polls/${poll.id}/apply`, { method: "POST" }));
    expect(applied.status).toBe("closed");
    expect(applied.winnerOptionId).toBe(poll.options[1].id);
    expect(applied.appliedAt).toBeTruthy();
    const list = await json<any[]>(await as(bob)(`${base}/books?year=2034`));
    expect(list.map((b) => b.edition.id)).toEqual([e2]);
    expect(list[0].status).toBe("planned");
    expect((await as(alice)(`${base}/polls/${poll.id}/apply`, { method: "POST" })).status).toBe(409);

    // No votes → nothing to apply.
    const empty = await createPoll(alice, { kind: "book", title: "Nobody voted", options: [{ label: "One", editionId: e1 }, { label: "Two", editionId: e2 }] });
    const res = await as(alice)(`${base}/polls/${empty.id}/apply`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("no_votes");
  });

  it("date polls need times; applying schedules (or moves) a meeting", async () => {
    expect((await as(alice)(`${base}/polls`, { body: { kind: "date", title: "When?", options: [{ label: "Fri" }, { label: "Sat", startsAt: "2034-02-04T01:00:00Z" }] } })).status).toBe(400);
    const poll = await createPoll(alice, {
      kind: "date",
      title: "February meeting",
      options: [
        { label: "Fri", startsAt: "2034-02-03T01:00:00Z", endsAt: "2034-02-03T03:00:00Z" },
        { label: "Sat", startsAt: "2034-02-04T01:00:00Z" },
      ],
    });
    await as(bob)(`${base}/polls/${poll.id}/vote`, { method: "PUT", body: { optionIds: [poll.options[0].id] } });
    const applied = await json<any>(await as(alice)(`${base}/polls/${poll.id}/apply`, { method: "POST", body: { title: "Feb book night" } }));
    expect(applied.meetingId).toBeTruthy();
    const meeting = await json<any>(await as(bob)(`${base}/meetings/${applied.meetingId}`));
    expect(meeting).toMatchObject({ title: "Feb book night", startsAt: "2034-02-03T01:00:00.000Z", endsAt: "2034-02-03T03:00:00.000Z" });
    expect(meeting.timezone).toBe("America/Chicago");

    // A second date poll tied to that meeting moves it when applied.
    const move = await createPoll(alice, {
      kind: "date",
      title: "Move it?",
      meetingId: applied.meetingId,
      options: [{ label: "Later", startsAt: "2034-02-10T01:00:00Z" }, { label: "Keep", startsAt: "2034-02-03T01:00:00Z" }],
    });
    await as(carol)(`${base}/polls/${move.id}/vote`, { method: "PUT", body: { optionIds: [move.options[0].id] } });
    await as(alice)(`${base}/polls/${move.id}/apply`, { method: "POST" });
    const moved = await json<any>(await as(bob)(`${base}/meetings/${applied.meetingId}`));
    expect(moved.startsAt).toBe("2034-02-10T01:00:00.000Z");
    expect(moved.version).toBe(meeting.version + 1);
  });

  it("cron closes polls past their closing time and notifies everyone", async () => {
    const poll = await createPoll(bob, { kind: "custom", title: "Quick one", options: [{ label: "A" }, { label: "B" }], closesAt: new Date(Date.now() + 60_000).toISOString() });
    await as(alice)(`${base}/polls/${poll.id}/vote`, { method: "PUT", body: { optionIds: [poll.options[1].id] } });
    await runMeetingReminders(testEnv, new Date(Date.now() + 120_000));
    const closed = await json<any>(await as(bob)(`${base}/polls/${poll.id}`));
    expect(closed.status).toBe("closed");
    expect(closed.winnerOptionId).toBe(poll.options[1].id);
    // The creator is notified too (system notice, no actor).
    const note = (await json<{ items: any[] }>(await as(bob)("/api/notifications"))).items.find((n) => n.kind === "poll_closed" && n.link === `/c/${club.id}/polls/${poll.id}`);
    expect(note).toBeTruthy();
    expect(note.body).toBe("Winner: B");
    // Running again changes nothing.
    await runMeetingReminders(testEnv, new Date(Date.now() + 180_000));
    const again = await json<any>(await as(bob)(`${base}/polls/${poll.id}`));
    expect(again.version).toBe(closed.version);
    // A closing time in the past is rejected at creation.
    expect((await as(bob)(`${base}/polls`, { body: { kind: "custom", title: "Past", options: [{ label: "A" }, { label: "B" }], closesAt: "2020-01-01T00:00:00Z" } })).status).toBe(400);
  });

  it("archive and isolation", async () => {
    const poll = await createPoll(carol, { kind: "custom", title: "Mine", options: [{ label: "A" }, { label: "B" }] });
    expect((await as(dave)(`${base}/polls`)).status).toBe(403);
    expect((await as(dave)(`${base}/polls/${poll.id}/vote`, { method: "PUT", body: { optionIds: [poll.options[0].id] } })).status).toBe(403);
    const otherClub = await createClub(dave, "Dave's Club");
    expect((await as(dave)(`/api/clubs/${otherClub.id}/polls/${poll.id}`)).status).toBe(404);
    expect((await as(bob)(`${base}/polls/${poll.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await as(carol)(`${base}/polls/${poll.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(carol)(`${base}/polls/${poll.id}`)).status).toBe(404);
  });
});
