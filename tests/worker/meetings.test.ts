import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runMeetingReminders } from "../../worker/lib/reminders";
import { expandOccurrences, recurrenceToRRule } from "../../worker/lib/recurrence";
import { computeRanges } from "../../worker/lib/mapping";
import { calendarTokenMac, toBase64Url } from "../../worker/routes/meetings";
import { addToClub, as, call, createClub, createMember, installFetchMock, json, latestEmail, seedEdition, testEnv, type Member, type TestClub } from "./helpers";

let alice: Member; // owner
let bob: Member; // member
let carol: Member; // member
let dave: Member; // member of another club only
let club: TestClub;
let other: TestClub;
let base: string;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  installFetchMock();
  alice = await createMember("mtg_a");
  bob = await createMember("mtg_b");
  carol = await createMember("mtg_c");
  dave = await createMember("mtg_d");
  club = await createClub(alice, "Meetings Club");
  await addToClub(alice, club, bob);
  await addToClub(alice, club, carol);
  other = await createClub(dave, "Other Club");
  base = `/api/clubs/${club.id}`;
  vi.restoreAllMocks();
});

const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3600_000;

async function createMeeting(by: Member, body: Record<string, unknown>) {
  const res = await as(by)(`${base}/meetings`, { body: { title: "Book night", ...body } });
  if (res.status !== 201) throw new Error(`create meeting failed ${res.status}: ${await res.text()}`);
  return json<any>(res);
}

describe("recurrence expansion", () => {
  it("keeps the local wall clock across a DST change (America/Chicago)", () => {
    // 7 PM CDT on Oct 27 2026 is 00:00Z Oct 28; DST ends Nov 1, so Nov 3 7 PM CST is 01:00Z Nov 4.
    const out = expandOccurrences("2026-10-28T00:00:00.000Z", { freq: "weekly" }, "America/Chicago", 3);
    expect(out).toEqual(["2026-10-28T00:00:00.000Z", "2026-11-04T01:00:00.000Z", "2026-11-11T01:00:00.000Z"]);
  });

  it("supports biweekly, monthly by weekday, until and count", () => {
    expect(expandOccurrences("2031-01-06T18:00:00.000Z", { freq: "biweekly", count: 3 }, "UTC")).toEqual([
      "2031-01-06T18:00:00.000Z",
      "2031-01-20T18:00:00.000Z",
      "2031-02-03T18:00:00.000Z",
    ]);
    // First Tuesday of each month (Jan 7 2031 is a Tuesday).
    expect(expandOccurrences("2031-01-07T18:00:00.000Z", { freq: "monthly", nthWeekday: { n: 1, day: 2 } }, "UTC", 3)).toEqual([
      "2031-01-07T18:00:00.000Z",
      "2031-02-04T18:00:00.000Z",
      "2031-03-04T18:00:00.000Z",
    ]);
    expect(expandOccurrences("2031-01-01T12:00:00.000Z", { freq: "weekly", until: "2031-01-20" }, "UTC")).toHaveLength(3);
    expect(expandOccurrences("2031-01-01T12:00:00.000Z", { freq: "weekly" }, "UTC")).toHaveLength(52);
    expect(recurrenceToRRule({ freq: "biweekly", byDay: [2, 4] }, { count: 6 })).toBe("FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2;COUNT=6");
  });
});

describe("meetings: create, series scope, archive", () => {
  it("creates every occurrence of a recurring meeting and edits by scope", async () => {
    const start = Date.UTC(2032, 0, 6, 1, 0); // Jan 5 2032, 7 PM Chicago
    const first = await createMeeting(alice, { title: "Weekly", startsAt: iso(start), endsAt: iso(start + 2 * HOUR), recurrence: { freq: "weekly", count: 4 }, timezone: "America/Chicago" });
    expect(first.seriesId).toBeTruthy();
    expect(first.occurrence).toEqual({ index: 1, total: 4 });
    expect(first.timezone).toBe("America/Chicago");
    const list = await json<any[]>(await as(bob)(`${base}/meetings?from=2032-01-01T00:00:00Z&to=2032-03-01T00:00:00Z`));
    const series = list.filter((m) => m.seriesId === first.seriesId);
    expect(series).toHaveLength(4);
    expect(series.map((m) => m.startsAt)).toEqual([0, 1, 2, 3].map((w) => iso(start + w * 7 * 24 * HOUR)));

    // scope=this: rename only the second occurrence.
    const second = series[1]!;
    const renamed = await json<any>(
      await as(bob)(`${base}/meetings/${second.id}?scope=this`, {
        method: "PUT",
        body: { title: "Weekly (special)", startsAt: second.startsAt, endsAt: second.endsAt, expectedVersion: second.version },
      }),
    );
    expect(renamed.title).toBe("Weekly (special)");
    expect((await json<any>(await as(bob)(`${base}/meetings/${series[2]!.id}`))).title).toBe("Weekly");

    // scope=future: move the third occurrence (and the fourth) one hour later; the first two stay.
    const third = series[2]!;
    const moved = await json<any>(
      await as(alice)(`${base}/meetings/${third.id}?scope=future`, {
        method: "PUT",
        body: { title: "Weekly later", startsAt: iso(Date.parse(third.startsAt) + HOUR), endsAt: iso(Date.parse(third.startsAt) + 3 * HOUR), location: "Cafe", expectedVersion: third.version },
      }),
    );
    expect(moved.startsAt).toBe(iso(start + 2 * 7 * 24 * HOUR + HOUR));
    const after = await json<any[]>(await as(bob)(`${base}/meetings?from=2032-01-01T00:00:00Z&to=2032-03-01T00:00:00Z`));
    const byId = new Map(after.map((m) => [m.id, m]));
    expect(byId.get(series[0]!.id).startsAt).toBe(iso(start));
    expect(byId.get(series[0]!.id).title).toBe("Weekly");
    expect(byId.get(series[3]!.id).startsAt).toBe(iso(start + 3 * 7 * 24 * HOUR + HOUR));
    expect(byId.get(series[3]!.id).title).toBe("Weekly later");
    expect(byId.get(series[3]!.id).location).toBe("Cafe");

    // stale version → 409 with the current copy
    const stale = await as(bob)(`${base}/meetings/${third.id}`, { method: "PUT", body: { title: "x", startsAt: third.startsAt, expectedVersion: third.version } });
    expect(stale.status).toBe(409);

    // scope=all archive hides the whole series; restore brings it back.
    const latestFirst = byId.get(series[0]!.id);
    const archived = await json<any>(await as(alice)(`${base}/meetings/${latestFirst.id}/archive?scope=all`, { body: { expectedVersion: latestFirst.version } }));
    expect(archived.archivedAt).toBeTruthy();
    const gone = await json<any[]>(await as(bob)(`${base}/meetings?from=2032-01-01T00:00:00Z&to=2032-03-01T00:00:00Z`));
    expect(gone.filter((m) => m.seriesId === first.seriesId)).toHaveLength(0);
    const restored = await json<any>(await as(alice)(`${base}/meetings/${latestFirst.id}/restore?scope=all`, { body: { expectedVersion: archived.version } }));
    expect(restored.archivedAt).toBeNull();
    expect(restored.occurrence.total).toBe(4);
  });

  it("copies a meeting with its book, location and sign-up lists (but not claims)", async () => {
    const ed = await seedEdition("Copy Me");
    const src = await createMeeting(alice, { title: "Potluck night", startsAt: "2032-05-01T00:00:00Z", endsAt: "2032-05-01T02:00:00Z", location: "Alice's", editionId: ed });
    const list = await json<any>(await as(alice)(`${base}/meetings/${src.id}/signups`, { body: { title: "Food", kind: "potluck" } }));
    const withItem = await json<any>(await as(alice)(`${base}/signups/${list.id}/items`, { body: { label: "Dessert", quantity: 2 } }));
    await as(bob)(`${base}/signups/items/${withItem.items[0].id}/claim`, { method: "PUT", body: { note: "Pie" } });
    const copy = await json<any>(await as(bob)(`${base}/meetings/${src.id}/copy`, { body: { startsAt: "2032-06-01T00:00:00Z", keep: { book: true, location: true, details: true, signups: true } } }));
    expect(copy.copiedFromId).toBe(src.id);
    expect(copy.endsAt).toBe("2032-06-01T02:00:00.000Z");
    expect(copy.edition.id).toBe(ed);
    expect(copy.location).toBe("Alice's");
    expect(copy.signupLists).toHaveLength(1);
    expect(copy.signupLists[0].items[0].label).toBe("Dessert");
    expect(copy.signupLists[0].items[0].claims).toEqual([]);
    const bare = await json<any>(await as(bob)(`${base}/meetings/${src.id}/copy`, { body: { startsAt: "2032-07-01T00:00:00Z", keep: { book: false, location: false, details: true, signups: false } } }));
    expect(bare.edition).toBeNull();
    expect(bare.location).toBeNull();
    expect(bare.signupLists).toEqual([]);
  });
});

describe("RSVP, attendance, roles", () => {
  it("members RSVP for themselves until the deadline, and the host is told", async () => {
    const m = await createMeeting(alice, { title: "RSVP night", startsAt: "2032-02-01T01:00:00Z" });
    // Alice (owner) makes Bob the host.
    const withRoles = await json<any>(await as(alice)(`${base}/meetings/${m.id}/roles`, { method: "PUT", body: { host: bob.id } }));
    expect(withRoles.roles.host.id).toBe(bob.id);
    expect((await as(carol)(`${base}/meetings/${m.id}/roles`, { method: "PUT", body: { host: carol.id } })).status).toBe(403);

    const mine = await json<any>(await as(carol)(`${base}/meetings/${m.id}/rsvp`, { method: "PUT", body: { status: "going", guests: 2, note: "Bringing a friend" } }));
    expect(mine.rsvp).toMatchObject({ going: 1, maybe: 0, no: 0, goingGuests: 2, mine: "going", myGuests: 2, deadlinePassed: false });
    await as(alice)(`${base}/meetings/${m.id}/rsvp`, { method: "PUT", body: { status: "no" } });
    const detail = await json<any>(await as(bob)(`${base}/meetings/${m.id}`));
    expect(detail.rsvp.no).toBe(1);
    expect(detail.rsvps.map((r: any) => [r.id, r.status])).toEqual(expect.arrayContaining([[carol.id, "going"], [alice.id, "no"]]));
    expect(detail.rsvp.mine).toBeNull();
    const notes = await json<{ items: any[] }>(await as(bob)("/api/notifications"));
    const rsvpNotes = notes.items.filter((n) => n.kind === "rsvp_update" && n.link === `/c/${club.id}/meetings/${m.id}`);
    expect(rsvpNotes.map((n) => n.actor.id).sort()).toEqual([alice.id, carol.id].sort());
    expect(rsvpNotes.find((n) => n.actor.id === carol.id).body).toContain("+2 guests");
    // Nobody else hears about RSVPs.
    expect((await json<{ items: any[] }>(await as(carol)("/api/notifications"))).items.some((n) => n.kind === "rsvp_update")).toBe(false);

    // Deadline passed → 409 rsvp_closed
    const closed = await createMeeting(alice, { title: "Closed", startsAt: "2032-02-02T01:00:00Z", rsvpDeadline: "2020-01-01T00:00:00Z" });
    const res = await as(carol)(`${base}/meetings/${closed.id}/rsvp`, { method: "PUT", body: { status: "going" } });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("rsvp_closed");
    expect(closed.rsvp.deadlinePassed).toBe(true);
  });

  it("only admins or the host mark attendance; members self check-in near the start", async () => {
    const soon = await createMeeting(alice, { title: "Tonight", startsAt: iso(Date.now() + HOUR) });
    expect((await as(carol)(`${base}/meetings/${soon.id}/attendance`, { method: "PUT", body: { userIds: [carol.id] } })).status).toBe(403);
    await as(alice)(`${base}/meetings/${soon.id}/roles`, { method: "PUT", body: { host: carol.id } });
    const marked = await json<any>(await as(carol)(`${base}/meetings/${soon.id}/attendance`, { method: "PUT", body: { userIds: [alice.id, carol.id, dave.id] } }));
    // Dave is not a member and is ignored.
    expect(marked.attendees.map((a: any) => a.id).sort()).toEqual([alice.id, carol.id].sort());
    expect(marked.attendance).toEqual({ present: 2, marked: true, mine: true });
    const asBob = await json<any>(await as(bob)(`${base}/meetings/${soon.id}`));
    expect(asBob.attendance.mine).toBe(false);
    const checked = await json<any>(await as(bob)(`${base}/meetings/${soon.id}/attendance/me`, { method: "POST", body: {} }));
    expect(checked.attendance).toEqual({ present: 3, marked: true, mine: true });
    // Admin replaces the list.
    const replaced = await json<any>(await as(alice)(`${base}/meetings/${soon.id}/attendance`, { method: "PUT", body: { userIds: [bob.id] } }));
    expect(replaced.attendance.present).toBe(1);

    const far = await createMeeting(alice, { title: "Far", startsAt: "2032-03-01T01:00:00Z" });
    const tooEarly = await as(bob)(`${base}/meetings/${far.id}/attendance/me`, { method: "POST", body: {} });
    expect(tooEarly.status).toBe(409);
  });

  it("rotates roles fairly: fewest assignments first, then longest ago", async () => {
    // A fresh club so the ledger starts empty.
    const owner = await createMember("rot_o");
    const m1 = await createMember("rot_1");
    const m2 = await createMember("rot_2");
    const c2 = await createClub(owner, "Rotation Club");
    await addToClub(owner, c2, m1);
    await addToClub(owner, c2, m2);
    const b2 = `/api/clubs/${c2.id}`;
    const ledger0 = await json<any>(await as(owner)(`${b2}/roles/ledger`));
    expect(ledger0.members).toHaveLength(3);
    expect(ledger0.suggested.host.id).toBe(owner.id); // longest-standing member, all tied at zero
    expect(ledger0.suggested.picker.id).not.toBe(ledger0.suggested.host.id);

    const hosts: string[] = [];
    for (let i = 0; i < 3; i++) {
      const m = await json<any>(await as(owner)(`${b2}/meetings`, { body: { title: `Meeting ${i}`, startsAt: iso(Date.UTC(2032, 5, 1 + i, 0)), autoAssignRoles: true } }));
      hosts.push(m.roles.host.id);
      expect(m.roles.picker).toBeTruthy();
      expect(m.roles.notetaker).toBeTruthy();
    }
    // Three meetings, three members: everyone hosted exactly once.
    expect(new Set(hosts).size).toBe(3);
    const ledger = await json<any>(await as(owner)(`${b2}/roles/ledger`));
    for (const entry of ledger.members) expect(entry.counts.host).toBe(1);
    // The next host is whoever hosted longest ago: the first one.
    expect(ledger.suggested.host.id).toBe(hosts[0]);

    // Recurring creation rotates across occurrences too.
    const series = await json<any>(
      await as(owner)(`${b2}/meetings`, { body: { title: "Series", startsAt: "2032-08-01T00:00:00Z", recurrence: { freq: "weekly", count: 3 }, autoAssignRoles: true } }),
    );
    const occ = (await json<any[]>(await as(owner)(`${b2}/meetings?from=2032-08-01T00:00:00Z&to=2032-09-01T00:00:00Z`))).filter((m) => m.seriesId === series.seriesId);
    expect(new Set(occ.map((m) => m.roles.host.id)).size).toBe(3);

    // Admins can still set roles by hand (null clears a role).
    const manual = await json<any>(await as(owner)(`${b2}/meetings/${occ[0].id}/roles`, { method: "PUT", body: { host: m1.id, picker: null, notetaker: m2.id } }));
    expect(manual.roles.host.id).toBe(m1.id);
    expect(manual.roles.picker).toBeNull();
  });

  it("notes are versioned; the meeting pack reads guide questions, notes and sign-up gaps", async () => {
    const ed = await seedEdition("Pack Book");
    const earlier = await createMeeting(alice, { title: "Earlier", startsAt: "2032-04-01T00:00:00Z", editionId: ed });
    const noted = await json<any>(await as(bob)(`${base}/meetings/${earlier.id}/notes`, { method: "PUT", body: { notes: "We loved chapter 3.", expectedVersion: earlier.version } }));
    expect(noted.notes).toBe("We loved chapter 3.");
    expect((await as(bob)(`${base}/meetings/${earlier.id}/notes`, { method: "PUT", body: { notes: "stale", expectedVersion: earlier.version } })).status).toBe(409);

    const m = await createMeeting(alice, { title: "Pack night", startsAt: "2032-04-15T00:00:00Z", editionId: ed });
    const now = new Date().toISOString();
    await testEnv.DB.prepare(
      "INSERT INTO discussion_guides (id, club_id, edition_id, source, sections, created_at, updated_at) VALUES (?, ?, ?, 'manual', ?, ?, ?)",
    )
      .bind("guide_pack", club.id, ed, JSON.stringify([{ title: "Themes", questions: [{ id: "q1", text: "What did the ending mean?" }] }]), now, now)
      .run();
    await testEnv.DB.prepare("INSERT INTO quotes (id, user_id, edition_id, text, location, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'club', ?, ?)")
      .bind("quote_pack", bob.id, ed, "A fine sentence.", "p. 12", now, now)
      .run();
    await testEnv.DB.prepare("INSERT INTO quotes (id, user_id, edition_id, text, location, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'private', ?, ?)")
      .bind("quote_private", bob.id, ed, "Secret sentence.", null, now, now)
      .run();
    const list = await json<any>(await as(alice)(`${base}/meetings/${m.id}/signups`, { body: { title: "Snacks" } }));
    await as(alice)(`${base}/signups/${list.id}/items`, { body: { label: "Cheese", quantity: 3 } });
    const pack = await json<any>(await as(carol)(`${base}/meetings/${m.id}/pack`));
    expect(pack.book.id).toBe(ed);
    expect(pack.questions).toEqual(["What did the ending mean?"]);
    expect(pack.agenda[0]).toEqual({ title: "Themes", items: ["What did the ending mean?"] });
    expect(pack.quotes.map((q: any) => q.text)).toEqual(["A fine sentence."]);
    expect(pack.lastNotes).toMatchObject({ meetingTitle: "Earlier", notes: "We loved chapter 3." });
    expect(pack.signupGaps).toEqual([{ list: "Snacks", item: "Cheese", needed: 3 }]);
    // Cached for ten minutes.
    const again = await json<any>(await as(bob)(`${base}/meetings/${m.id}/pack`));
    expect(again.generatedAt).toBe(pack.generatedAt);
  });
});

describe("sign-up lists", () => {
  it("claims toggle and respect the quantity", async () => {
    const m = await createMeeting(alice, { title: "Signups", startsAt: "2032-09-01T00:00:00Z" });
    const list = await json<any>(await as(alice)(`${base}/meetings/${m.id}/signups`, { body: { title: "Supplies", kind: "supplies" } }));
    expect(list.kind).toBe("supplies");
    const withItem = await json<any>(await as(bob)(`${base}/signups/${list.id}/items`, { body: { label: "Napkins", quantity: 1 } }));
    const item = withItem.items[0];
    const claimed = await json<any>(await as(bob)(`${base}/signups/items/${item.id}/claim`, { method: "PUT", body: { note: "Got them" } }));
    expect(claimed.items[0].mine).toBe(true);
    expect(claimed.items[0].claims).toHaveLength(1);
    expect(claimed.items[0].claims[0]).toMatchObject({ id: bob.id, note: "Got them" });
    const full = await as(carol)(`${base}/signups/items/${item.id}/claim`, { method: "PUT", body: {} });
    expect(full.status).toBe(409);
    const released = await json<any>(await as(bob)(`${base}/signups/items/${item.id}/claim`, { method: "PUT", body: {} }));
    expect(released.items[0].mine).toBe(false);
    expect(released.items[0].claims).toEqual([]);
    expect(released.version).toBeGreaterThan(claimed.version);
    const edited = await json<any>(await as(carol)(`${base}/signups/items/${item.id}`, { method: "PUT", body: { label: "Paper napkins", quantity: 4 } }));
    expect(edited.items[0]).toMatchObject({ label: "Paper napkins", quantity: 4 });
    const removed = await json<any>(await as(carol)(`${base}/signups/items/${item.id}`, { method: "DELETE" }));
    expect(removed.items).toEqual([]);
    const detail = await json<any>(await as(alice)(`${base}/meetings/${m.id}`));
    expect(detail.signupLists).toHaveLength(1);
    expect((await as(alice)(`${base}/signups/${list.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await json<any>(await as(alice)(`${base}/meetings/${m.id}`))).signupLists).toEqual([]);
  });
});

describe("reminders cron", () => {
  it("sends each (meeting, offset) reminder once, skipping members who declined", async () => {
    const start = Date.now() + 7 * 24 * HOUR;
    const m = await createMeeting(alice, { title: "Reminder night", startsAt: iso(start), location: "The library" });
    await as(carol)(`${base}/meetings/${m.id}/rsvp`, { method: "PUT", body: { status: "no" } });
    // Default offsets are [1440, 120] minutes. Ten minutes into the 120-minute window:
    const tick = new Date(start - 120 * 60_000 + 10 * 60_000);
    await runMeetingReminders(testEnv, tick);
    await runMeetingReminders(testEnv, new Date(tick.getTime() + 15 * 60_000));
    const sent = await testEnv.DB.prepare("SELECT offset_minutes FROM meeting_reminders_sent WHERE meeting_id = ?").bind(m.id).all<{ offset_minutes: number }>();
    expect(sent.results.map((r) => r.offset_minutes)).toEqual([120]);
    const bobNotes = (await json<{ items: any[] }>(await as(bob)("/api/notifications"))).items.filter((n) => n.kind === "meeting_reminder" && n.link === `/c/${club.id}/meetings/${m.id}`);
    expect(bobNotes).toHaveLength(1);
    expect(bobNotes[0].title).toBe("Reminder: Reminder night");
    expect(bobNotes[0].body).toContain("The library");
    // Alice created the meeting but still gets the reminder.
    const aliceNotes = (await json<{ items: any[] }>(await as(alice)("/api/notifications"))).items.filter((n) => n.kind === "meeting_reminder" && n.link === `/c/${club.id}/meetings/${m.id}`);
    expect(aliceNotes).toHaveLength(1);
    const carolNotes = (await json<{ items: any[] }>(await as(carol)("/api/notifications"))).items.filter((n) => n.kind === "meeting_reminder" && n.link === `/c/${club.id}/meetings/${m.id}`);
    expect(carolNotes).toHaveLength(0);
    const mail = await latestEmail(bob.email);
    expect(mail?.subject).toContain("Reminder: Reminder night");
    expect(mail?.text_body).toContain("The library");
    expect(mail?.text_body).not.toContain("—");

    // The 1440 offset window passed long ago: never sent late.
    await runMeetingReminders(testEnv, new Date(start - 60_000));
    const sent2 = await testEnv.DB.prepare("SELECT offset_minutes FROM meeting_reminders_sent WHERE meeting_id = ?").bind(m.id).all<{ offset_minutes: number }>();
    expect(sent2.results.map((r) => r.offset_minutes)).toEqual([120]);
  });
});

describe("calendar: .ics, feed, month and year views", () => {
  it("exports a single meeting as .ics with TZID, escaping and an RRULE for series", async () => {
    const start = Date.UTC(2032, 11, 2, 1, 0); // Dec 1 2032 7 PM Chicago (CST)
    const m = await createMeeting(alice, { title: "Soup, bread; and books", startsAt: iso(start), endsAt: iso(start + 2 * HOUR), location: "Bob's place", recurrence: { freq: "weekly", count: 3 }, timezone: "America/Chicago" });
    const res = await as(bob)(`${base}/meetings/${m.id}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const text = await res.text();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain(`UID:${m.id}@chapterr.io`);
    expect(text).toContain("DTSTART;TZID=America/Chicago:20321201T190000");
    expect(text).toContain("DTEND;TZID=America/Chicago:20321201T210000");
    expect(text).toContain("SUMMARY:Soup\\, bread\\; and books");
    expect(text).toContain("RRULE:FREQ=WEEKLY;COUNT=3");
    // Long lines are folded at 75 octets; unfold before looking for the URL.
    expect(text.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(text.replace(/\r\n /g, "")).toContain(`URL:http://localhost/c/${club.id}/meetings/${m.id}`);
    expect(text).toContain("END:VEVENT");
  });

  it("serves a signed per-member feed only while they are a member", async () => {
    const m = await createMeeting(alice, { title: "Feed meeting", startsAt: iso(Date.now() + 3 * 24 * HOUR) });
    const { url } = await json<{ url: string }>(await as(bob)(`${base}/calendar/feed-url`));
    expect(url).toMatch(/^http:\/\/localhost\/api\/public\/calendar\/[A-Za-z0-9_-]+\.ics$/);
    const path = new URL(url).pathname;
    const feed = await call(path, { origin: null });
    expect(feed.status).toBe(200);
    const text = await feed.text();
    expect(text).toContain(`UID:${m.id}@chapterr.io`);
    expect(text).toContain("SUMMARY:Feed meeting");

    // Tampered token
    expect((await call(path.replace(/\.ics$/, "x.ics"), { origin: null })).status).toBe(404);
    // A valid signature for someone who is not a member of this club
    const mac = await calendarTokenMac(testEnv.BETTER_AUTH_SECRET, dave.id, club.id);
    const daveToken = toBase64Url(new TextEncoder().encode(`${dave.id}:${club.id}:${mac}`));
    expect((await call(`/api/public/calendar/${daveToken}.ics`, { origin: null })).status).toBe(404);
    // Dave cannot get a feed URL for a club he does not belong to.
    expect((await as(dave)(`${base}/calendar/feed-url`)).status).toBe(403);
  });

  it("month and year views combine meetings, assignment due dates and poll closes", async () => {
    const ed = await seedEdition("Calendar Book");
    const m = await createMeeting(alice, { title: "March meeting", startsAt: "2033-03-10T01:00:00Z" });
    const a = await json<any>(await as(alice)(`${base}/assignments`, { body: { editionId: ed, dueDate: "2033-03-15", readingScope: "Part 1" } }));
    const p = await json<any>(
      await as(alice)(`${base}/polls`, { body: { kind: "custom", title: "Snacks?", options: [{ label: "Yes" }, { label: "No" }], closesAt: "2033-03-20T12:00:00Z" } }),
    );
    const month = await json<any>(await as(bob)(`${base}/calendar?month=2033-03`));
    expect(month.month).toBe("2033-03");
    expect(month.items.map((i: any) => [i.kind, i.id])).toEqual([
      ["meeting", m.id],
      ["assignment", a.id],
      ["poll", p.id],
    ]);
    expect(month.items[1]).toMatchObject({ allDay: true, startsAt: "2033-03-15", title: "Read Calendar Book: Part 1" });
    expect(month.items[0].link).toBe(`/c/${club.id}/meetings/${m.id}`);
    const year = await json<any>(await as(bob)(`${base}/calendar?year=2033`));
    expect(year.months).toHaveLength(12);
    expect(year.months[2].counts).toEqual({ meetings: 1, assignments: 1, polls: 1 });
    expect(year.months[3].counts).toEqual({ meetings: 0, assignments: 0, polls: 0 });
    expect((await as(bob)(`${base}/calendar?month=2033-13`)).status).toBe(422);
  });
});

describe("pace planner and edition mappings", () => {
  it("splits pages evenly by cadence, creates assignments and reports personal pace", async () => {
    const ed = await seedEdition("Paced Book");
    await testEnv.DB.prepare("UPDATE book_editions SET page_count = 300 WHERE id = ?").bind(ed).run();
    const plan = await json<any>(
      await as(alice)(`${base}/pace-plans`, { body: { editionId: ed, startsOn: "2033-01-01", endsOn: "2033-01-29", cadence: "weekly", restDays: [], createAssignments: true } }),
    );
    expect(plan.totalPages).toBe(300);
    expect(plan.schedule.map((r: any) => [r.dueDate, r.fromPage, r.toPage])).toEqual([
      ["2033-01-08", 1, 75],
      ["2033-01-15", 76, 150],
      ["2033-01-22", 151, 225],
      ["2033-01-29", 226, 300],
    ]);
    expect(plan.schedule.every((r: any) => r.assignmentId)).toBe(true);
    expect(plan.personal).toMatchObject({ myPage: 0, pagesLeft: 300, onTrack: true });
    const assignments = await json<any[]>(await as(bob)(`${base}/assignments?when=all`));
    const mine = assignments.filter((a) => a.pacePlanId === plan.id);
    expect(mine).toHaveLength(4);
    expect(mine.find((a) => a.dueDate === "2033-01-15")).toMatchObject({ fromPage: 76, toPage: 150, readingScope: "Pages 76-150" });

    // Duplicate plan → 409 with the current one
    const dup = await as(bob)(`${base}/pace-plans`, { body: { editionId: ed, startsOn: "2033-01-01", endsOn: "2033-02-01" } });
    expect(dup.status).toBe(409);

    // Personal pace uses club reading progress (written by the rooms feature).
    const now = new Date().toISOString();
    await testEnv.DB.prepare("INSERT INTO club_reading_progress (club_id, edition_id, user_id, page, finished, updated_at) VALUES (?, ?, ?, 120, 0, ?)").bind(club.id, ed, bob.id, now).run();
    const forBob = await json<any>(await as(bob)(`${base}/pace-plans/${ed}`));
    expect(forBob.personal.myPage).toBe(120);
    expect(forBob.personal.pagesLeft).toBe(180);
    expect(forBob.personal.pagesPerDay).toBeGreaterThan(0);

    // Updating re-plans: old assignments are archived, new ones created.
    const updated = await json<any>(
      await as(alice)(`${base}/pace-plans/${ed}`, { method: "PUT", body: { startsOn: "2033-01-01", endsOn: "2033-01-15", cadence: "daily", restDays: [0, 6], expectedVersion: forBob.version } }),
    );
    expect(updated.cadence).toBe("daily");
    expect(updated.schedule.every((r: any) => ![0, 6].includes(new Date(`${r.dueDate}T00:00:00Z`).getUTCDay()) || r.dueDate === "2033-01-15")).toBe(true);
    expect(updated.schedule[updated.schedule.length - 1].toPage).toBe(300);
    const live = (await json<any[]>(await as(bob)(`${base}/assignments?when=all`))).filter((a) => a.pacePlanId === plan.id);
    expect(live).toHaveLength(updated.schedule.length);
    expect((await as(alice)(`${base}/pace-plans/${ed}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(alice)(`${base}/pace-plans/${ed}`)).status).toBe(404);
  });

  it("maps page ranges to Kindle locations and audio time", async () => {
    expect(computeRanges(1, 75, { pageCount: 300, kindleTotal: 3000, audioSeconds: 36_000 })).toEqual({
      pages: { from: 1, to: 75 },
      kindle: { from: 1, to: 750 },
      audio: { from: "0:00:00", to: "2:30:00" },
    });
    expect(computeRanges(76, 150, { pageCount: 300, kindleTotal: 3000, audioSeconds: null })).toEqual({ pages: { from: 76, to: 150 }, kindle: { from: 751, to: 1500 }, audio: null });
    expect(computeRanges(null, null, { pageCount: 300, kindleTotal: 3000, audioSeconds: 10 })).toEqual({ pages: null, kindle: null, audio: null });

    const ed = await seedEdition("Mapped Book");
    await testEnv.DB.prepare("UPDATE book_editions SET page_count = 200 WHERE id = ?").bind(ed).run();
    const set = await json<any>(await as(bob)(`/api/books/editions/${ed}/mappings`, { method: "PUT", body: { kind: "audio", total: 7200, label: "Audible" } }));
    expect(set.mappings).toEqual([expect.objectContaining({ kind: "audio", total: 7200, label: "Audible" })]);
    await as(bob)(`/api/books/editions/${ed}/mappings`, { method: "PUT", body: { kind: "kindle", total: 4000 } });
    const got = await json<any>(await as(carol)(`/api/books/editions/${ed}/mappings`));
    expect(got.pageCount).toBe(200);
    expect(got.mappings.map((m: any) => m.kind)).toEqual(["audio", "kindle"]);
    const detail = await json<any>(await as(carol)(`/api/books/editions/${ed}`));
    expect(detail.mappings).toHaveLength(2);
    const a = await json<any>(await as(alice)(`${base}/assignments`, { body: { editionId: ed, dueDate: "2033-05-01" } }));
    expect(a.ranges).toEqual({ pages: null, kindle: null, audio: null });
    await testEnv.DB.prepare("UPDATE club_assignments SET from_page = 101, to_page = 200 WHERE id = ?").bind(a.id).run();
    const withPages = (await json<any[]>(await as(alice)(`${base}/assignments?when=all`))).find((x) => x.id === a.id);
    expect(withPages.ranges).toEqual({ pages: { from: 101, to: 200 }, kindle: { from: 2001, to: 4000 }, audio: { from: "1:00:00", to: "2:00:00" } });
    expect((await as(bob)("/api/books/editions/nope/mappings", { method: "PUT", body: { kind: "audio", total: 10 } })).status).toBe(404);
  });
});

describe("isolation", () => {
  it("members of another club cannot see or touch these meetings", async () => {
    const m = await createMeeting(alice, { title: "Private", startsAt: "2033-06-01T00:00:00Z" });
    expect((await as(dave)(`${base}/meetings`)).status).toBe(403);
    expect((await as(dave)(`${base}/meetings/${m.id}`)).status).toBe(403);
    expect((await as(dave)(`${base}/meetings/${m.id}/rsvp`, { method: "PUT", body: { status: "going" } })).status).toBe(403);
    // Through their own club, the meeting id simply does not exist.
    const ob = `/api/clubs/${other.id}`;
    expect((await as(dave)(`${ob}/meetings/${m.id}`)).status).toBe(404);
    expect((await as(dave)(`${ob}/meetings/${m.id}/rsvp`, { method: "PUT", body: { status: "going" } })).status).toBe(404);
    expect((await as(dave)(`${ob}/meetings/${m.id}/signups`, { body: { title: "x" } })).status).toBe(404);
    expect((await as(dave)(`${ob}/meetings/${m.id}.ics`)).status).toBe(404);
    expect((await as(dave)(`${ob}/meetings/${m.id}/pack`)).status).toBe(404);
    const list = await json<any>(await as(alice)(`${base}/meetings/${m.id}/signups`, { body: { title: "Mine" } }));
    expect((await as(dave)(`${ob}/signups/${list.id}/items`, { body: { label: "x" } })).status).toBe(404);
  });
});
