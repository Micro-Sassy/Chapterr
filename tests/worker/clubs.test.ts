import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../../shared/constants";
import { runHousekeeping } from "../../worker/index";
import {
  addToClub,
  as,
  call,
  createClub,
  createInvite,
  createMember,
  installFetchMock,
  joinClub,
  json,
  mainConversation,
  nextIp,
  seedEdition,
  testEnv,
  type Member,
} from "./helpers";

let owner: Member;
let admin: Member;
let member: Member;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  installFetchMock();
  owner = await createMember("own");
  admin = await createMember("adm");
  member = await createMember("mem");
  vi.restoreAllMocks();
});

const turnstile = { "x-turnstile-token": "ok" };

describe("creating a club", () => {
  it("requires Turnstile, creates the owner membership and the main conversation in one go", async () => {
    expect((await as(owner)("/api/clubs", { body: { name: "No Captcha Club" } })).status).toBe(403);
    expect((await as(owner)("/api/clubs", { body: { name: "X" }, headers: turnstile })).status).toBe(422);

    const res = await as(owner)("/api/clubs", { body: { name: "Thursday Readers", description: "We meet on Thursdays." }, headers: turnstile });
    expect(res.status).toBe(201);
    const club = await json(res);
    expect(club).toMatchObject({ name: "Thursday Readers", role: "owner", memberCount: 1, plan: "beta_free", memberLimit: LIMITS.clubMembersMax });
    expect(club.slug).toMatch(/^thursday-readers-[a-z0-9]{4}$/);
    expect(club.owner.id).toBe(owner.id);

    const conv = await testEnv.DB.prepare("SELECT id, kind FROM conversations WHERE club_id = ?").bind(club.id).all<{ id: string; kind: string }>();
    expect(conv.results).toHaveLength(1);
    expect(conv.results[0]!.kind).toBe("club");
    const part = await testEnv.DB.prepare("SELECT user_id FROM conversation_participants WHERE conversation_id = ?").bind(conv.results[0]!.id).all();
    expect(part.results.map((p: any) => p.user_id)).toEqual([owner.id]);

    // It shows up in the member's club list, in Me, and as the last club.
    const list = await json<any[]>(await as(owner)("/api/clubs"));
    expect(list.some((c) => c.id === club.id)).toBe(true);
    const me = await json(await as(owner)("/api/account/me"));
    expect(me.clubs.map((c: any) => c.id)).toContain(club.id);
    expect(me.lastClubId).toBe(club.id);
    expect((await json(await as(owner)(`/api/clubs/${club.id}`))).id).toBe(club.id);
  });

  it("owners can update details with optimistic concurrency; members cannot", async () => {
    const club = await createClub(owner, "Editable Club");
    await addToClub(owner, club, member);
    const current = await json(await as(owner)(`/api/clubs/${club.id}`));
    expect((await as(member)(`/api/clubs/${club.id}`, { method: "PUT", body: { name: "Hijack", expectedVersion: current.version } })).status).toBe(403);
    const updated = await json(await as(owner)(`/api/clubs/${club.id}`, { method: "PUT", body: { name: "Renamed Club", expectedVersion: current.version } }));
    expect(updated.name).toBe("Renamed Club");
    expect(updated.version).toBe(current.version + 1);
    expect((await as(owner)(`/api/clubs/${club.id}`, { method: "PUT", body: { name: "Stale", expectedVersion: current.version } })).status).toBe(409);
  });
});

describe("joining by invite code", () => {
  it("validates the code, adds the member to the club chat and notifies admins", async () => {
    const club = await createClub(owner, "Join Club");
    const invite = await createInvite(owner, club.id, { expiresInDays: 7, maxUses: 2 });
    expect(invite.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
    expect(invite.url).toBe(`http://localhost/join/${invite.code}`);

    // Turnstile is required; codes are accepted case-insensitively.
    expect((await as(member)("/api/clubs/join", { body: { code: invite.code } })).status).toBe(403);
    const joined = await joinClub(member, invite.code.toLowerCase());
    expect(joined.status).toBe(201);
    expect((await json(joined)).role).toBe("member");
    // Joining again is idempotent.
    expect((await joinClub(member, invite.code)).status).toBe(200);

    const conv = await mainConversation(member, club.id);
    const part = await testEnv.DB.prepare("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?").bind(conv, member.id).first();
    expect(part).toBeTruthy();
    const notes = await json<{ items: any[] }>(await as(owner)("/api/notifications"));
    const note = notes.items.find((n) => n.kind === "club_member_joined" && n.clubId === club.id);
    expect(note).toBeTruthy();
    expect(note.actor.id).toBe(member.id);

    // Max uses: the second use exhausts the link.
    const uses = await json<any[]>(await as(owner)(`/api/clubs/${club.id}/invites`));
    expect(uses.find((i) => i.id === invite.id).useCount).toBe(1);
    const second = await createMember("join2");
    expect((await joinClub(second, invite.code)).status).toBe(201);
    const third = await createMember("join3");
    const exhausted = await joinClub(third, invite.code);
    expect(exhausted.status).toBe(410);
    expect((await json(exhausted)).error.code).toBe("invite_expired");

    // Unknown and revoked codes are 404.
    expect((await joinClub(third, "ZZZZZZZZZZ")).status).toBe(404);
    expect((await joinClub(third, "short")).status).toBe(422);
    const revoked = await createInvite(owner, club.id);
    expect((await as(owner)(`/api/clubs/${club.id}/invites/${revoked.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await joinClub(third, revoked.code)).status).toBe(404);

    // Expired codes are 410.
    const old = await createInvite(owner, club.id, { expiresInDays: 1 });
    await testEnv.DB.prepare("UPDATE club_invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(old.id).run();
    expect((await joinClub(third, old.code)).status).toBe(410);
  });

  it("enforces the member limit", async () => {
    const club = await createClub(owner, "Tiny Club");
    await testEnv.DB.prepare("UPDATE clubs SET member_limit = 1 WHERE id = ?").bind(club.id).run();
    const invite = await createInvite(owner, club.id);
    const res = await joinClub(member, invite.code);
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("club_full");
  });

  it("only admins manage invites; at most 20 live links per club", async () => {
    const club = await createClub(owner, "Invite Club");
    await addToClub(owner, club, member);
    expect((await as(member)(`/api/clubs/${club.id}/invites`)).status).toBe(403);
    expect((await as(member)(`/api/clubs/${club.id}/invites`, { body: {} })).status).toBe(403);
    for (let i = 0; i < 19; i++) await createInvite(owner, club.id);
    const res = await as(owner)(`/api/clubs/${club.id}/invites`, { body: {} });
    expect(res.status).toBe(409);
  });
});

describe("invite preview", () => {
  it("works signed out, never lists members, and reports expiry", async () => {
    const club = await createClub(owner, "Preview Club");
    await addToClub(owner, club, member);
    const invite = await createInvite(owner, club.id);
    const res = await call(`/api/invites/${invite.code}`, { origin: null, ip: nextIp() });
    expect(res.status).toBe(200);
    const preview = await json(res);
    expect(preview).toMatchObject({ code: invite.code, club: { id: club.id, name: club.name, memberCount: 2 }, alreadyMember: false, expired: false });
    expect(JSON.stringify(preview)).not.toContain(member.id);
    expect(JSON.stringify(preview)).not.toContain(member.username);
    expect(preview.invitedBy).toBe(`own 1`);
    // Signed in as a member: alreadyMember.
    expect((await json(await as(member)(`/api/invites/${invite.code}`))).alreadyMember).toBe(true);
    // Expired codes preview with expired: true; revoked and unknown codes 404.
    await testEnv.DB.prepare("UPDATE club_invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(invite.id).run();
    expect((await json(await call(`/api/invites/${invite.code}`, { origin: null, ip: nextIp() }))).expired).toBe(true);
    await as(owner)(`/api/clubs/${club.id}/invites/${invite.id}`, { method: "DELETE" });
    expect((await call(`/api/invites/${invite.code}`, { origin: null, ip: nextIp() })).status).toBe(404);
    expect((await call(`/api/invites/NOPENOPE22`, { origin: null, ip: nextIp() })).status).toBe(404);
  });
});

describe("club isolation", () => {
  it("non-members get 403 on another club's data and 404 for unknown clubs", async () => {
    const club = await createClub(owner, "Private Club");
    const outsider = await createMember("outsider");
    const ed = await seedEdition("Isolated Book");
    const meeting = await json(await as(owner)(`/api/clubs/${club.id}/meetings`, { body: { title: "Secret meeting", startsAt: "2031-01-01T18:00:00Z" } }));
    for (const path of ["", "/dashboard", "/members", "/meetings", `/meetings/${meeting.id}`, "/books", "/genres", "/conversations", "/activity", "/reviews", "/recommendations", "/invites", "/billing"]) {
      const res = await as(outsider)(`/api/clubs/${club.id}${path}`);
      expect(res.status, path).toBe(403);
      expect((await json(res)).error.code).toBe("not_a_member");
    }
    expect((await as(outsider)(`/api/clubs/${club.id}/books`, { body: { year: 2031, editionId: ed } })).status).toBe(403);
    expect((await as(outsider)(`/api/clubs/${club.id}/meetings/${meeting.id}`, { method: "PUT", body: { title: "x", startsAt: "2031-01-01T18:00:00Z", expectedVersion: 1 } })).status).toBe(403);
    expect((await as(outsider)("/api/clubs/does-not-exist")).status).toBe(404);
    expect((await as(outsider)("/api/clubs/does-not-exist/members")).status).toBe(404);

    // A member of a different club cannot reach records by id through their own club.
    const other = await createClub(outsider, "Outsider Club");
    expect((await as(outsider)(`/api/clubs/${other.id}/meetings/${meeting.id}`)).status).toBe(404);
    expect(
      (await as(outsider)(`/api/clubs/${other.id}/meetings/${meeting.id}`, { method: "PUT", body: { title: "x", startsAt: "2031-01-01T18:00:00Z", expectedVersion: meeting.version } })).status,
    ).toBe(404);
    expect((await as(outsider)(`/api/clubs/${other.id}/meetings/${meeting.id}/archive`, { body: { expectedVersion: meeting.version } })).status).toBe(404);
    expect((await json<any[]>(await as(outsider)(`/api/clubs/${other.id}/meetings?when=all`))).length).toBe(0);
    // Each club has its own activity and goal.
    expect((await json(await as(outsider)(`/api/clubs/${other.id}/activity`))).items.length).toBe(0);
    expect((await json(await as(outsider)(`/api/clubs/${other.id}/goal?year=2031`))).goal).toBeNull();
  });
});

describe("roles and membership", () => {
  it("applies the role rules: admins manage members but not other admins; the owner is untouchable", async () => {
    const club = await createClub(owner, "Roles Club");
    await addToClub(owner, club, admin);
    await addToClub(owner, club, member);
    const base = `/api/clubs/${club.id}`;
    // Members cannot change roles.
    expect((await as(member)(`${base}/members/${admin.id}/role`, { method: "PUT", body: { role: "admin" } })).status).toBe(403);
    // Owner promotes admin; the target is notified.
    const promoted = await json(await as(owner)(`${base}/members/${admin.id}/role`, { method: "PUT", body: { role: "admin" } }));
    expect(promoted.role).toBe("admin");
    const notes = await json<{ items: any[] }>(await as(admin)("/api/notifications"));
    expect(notes.items.some((n) => n.kind === "club_role_changed" && n.clubId === club.id)).toBe(true);
    // Nobody can make someone owner through the role endpoint, or touch the owner.
    expect((await as(owner)(`${base}/members/${member.id}/role`, { method: "PUT", body: { role: "owner" } })).status).toBe(422);
    expect((await as(admin)(`${base}/members/${owner.id}/role`, { method: "PUT", body: { role: "member" } })).status).toBe(403);
    expect((await as(admin)(`${base}/members/${owner.id}`, { method: "DELETE" })).status).toBe(403);
    // Admin cannot demote or remove another admin; owner can.
    const other = await createMember("adm2");
    await addToClub(owner, club, other);
    await as(owner)(`${base}/members/${other.id}/role`, { method: "PUT", body: { role: "admin" } });
    expect((await as(admin)(`${base}/members/${other.id}/role`, { method: "PUT", body: { role: "member" } })).status).toBe(403);
    expect((await as(admin)(`${base}/members/${other.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await json(await as(owner)(`${base}/members/${other.id}/role`, { method: "PUT", body: { role: "member" } }))).role).toBe("member");
    // Admin can remove a plain member; the member is notified and loses access.
    expect((await as(admin)(`${base}/members/${other.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(other)(base)).status).toBe(403);
    const removedNotes = await json<{ items: any[] }>(await as(other)("/api/notifications"));
    expect(removedNotes.items.some((n) => n.kind === "club_removed" && n.clubName === club.name)).toBe(true);
    const members = await json<any[]>(await as(member)(`${base}/members`));
    expect(members.map((m) => m.role)).toEqual(["owner", "admin", "member"]);
    expect(members.map((m) => m.id)).toEqual([owner.id, admin.id, member.id]);
    expect(JSON.stringify(members)).not.toContain(member.email);
  });

  it("owners cannot leave until they transfer ownership; the password is verified", async () => {
    const club = await createClub(owner, "Transfer Club");
    await addToClub(owner, club, member);
    const base = `/api/clubs/${club.id}`;
    const leave = await as(owner)(`${base}/leave`, { method: "POST", body: {} });
    expect(leave.status).toBe(409);
    expect((await json(leave)).error.code).toBe("owner_must_transfer");
    expect((await as(member)(`${base}/transfer-ownership`, { body: { userId: member.id, currentPassword: member.password } })).status).toBe(403);
    expect((await as(owner)(`${base}/transfer-ownership`, { body: { userId: member.id, currentPassword: "wrong password" } })).status).toBe(400);
    const transferred = await json(await as(owner)(`${base}/transfer-ownership`, { body: { userId: member.id, currentPassword: owner.password } }));
    expect(transferred.role).toBe("admin");
    expect(transferred.owner.id).toBe(member.id);
    expect((await as(owner)(`${base}/leave`, { method: "POST", body: {} })).status).toBe(200);
    expect((await as(owner)(base)).status).toBe(403);
    expect((await json(await as(member)(base))).memberCount).toBe(1);
  });

  it("archives a club on delete: it vanishes for everyone and is purged by the cron after 30 days", async () => {
    const club = await createClub(owner, "Doomed Club");
    await addToClub(owner, club, member);
    const base = `/api/clubs/${club.id}`;
    await as(owner)(`${base}/meetings`, { body: { title: "Last meeting", startsAt: "2031-01-01T18:00:00Z" } });
    expect((await as(member)(`${base}/delete`, { body: { confirmName: club.name, currentPassword: member.password } })).status).toBe(403);
    expect((await as(owner)(`${base}/delete`, { body: { confirmName: "Wrong Name", currentPassword: owner.password } })).status).toBe(400);
    expect((await as(owner)(`${base}/delete`, { body: { confirmName: club.name, currentPassword: "nope nope nope" } })).status).toBe(400);
    expect((await as(owner)(`${base}/delete`, { body: { confirmName: club.name, currentPassword: owner.password } })).status).toBe(200);
    expect((await as(owner)(base)).status).toBe(404);
    expect((await as(member)(base)).status).toBe(404);
    expect((await json<any[]>(await as(member)("/api/clubs"))).some((c) => c.id === club.id)).toBe(false);
    expect((await json(await as(owner)("/api/account/me"))).lastClubId).not.toBe(club.id);

    // Recent archive survives the cron; an old one is purged with its data.
    await runHousekeeping(testEnv);
    expect(await testEnv.DB.prepare("SELECT id FROM clubs WHERE id = ?").bind(club.id).first()).toBeTruthy();
    await testEnv.DB.prepare("UPDATE clubs SET archived_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(club.id).run();
    await runHousekeeping(testEnv);
    expect(await testEnv.DB.prepare("SELECT id FROM clubs WHERE id = ?").bind(club.id).first()).toBeNull();
    expect(await testEnv.DB.prepare("SELECT id FROM club_meetings WHERE club_id = ?").bind(club.id).first()).toBeNull();
    expect(await testEnv.DB.prepare("SELECT id FROM conversations WHERE club_id = ?").bind(club.id).first()).toBeNull();
  });

  it("remembers the last club only for clubs the member belongs to", async () => {
    const club = await createClub(owner, "Last Club");
    expect((await as(member)("/api/account/last-club", { method: "PUT", body: { clubId: club.id } })).status).toBe(404);
    const mine = await createClub(member, "My Last Club");
    expect((await as(member)("/api/account/last-club", { method: "PUT", body: { clubId: mine.id } })).status).toBe(200);
    expect((await json(await as(member)("/api/account/me"))).lastClubId).toBe(mine.id);
  });
});

describe("home", () => {
  it("summarises every club with its next meeting, assignment, current book and unread messages", async () => {
    const reader = await createMember("home");
    const a = await createClub(reader, "Home Club A");
    const b = await createClub(reader, "Home Club B");
    await addToClub(reader, a, member);
    const ed = await seedEdition("Home Book");
    await as(reader)(`/api/clubs/${a.id}/meetings`, { body: { title: "Soon", startsAt: "2040-05-01T18:00:00Z" } });
    await as(reader)(`/api/clubs/${a.id}/meetings`, { body: { title: "Later", startsAt: "2041-05-01T18:00:00Z" } });
    await as(reader)(`/api/clubs/${a.id}/assignments`, { body: { editionId: ed, dueDate: "2040-04-01" } });
    await as(reader)(`/api/clubs/${a.id}/books`, { body: { year: 2040, editionId: ed, status: "current" } });
    const conv = await mainConversation(member, a.id);
    await as(member)(`/api/clubs/${a.id}/conversations/${conv}/messages`, { body: { body: "hi" } });
    await as(reader)(`/api/library/editions/${ed}`, { method: "PUT", body: { editionId: ed, status: "reading" } });

    const home = await json(await as(reader)("/api/home"));
    expect(home.clubs.map((c: any) => c.id).sort()).toEqual([a.id, b.id].sort());
    const cardA = home.clubs.find((c: any) => c.id === a.id);
    expect(cardA.nextMeeting.title).toBe("Soon");
    expect(cardA.currentAssignment.edition.id).toBe(ed);
    expect(cardA.currentBook.id).toBe(ed);
    expect(cardA.unreadMessages).toBe(1);
    expect(cardA.memberCount).toBe(2);
    const cardB = home.clubs.find((c: any) => c.id === b.id);
    expect(cardB).toMatchObject({ nextMeeting: null, currentAssignment: null, currentBook: null, unreadMessages: 0 });
    expect(home.currentlyReading.map((u: any) => u.edition.id)).toEqual([ed]);
    expect(home.personalGoal.year).toBe(new Date().getUTCFullYear());
    expect(typeof home.unreadNotifications).toBe("number");
    expect((await as(reader)("/api/dashboard")).status).toBe(404);
  });
});

describe("notifications", () => {
  it("are paginated with a cursor", async () => {
    const target = await createMember("notif");
    const club = await createClub(owner, "Notify Club");
    await addToClub(owner, club, target);
    for (let i = 0; i < 4; i++) {
      await as(owner)(`/api/clubs/${club.id}/meetings`, { body: { title: `Meeting ${i}`, startsAt: `2035-0${i + 1}-01T18:00:00Z` } });
    }
    const page1 = await json(await as(target)("/api/notifications?limit=3"));
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).toBeTruthy();
    expect(page1.items[0].clubName).toBe(club.name);
    const page2 = await json(await as(target)(`/api/notifications?limit=3&cursor=${encodeURIComponent(page1.nextCursor)}`));
    expect(page2.items.length).toBeGreaterThanOrEqual(1);
    expect(page2.items.every((n: any) => n.createdAt < page1.nextCursor)).toBe(true);
    const ids = new Set([...page1.items, ...page2.items].map((n: any) => n.id));
    expect(ids.size).toBe(page1.items.length + page2.items.length);
    expect((await json(await as(target)("/api/notifications/unread-count"))).count).toBeGreaterThanOrEqual(4);
    expect((await as(target)("/api/notifications?limit=0")).status).toBe(422);
  });
});

describe("limits", () => {
  it("caps the clubs one account may own", async () => {
    // `owner` has created LIMITS.clubsOwnedMax clubs across this file by now.
    const owned = (await json<any[]>(await as(owner)("/api/clubs"))).filter((c) => c.role === "owner").length;
    expect(owned).toBe(LIMITS.clubsOwnedMax);
    const res = await as(owner)("/api/clubs", { body: { name: "One Too Many" }, headers: turnstile });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("limit_reached");
  });
});

describe("billing stub", () => {
  it("reports the free beta plan", async () => {
    const payer = await createMember("bill");
    const club = await createClub(payer, "Billing Club");
    const billing = await json(await as(payer)(`/api/clubs/${club.id}/billing`));
    expect(billing).toMatchObject({ plan: "beta_free", billingStatus: "active", priceCents: 100, billingEnabled: false });
    const config = await json(await call("/api/config"));
    expect(config).toMatchObject({ appName: "Chapterr", billingEnabled: false, clubPriceCents: 100 });
    expect(typeof config.marketingUrl).toBe("string");
  });
});
