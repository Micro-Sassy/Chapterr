import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WAVE2_LIMITS } from "../../shared/constants";
import { parseCsv, parseInviteCsv, toCsv } from "../../worker/lib/csv";
import { computeStreak } from "../../worker/lib/streaks";
import worker from "../../worker/index";
import {
  ORIGIN,
  addToClub,
  as,
  call,
  createClub,
  createInvite,
  createMember,
  installFetchMock,
  joinClub,
  json,
  latestEmail,
  mainConversation,
  seedEdition,
  testEnv,
  type Member,
  type TestClub,
} from "./helpers";

let owner: Member;
let admin: Member;
let member: Member;
let outsider: Member;
let club: TestClub;
let base: string;

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  installFetchMock();
  owner = await createMember("g_own");
  admin = await createMember("g_adm");
  member = await createMember("g_mem");
  outsider = await createMember("g_out");
  club = await createClub(owner, "Growth Club");
  await addToClub(owner, club, admin);
  await addToClub(owner, club, member);
  base = `/api/clubs/${club.id}`;
  await as(owner)(`${base}/members/${admin.id}/role`, { method: "PUT", body: { role: "admin" } });
  vi.restoreAllMocks();
});

const turnstile = { "x-turnstile-token": "ok" };

/** Multipart upload as a member (the JSON helper cannot send FormData). */
async function upload(m: Member, path: string, fields: Record<string, string>, file: { name: string; type: string; bytes: Uint8Array } | null, method = "POST") {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
  const headers = new Headers({ origin: ORIGIN, "cf-connecting-ip": m.ip, cookie: m.cookie });
  const req = new Request(`${ORIGIN}${path}`, { method, headers, body: form });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const text = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

describe("club files (D1 storage fallback)", () => {
  it("uploads, lists, streams with hardened headers and enforces delete permissions", async () => {
    const res = await upload(member, `${base}/files`, { kind: "photo", title: "Potluck" }, { name: "pic.png", type: "image/png", bytes: PNG });
    expect(res.status).toBe(201);
    const file = await json(res);
    expect(file).toMatchObject({ kind: "photo", title: "Potluck", contentType: "image/png", size: PNG.byteLength, clubId: club.id });
    expect(file.owner.id).toBe(member.id);
    expect(file.url).toBe(`${base}/files/${file.id}/content`);

    // Stored inline in D1 because FILES (R2) is not bound in tests.
    const row = await testEnv.DB.prepare("SELECT storage, sha256 FROM files WHERE id = ?").bind(file.id).first<any>();
    expect(row.storage).toBe("d1");
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);

    const list = await json(await as(admin)(`${base}/files?kind=photo`));
    expect(list.items.map((f: any) => f.id)).toContain(file.id);
    expect((await json(await as(admin)(`${base}/files?kind=minutes`))).items).toHaveLength(0);

    const content = await as(admin)(file.url);
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(content.headers.get("content-disposition")).toBe('inline; filename="Potluck.png"');
    expect(content.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(content.headers.get("x-content-type-options")).toBe("nosniff");
    expect(content.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(PNG);

    // Outsiders see nothing; another member cannot delete; the uploader and admins can.
    expect((await as(outsider)(file.url)).status).toBe(403);
    const other = await json(await upload(admin, `${base}/files`, { kind: "document" }, { name: "notes.txt", type: "text/plain", bytes: text("hello") }));
    expect(other.title).toBe("notes");
    expect((await as(member)(`${base}/files/${other.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await as(member)(`${base}/files/${file.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(owner)(`${base}/files/${other.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(admin)(file.url)).status).toBe(404);
    const blob = await testEnv.DB.prepare("SELECT 1 FROM file_blobs WHERE file_id = ?").bind(file.id).first();
    expect(blob).toBeNull();
  });

  it("rejects unsupported types, non-image photos, oversized files and missing files", async () => {
    expect((await upload(member, `${base}/files`, { kind: "document" }, { name: "x.html", type: "text/html", bytes: text("<script>") })).status).toBe(415);
    expect((await upload(member, `${base}/files`, { kind: "document" }, { name: "x.svg", type: "image/svg+xml", bytes: text("<svg/>") })).status).toBe(415);
    expect((await upload(member, `${base}/files`, { kind: "photo" }, { name: "x.pdf", type: "application/pdf", bytes: text("%PDF") })).status).toBe(415);
    expect((await upload(member, `${base}/files`, { kind: "photo" }, null)).status).toBe(400);
    expect((await upload(member, `${base}/files`, { kind: "bogus" }, { name: "a.txt", type: "text/plain", bytes: text("a") })).status).toBe(422);
    const big = new Uint8Array(WAVE2_LIMITS.fileBytesMaxD1 + 10);
    // The worker's 2 MB body limit (413) catches it before storage would.
    expect((await upload(member, `${base}/files`, { kind: "document" }, { name: "big.txt", type: "text/plain", bytes: big })).status).toBe(413);
  });

  it("enforces the per-club quota", async () => {
    const usage = await json(await as(member)(`${base}/files/usage`));
    expect(usage).toMatchObject({ storage: "d1", filesMax: WAVE2_LIMITS.filesPerClub, bytesMax: WAVE2_LIMITS.clubStorageBytesMaxD1 });
    // Simulate a full club by inserting metadata rows directly.
    const now = new Date().toISOString();
    const stmts = Array.from({ length: WAVE2_LIMITS.filesPerClub }, (_, i) =>
      testEnv.DB.prepare(
        "INSERT INTO files (id, club_id, owner_id, kind, title, content_type, size, storage, created_at) VALUES (?, ?, ?, 'document', ?, 'text/plain', 1, 'd1', ?)",
      ).bind(`quota_${club.id}_${i}`, club.id, owner.id, `q${i}`, now),
    );
    await testEnv.DB.batch(stmts);
    const res = await upload(member, `${base}/files`, { kind: "document" }, { name: "one.txt", type: "text/plain", bytes: text("x") });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("quota_exceeded");
    await testEnv.DB.prepare("DELETE FROM files WHERE id LIKE ?").bind(`quota_${club.id}_%`).run();
  });
});

// ---------------------------------------------------------------------------
// Branding and settings
// ---------------------------------------------------------------------------

describe("branding", () => {
  it("any member uploads a banner; only admins set it; GET club exposes branding", async () => {
    const banner = await json(await upload(member, `${base}/files`, { kind: "banner" }, { name: "banner.png", type: "image/png", bytes: PNG }));
    const doc = await json(await upload(member, `${base}/files`, { kind: "document" }, { name: "d.txt", type: "text/plain", bytes: text("d") }));
    let current = await json(await as(owner)(base));
    expect(current.branding).toEqual({ bannerUrl: null, accentColor: null });

    expect((await as(member)(`${base}/branding`, { method: "PUT", body: { accentColor: "#123456", bannerFileId: banner.id, expectedVersion: current.version } })).status).toBe(403);
    expect((await as(owner)(`${base}/branding`, { method: "PUT", body: { accentColor: "#123456", bannerFileId: doc.id, expectedVersion: current.version } })).status).toBe(400);
    expect((await as(owner)(`${base}/branding`, { method: "PUT", body: { accentColor: "red", expectedVersion: current.version } })).status).toBe(422);

    const updated = await json(await as(owner)(`${base}/branding`, { method: "PUT", body: { accentColor: "#123456", bannerFileId: banner.id, expectedVersion: current.version } }));
    expect(updated).toMatchObject({ accentColor: "#123456", bannerUrl: `${base}/files/${banner.id}/content`, version: current.version + 1 });
    current = await json(await as(member)(base));
    expect(current.branding).toEqual({ accentColor: "#123456", bannerUrl: `${base}/files/${banner.id}/content` });

    // Stale version conflicts; a member cannot delete the banner while it is in use, an admin can (clears the banner).
    expect((await as(owner)(`${base}/branding`, { method: "PUT", body: { accentColor: null, expectedVersion: current.version - 1 } })).status).toBe(409);
    expect((await as(member)(`${base}/files/${banner.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await as(admin)(`${base}/files/${banner.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await json(await as(member)(base))).branding.bannerUrl).toBeNull();
  });
});

describe("club settings", () => {
  it("admins read and write settings with version conflicts; the webhook is write-only", async () => {
    expect((await as(member)(`${base}/settings`)).status).toBe(403);
    const settings = await json(await as(admin)(`${base}/settings`));
    expect(settings).toMatchObject({ joinPolicy: "link", timezone: "America/Chicago", reminderOffsets: [1440, 120], discordWebhookConfigured: false });
    const body = {
      welcomeMessage: "Welcome to the club. Grab a chair.",
      joinPolicy: "approval",
      screeningQuestions: [{ label: "Favourite book?", required: true }, { label: "How did you hear about us?", required: false }],
      timezone: "Europe/London",
      reminderOffsets: [120, 1440],
      rolesRotation: { host: true, picker: false, notetaker: true },
      discordWebhookUrl: "https://discord.com/api/webhooks/123/abc",
      expectedVersion: settings.version,
    };
    const updated = await json(await as(admin)(`${base}/settings`, { method: "PUT", body }));
    expect(updated).toMatchObject({
      welcomeMessage: body.welcomeMessage,
      joinPolicy: "approval",
      timezone: "Europe/London",
      reminderOffsets: [1440, 120],
      rolesRotation: body.rolesRotation,
      discordWebhookConfigured: true,
      version: settings.version + 1,
    });
    expect(updated.screeningQuestions).toHaveLength(2);
    expect(updated.screeningQuestions[0].id).toBeTruthy();
    expect(JSON.stringify(updated)).not.toContain("discord.com/api/webhooks");
    expect((await as(admin)(`${base}/settings`, { method: "PUT", body })).status).toBe(409);
    expect((await as(admin)(`${base}/settings`, { method: "PUT", body: { ...body, timezone: "Mars/Olympus", expectedVersion: updated.version } })).status).toBe(400);
    expect((await as(admin)(`${base}/settings`, { method: "PUT", body: { ...body, discordWebhookUrl: "https://evil.example/hook", expectedVersion: updated.version } })).status).toBe(422);
    // Omitting the webhook keeps it; null clears it.
    const { discordWebhookUrl: _omit, ...rest } = body;
    const kept = await json(await as(admin)(`${base}/settings`, { method: "PUT", body: { ...rest, expectedVersion: updated.version } }));
    expect(kept.discordWebhookConfigured).toBe(true);
    const cleared = await json(await as(admin)(`${base}/settings`, { method: "PUT", body: { ...rest, discordWebhookUrl: null, expectedVersion: kept.version } }));
    expect(cleared.discordWebhookConfigured).toBe(false);
    // Restore the link policy for later tests; keep the welcome message.
    await as(admin)(`${base}/settings`, { method: "PUT", body: { ...rest, joinPolicy: "link", expectedVersion: cleared.version } });
  });
});

// ---------------------------------------------------------------------------
// Screening (approval join flow)
// ---------------------------------------------------------------------------

describe("join requests", () => {
  let screened: TestClub;
  let sbase: string;
  let code: string;
  let questionId: string;

  beforeAll(async () => {
    installFetchMock();
    screened = await createClub(owner, "Screened Club");
    sbase = `/api/clubs/${screened.id}`;
    const s = await json(await as(owner)(`${sbase}/settings`));
    const updated = await json(
      await as(owner)(`${sbase}/settings`, {
        method: "PUT",
        body: { ...s, joinPolicy: "approval", screeningQuestions: [{ label: "Why join?", required: true }], welcomeMessage: "Hello and welcome", expectedVersion: s.version },
      }),
    );
    questionId = updated.screeningQuestions[0].id;
    code = (await createInvite(owner, screened.id)).code;
    vi.restoreAllMocks();
  });

  it("the invite preview exposes the policy and questions", async () => {
    const preview = await json(await call(`/api/invites/${code}`));
    expect(preview.joinPolicy).toBe("approval");
    expect(preview.screeningQuestions).toEqual([{ id: questionId, label: "Why join?", required: true }]);
  });

  it("request -> approve adds the member, posts the welcome, and notifies; decline notifies", async () => {
    // Required answers are enforced.
    const missing = await as(member)("/api/clubs/join", { body: { code, answers: [] }, headers: turnstile });
    expect(missing.status).toBe(422);
    const res = await as(member)("/api/clubs/join", { body: { code, answers: [{ questionId, answer: "I love books" }], message: "Hi there" }, headers: turnstile });
    expect(res.status).toBe(202);
    const pending = await json(res);
    expect(pending).toMatchObject({ pending: true, clubName: "Screened Club" });
    // Not a member yet; the request is visible to the requester and to admins.
    expect((await as(member)(sbase)).status).toBe(403);
    const mine = await json(await as(member)("/api/clubs/requests"));
    expect(mine).toEqual([expect.objectContaining({ id: pending.requestId, status: "pending", club: { id: screened.id, name: "Screened Club" } })]);
    // Repeating the request is idempotent.
    expect((await json(await as(member)("/api/clubs/join", { body: { code, answers: [{ questionId, answer: "again" }] }, headers: turnstile }))).requestId).toBe(pending.requestId);

    const adminNotice = await testEnv.DB.prepare("SELECT kind FROM notifications WHERE user_id = ? AND kind = 'join_request' ORDER BY created_at DESC").bind(owner.id).first<any>();
    expect(adminNotice).toBeTruthy();
    const mail = await latestEmail(owner.email);
    expect(mail?.subject).toContain("asked to join Screened Club");
    expect(mail?.text_body).toContain("Why join?: I love books");

    expect((await as(member)(`${sbase}/join-requests`)).status).toBe(403);
    const list = await json(await as(owner)(`${sbase}/join-requests?status=pending`));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: pending.requestId, status: "pending", message: "Hi there", answers: [{ questionId, label: "Why join?", answer: "again" }] });
    expect(list[0].member.id).toBe(member.id);

    const approved = await json(await as(owner)(`${sbase}/join-requests/${pending.requestId}/approve`, { method: "POST", body: {} }));
    expect(approved.status).toBe("approved");
    expect(approved.decidedBy.id).toBe(owner.id);
    expect((await as(owner)(`${sbase}/join-requests/${pending.requestId}/approve`, { method: "POST", body: {} })).status).toBe(409);
    const asMember = await json(await as(member)(sbase));
    expect(asMember.role).toBe("member");
    const conv = await mainConversation(member, screened.id);
    const participant = await testEnv.DB.prepare("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?").bind(conv, member.id).first();
    expect(participant).toBeTruthy();
    const approvedNotice = await testEnv.DB.prepare("SELECT title FROM notifications WHERE user_id = ? AND kind = 'join_approved'").bind(member.id).first<any>();
    expect(approvedNotice?.title).toBe("Welcome to Screened Club");
    // W2's welcome message lands in the club chat as a system message for the newcomer.
    const welcome = await testEnv.DB.prepare("SELECT body FROM messages WHERE conversation_id = ? AND kind = 'welcome'").bind(conv).first<any>();
    expect(welcome?.body).toContain("Hello and welcome");

    // Decline path.
    const res2 = await as(outsider)("/api/clubs/join", { body: { code, answers: [{ questionId, answer: "Curious" }] }, headers: turnstile });
    expect(res2.status).toBe(202);
    const req2 = await json(res2);
    const declined = await json(await as(owner)(`${sbase}/join-requests/${req2.requestId}/decline`, { method: "POST", body: { note: "Full for now" } }));
    expect(declined.status).toBe("declined");
    expect((await as(outsider)(sbase)).status).toBe(403);
    const declineNotice = await testEnv.DB.prepare("SELECT title, body FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(outsider.id).first<any>();
    expect(declineNotice?.title).toContain("was not approved");
    expect(declineNotice?.body).toBe("Full for now");
    expect((await json(await as(owner)(`${sbase}/join-requests?status=declined`))).map((r: any) => r.id)).toEqual([req2.requestId]);

    // A declined requester can ask again; and can withdraw a pending request.
    const res3 = await as(outsider)("/api/clubs/join", { body: { code, answers: [{ questionId, answer: "Still curious" }] }, headers: turnstile });
    expect(res3.status).toBe(202);
    expect((await as(outsider)(`/api/clubs/requests/${req2.requestId}`, { method: "DELETE" })).status).toBe(200);
    expect(await json(await as(outsider)("/api/clubs/requests"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bulk invites and export
// ---------------------------------------------------------------------------

describe("csv helpers", () => {
  it("parses quoted cells, CRLF and headers; serialises safely", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n\n1,2\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["1", "2"]]);
    const parsed = parseInviteCsv("Email,Name\nAnn@Example.com,Ann\nnot-an-email,Bob\n,\n\"Cy@example.com\",\"Cy, Jr\"\n");
    expect(parsed.rows).toEqual([
      { row: 2, email: "ann@example.com", name: "Ann" },
      { row: 5, email: "cy@example.com", name: "Cy, Jr" },
    ]);
    expect(parsed.invalid.map((i) => i.row)).toEqual([3, 4]);
    expect(parseInviteCsv("solo@example.com").rows).toEqual([{ row: 1, email: "solo@example.com", name: null }]);
    expect(toCsv(["a", "b"], [["=SUM(1)", 'q"t']])).toBe('a,b\r\n\'=SUM(1),"q""t"\r\n');
  });
});

describe("bulk invites", () => {
  it("creates single-use email invites, dedupes, reports skipped rows and records accepted_by", async () => {
    const fresh = await createMember("g_inv");
    const csv = ["email,name", `${fresh.email},Fresh`, `${fresh.email.toUpperCase()},Dup`, `${member.email},Existing`, "bad-address,Nope", "second@example.com"].join("\n");
    expect((await as(member)(`${base}/invites/bulk`, { body: { csv } })).status).toBe(403);
    const res = await as(admin)(`${base}/invites/bulk`, { body: { csv, expiresInDays: 3 } });
    expect(res.status).toBe(201);
    const result = await json(res);
    expect(result.sent).toBe(2);
    expect(result.skipped).toEqual([
      { row: 3, email: fresh.email.toUpperCase(), reason: "Duplicate in file" },
      { row: 4, email: member.email, reason: "Already a member" },
      { row: 5, email: "bad-address", reason: "Not a valid email address" },
    ]);
    const mail = await latestEmail(fresh.email);
    expect(mail?.subject).toContain("invited you to Growth Club");
    expect(mail?.text_body).toContain("Hi Fresh");
    const codeMatch = /\/join\/([A-Z0-9]{10})/.exec(mail!.text_body);
    expect(codeMatch).toBeTruthy();
    const code = codeMatch![1]!;
    const invite = await testEnv.DB.prepare("SELECT email, max_uses, use_count, accepted_by FROM club_invites WHERE code = ?").bind(code).first<any>();
    expect(invite).toMatchObject({ email: fresh.email, max_uses: 1, use_count: 0, accepted_by: null });

    // Re-sending to a pending address is skipped.
    const again = await json(await as(admin)(`${base}/invites/bulk`, { body: { csv: fresh.email } }));
    expect(again).toEqual({ sent: 0, skipped: [{ row: 1, email: fresh.email, reason: "Already invited" }] });

    // Accepting: single use, records who accepted.
    expect((await joinClub(fresh, code)).status).toBe(201);
    const used = await testEnv.DB.prepare("SELECT use_count, accepted_by FROM club_invites WHERE code = ?").bind(code).first<any>();
    expect(used).toEqual({ use_count: 1, accepted_by: fresh.id });
    const another = await createMember("g_inv2");
    expect((await joinClub(another, code)).status).toBe(410);
    // Too many rows / empty file.
    expect((await as(admin)(`${base}/invites/bulk`, { body: { csv: "" } })).status).toBe(400);
    const many = Array.from({ length: WAVE2_LIMITS.bulkInviteRowsMax + 1 }, (_, i) => `p${i}@example.com`).join("\n");
    expect((await as(admin)(`${base}/invites/bulk`, { body: { csv: many } })).status).toBe(400);
  });
});

describe("member export", () => {
  it("admins download a CSV with the expected columns; members cannot", async () => {
    expect((await as(member)(`${base}/members/export.csv`)).status).toBe(403);
    const res = await as(admin)(`${base}/members/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="growth-club-members-\d{4}-\d{2}-\d{2}\.csv"/);
    const rows = parseCsv(await res.text());
    expect(rows[0]).toEqual(["Name", "Username", "Email", "Role", "Joined", "Meetings attended (12 months)", `Books finished (${new Date().getUTCFullYear()})`]);
    const ownerRow = rows.find((r) => r[1] === owner.username)!;
    expect(ownerRow[2]).toBe(owner.email);
    expect(ownerRow[3]).toBe("owner");
    expect(ownerRow[4]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ownerRow[5]).toBe("0");
    expect(rows.some((r) => r[1] === member.username && r[3] === "member")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Account: phone, preferences
// ---------------------------------------------------------------------------

describe("phone and SMS opt-in", () => {
  it("stores an E.164 number and the opt-in; Me exposes them with the push preferences", async () => {
    expect((await as(member)("/api/account/phone", { method: "PUT", body: { phone: "214-555-1234", smsOptIn: true } })).status).toBe(422);
    expect((await as(member)("/api/account/phone", { method: "PUT", body: { phone: null, smsOptIn: true } })).status).toBe(400);
    const me = await json(await as(member)("/api/account/phone", { method: "PUT", body: { phone: "+12145551234", smsOptIn: true } }));
    expect(me).toMatchObject({ phone: "+12145551234", smsOptIn: true });
    expect(me.preferences).toMatchObject({ pushEnabled: true, pushMentions: true, pushMeetingReminders: true, smsMeetingReminders: false, digestCatchUp: true });
    const prefs = await json(
      await as(member)("/api/account/preferences", {
        method: "PUT",
        body: { ...me.preferences, smsMeetingReminders: true, pushMentions: false },
      }),
    );
    expect(prefs.preferences).toMatchObject({ smsMeetingReminders: true, pushMentions: false, pushEnabled: true });
    // The legacy preferences body (without wave 2 keys) keeps the stored channels.
    const { pushEnabled: _a, pushMeetingReminders: _b, pushMentions: _c, emailMeetingReminders: _d, smsMeetingReminders: _e, digestCatchUp: _f, ...legacy } = prefs.preferences;
    const kept = await json(await as(member)("/api/account/preferences", { method: "PUT", body: legacy }));
    expect(kept.preferences).toMatchObject({ smsMeetingReminders: true, pushMentions: false });
    const cleared = await json(await as(member)("/api/account/phone", { method: "PUT", body: { phone: null, smsOptIn: false } }));
    expect(cleared).toMatchObject({ phone: null, smsOptIn: false });
  });
});

// ---------------------------------------------------------------------------
// Reading log, streaks, challenges
// ---------------------------------------------------------------------------

describe("streak maths", () => {
  it("counts consecutive days ending today or yesterday and the longest run", () => {
    expect(computeStreak([], "2026-03-10")).toEqual({ current: 0, longest: 0, today: false, lastDay: null });
    expect(computeStreak(["2026-03-08", "2026-03-09", "2026-03-10", "2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"], "2026-03-10")).toEqual({
      current: 3,
      longest: 4,
      today: true,
      lastDay: "2026-03-10",
    });
    expect(computeStreak(["2026-03-08", "2026-03-09"], "2026-03-10").current).toBe(2);
    expect(computeStreak(["2026-03-07", "2026-03-08"], "2026-03-10").current).toBe(0);
    // Month boundary.
    expect(computeStreak(["2026-02-28", "2026-03-01"], "2026-03-01")).toMatchObject({ current: 2, longest: 2 });
  });
});

describe("reading log", () => {
  it("logs days, lists a range, computes the streak and refuses future days", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
    const edition = await seedEdition("Streak Book");
    const r1 = await json(await as(member)(`/api/reading-log/${day(-2)}?today=${today}`, { method: "PUT", body: { pages: 20, editionId: edition } }));
    expect(r1.entry).toMatchObject({ day: day(-2), pages: 20, minutes: 0 });
    expect(r1.entry.edition.id).toBe(edition);
    await as(member)(`/api/reading-log/${day(-1)}?today=${today}`, { method: "PUT", body: { minutes: 30, note: "Train ride" } });
    const r3 = await json(await as(member)(`/api/reading-log/${today}?today=${today}`, { method: "PUT", body: { pages: 12 } }));
    expect(r3.streak).toMatchObject({ current: 3, longest: 3, today: true, lastDay: today });
    expect((await as(member)(`/api/reading-log/${day(3)}?today=${today}`, { method: "PUT", body: { pages: 1 } })).status).toBe(400);
    expect((await as(member)(`/api/reading-log/not-a-day`, { method: "PUT", body: { pages: 1 } })).status).toBe(422);
    expect((await as(member)(`/api/reading-log/${today}`, { method: "PUT", body: { pages: 99999 } })).status).toBe(422);

    const list = await json(await as(member)(`/api/reading-log?from=${day(-2)}&to=${today}`));
    expect(list.map((e: any) => e.day)).toEqual([today, day(-1), day(-2)]);
    expect(list[1].note).toBe("Train ride");
    const streak = await json(await as(member)(`/api/reading-log/streak?today=${today}`));
    expect(streak).toMatchObject({ current: 3, longest: 3, today: true });
    // A zero day breaks nothing retroactively but does not count.
    await as(member)(`/api/reading-log/${day(-1)}?today=${today}`, { method: "PUT", body: { pages: 0, minutes: 0 } });
    expect((await json(await as(member)(`/api/reading-log/streak?today=${today}`))).current).toBe(1);
    // Other members never see each other's logs.
    expect(await json(await as(admin)(`/api/reading-log?from=${day(-2)}&to=${today}`))).toEqual([]);
    const del = await json(await as(member)(`/api/reading-log/${day(-1)}?today=${today}`, { method: "DELETE" }));
    expect(del.ok).toBe(true);
  });
});

describe("challenges", () => {
  const year = new Date().getUTCFullYear();
  const startsOn = `${year}-01-01`;
  const endsOn = `${year}-12-31`;

  it("personal challenges compute progress from finished books and pages; custom uses manual progress", async () => {
    const e1 = await seedEdition("Finished One");
    const e2 = await seedEdition("Finished Two");
    for (const ed of [e1, e2]) {
      const res = await as(member)(`/api/library/editions/${ed}`, { method: "PUT", body: { editionId: ed, status: "finished", visibility: "club" } });
      expect(res.status).toBe(200);
    }
    const created = await json(await as(member)("/api/challenges", { body: { title: "Two books", kind: "books", target: 2, startsOn, endsOn } }));
    expect(created).toMatchObject({ clubId: null, kind: "books", target: 2, joined: true, myProgress: 2 });
    expect(created.participants).toHaveLength(1);
    expect(created.participants[0].completedAt).toBeTruthy();
    // Owner is the only one who sees it.
    expect((await as(admin)(`/api/challenges/${created.id}`)).status).toBe(404);
    expect((await json(await as(admin)("/api/challenges"))).some((c: any) => c.id === created.id)).toBe(false);

    const pages = await json(await as(member)("/api/challenges", { body: { title: "Pages", kind: "pages", target: 100, startsOn, endsOn } }));
    expect(pages.myProgress).toBeGreaterThanOrEqual(12); // logged earlier in this file
    expect(pages.participants[0].completedAt).toBeNull();

    const custom = await json(await as(member)("/api/challenges", { body: { title: "Read outside", kind: "custom", target: 5, startsOn, endsOn } }));
    expect((await as(member)(`/api/challenges/${pages.id}/progress`, { method: "PUT", body: { progress: 3 } })).status).toBe(400);
    const bumped = await json(await as(member)(`/api/challenges/${custom.id}/progress`, { method: "PUT", body: { progress: 5 } }));
    expect(bumped.myProgress).toBe(5);
    expect(bumped.participants[0].completedAt).toBeTruthy();

    expect((await as(member)("/api/challenges", { body: { title: "Bad dates", kind: "books", target: 1, startsOn: endsOn, endsOn: startsOn } })).status).toBe(422);
    expect((await as(member)("/api/challenges", { body: { title: "Genre needs genre", kind: "genre", target: 1, startsOn, endsOn } })).status).toBe(400);

    const edited = await json(
      await as(member)(`/api/challenges/${created.id}`, { method: "PUT", body: { title: "Three books", kind: "books", target: 3, startsOn, endsOn, expectedVersion: created.version } }),
    );
    expect(edited).toMatchObject({ title: "Three books", target: 3, myProgress: 2, version: created.version + 1 });
    expect(edited.participants[0].completedAt).toBeNull();
    expect((await as(member)(`/api/challenges/${created.id}`, { method: "PUT", body: { title: "Stale", kind: "books", target: 3, startsOn, endsOn, expectedVersion: created.version } })).status).toBe(409);
    expect((await as(member)(`/api/challenges/${custom.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(member)(`/api/challenges/${custom.id}`)).status).toBe(404);
  });

  it("club challenges: any member creates, members join/leave, leaderboard sorts by progress, completion notifies", async () => {
    const created = await json(await as(member)(`${base}/challenges`, { body: { title: "Club books", kind: "books", target: 2, startsOn, endsOn } }));
    expect(created.clubId).toBe(club.id);
    expect(created.owner.id).toBe(member.id);
    expect(created.joined).toBe(true);
    const joined = await json(await as(admin)(`${base}/challenges/${created.id}/join`, { method: "POST", body: {} }));
    expect(joined.joined).toBe(true);
    expect(joined.participants.map((p: any) => p.id)).toEqual([member.id, admin.id]); // member has 2 finished, admin 0
    expect(joined.participants[0]).toMatchObject({ progress: 2 });
    expect(joined.participants[1]).toMatchObject({ progress: 0, completedAt: null });
    const notice = await testEnv.DB.prepare("SELECT title FROM notifications WHERE user_id = ? AND kind = 'challenge_update' ORDER BY created_at DESC LIMIT 2").bind(owner.id).all<any>();
    expect(notice.results.map((n) => n.title)).toEqual(expect.arrayContaining([expect.stringContaining("completed"), "New challenge: Club books"]));

    const left = await json(await as(admin)(`${base}/challenges/${created.id}/leave`, { method: "POST", body: {} }));
    expect(left.joined).toBe(false);
    expect(left.participants).toHaveLength(1);
    // Only the creator or an admin may edit/archive.
    expect((await as(owner)(`${base}/challenges/${created.id}`, { method: "DELETE" })).status).toBe(200);
    const again = await json(await as(member)(`${base}/challenges`, { body: { title: "Streak week", kind: "streak", target: 7, startsOn, endsOn } }));
    const other = await createMember("g_ch");
    await addToClub(owner, club, other);
    expect((await as(other)(`${base}/challenges/${again.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await as(outsider)(`${base}/challenges`)).status).toBe(403);
    const list = await json(await as(other)(`${base}/challenges`));
    expect(list.map((c: any) => c.id)).toEqual([again.id]);
  });
});

// ---------------------------------------------------------------------------
// Recaps
// ---------------------------------------------------------------------------

describe("recaps", () => {
  it("personal and club monthly recaps and Club Wrapped have the documented shapes", async () => {
    const month = new Date().toISOString().slice(0, 7);
    const personal = await json(await as(member)(`/api/recaps/monthly?month=${month}`));
    expect(personal).toMatchObject({ period: month, scope: "user", meetingsAttended: 0 });
    expect(personal.booksFinished.length).toBeGreaterThanOrEqual(2);
    expect(personal.booksFinished[0].edition.title).toBeTruthy();
    expect(personal.pagesRead).toBeGreaterThanOrEqual(12);
    expect(typeof personal.headline).toBe("string");
    expect((await as(member)("/api/recaps/monthly?month=2999-01")).status).toBe(400);
    expect((await as(member)("/api/recaps/monthly?month=nope")).status).toBe(422);

    // Club: put a completed book on the list, then read the recap.
    const ed = await seedEdition("Club Pick");
    const year = new Date().getUTCFullYear();
    const added = await json(await as(owner)(`${base}/books`, { body: { year, editionId: ed } }));
    expect(added.id).toBeTruthy();
    const completed = await as(owner)(`${base}/books/${added.id}`, { method: "PUT", body: { status: "completed", note: null, expectedVersion: added.version } });
    expect(completed.status).toBe(200);
    const clubRecap = await json(await as(member)(`${base}/recaps/monthly`));
    expect(clubRecap).toMatchObject({ period: month, scope: "club" });
    expect(clubRecap.booksFinished.map((b: any) => b.edition.id)).toContain(ed);
    expect(clubRecap.pagesRead).toBeGreaterThanOrEqual(12);
    expect(clubRecap.headline).toContain("Growth Club");

    const wrapped = await json(await as(member)(`${base}/recaps/wrapped?year=${year}`));
    expect(wrapped).toMatchObject({ year, clubName: "Growth Club", polls: { held: 0, votesCast: 0 }, attendanceRate: null });
    expect(wrapped.members).toBeGreaterThanOrEqual(3);
    expect(wrapped.booksRead.map((b: any) => b.id)).toContain(ed);
    expect(wrapped).toHaveProperty("mostLovedBook");
    expect(wrapped).toHaveProperty("topReviewer");
    expect(wrapped).toHaveProperty("longestStreak");
    expect(wrapped).toHaveProperty("busiestMonth");
    expect(wrapped).toHaveProperty("mostReacted");
    // Cached: the second read comes from recap_cache.
    const cache = await testEnv.DB.prepare("SELECT period FROM recap_cache WHERE scope = ?").bind(`club:${club.id}`).all<any>();
    expect(cache.results.map((r) => r.period).sort()).toEqual([month, String(year)].sort());
    expect((await as(outsider)(`${base}/recaps/wrapped`)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Feasibility, bridge, intelligence
// ---------------------------------------------------------------------------

describe("feasibility", () => {
  it("combines Open Library / archive.org lending and Google Books pricing with search links", async () => {
    const isbn = "9780000000002";
    const ed = await seedEdition("Feasible Book", isbn);
    await testEnv.DB.prepare("UPDATE book_editions SET page_count = 320 WHERE id = ?").bind(ed).run();
    const hits: string[] = [];
    vi.restoreAllMocks();
    installFetchMock((url) => {
      hits.push(url);
      if (url === `https://openlibrary.org/isbn/${isbn}.json`) return Response.json({ ocaid: "feasiblebook00auth" });
      if (url.startsWith("https://archive.org/services/loans/loan/")) return Response.json({ lending_status: "is_lendable" });
      if (url.startsWith("https://www.googleapis.com/books/v1/volumes?q=isbn:")) {
        return Response.json({
          items: [{ volumeInfo: { infoLink: "https://books.google.com/x" }, saleInfo: { saleability: "FOR_SALE", listPrice: { amount: 12.99, currencyCode: "USD" }, buyLink: "https://play.google.com/store/books/details?id=x" } }],
        });
      }
      return undefined;
    });
    const res = await as(member)(`/api/books/editions/${ed}/feasibility`);
    expect(res.status).toBe(200);
    const f = await json(res);
    expect(f).toMatchObject({
      pageCount: 320,
      estimatedHours: 8,
      library: { openLibraryLendable: true, archiveOrgUrl: "https://archive.org/details/feasiblebook00auth", worldcatUrl: `https://search.worldcat.org/isbn/${isbn}` },
      ebook: { googleBooksPrice: "$12.99", googleBooksUrl: "https://play.google.com/store/books/details?id=x", kindleUnlimited: "unknown" },
    });
    expect(f.ebook.kindleSearchUrl).toContain("amazon.com/s?k=Feasible%20Book%20Test%20Author&i=digital-text");
    expect(f.audio.libroFmUrl).toContain("libro.fm/search?q=");
    expect(f.audio.audibleSearchUrl).toContain("audible.com/search?keywords=");
    expect(hits.some((h) => h.includes("openlibrary.org"))).toBe(true);

    // Without an ISBN only links are returned; unknown editions are 404.
    const noIsbn = await seedEdition("Linkless");
    const g = await json(await as(member)(`/api/books/editions/${noIsbn}/feasibility`));
    expect(g.library).toEqual({ openLibraryLendable: null, archiveOrgUrl: null, worldcatUrl: null });
    expect(g.ebook.googleBooksPrice).toBeNull();
    expect((await as(member)("/api/books/editions/nope/feasibility")).status).toBe(404);
  });
});

describe("bridge", () => {
  it("builds share links from a meeting and posts a Discord embed through the stored webhook", async () => {
    const meetingId = `mt_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    await testEnv.DB.prepare(
      "INSERT INTO club_meetings (id, club_id, title, starts_at, location, created_by, created_at, updated_at) VALUES (?, ?, 'October meetup', '2026-10-30T00:00:00.000Z', 'The library', ?, ?, ?)",
    )
      .bind(meetingId, club.id, owner.id, now, now)
      .run();
    const share = await json(await as(member)(`${base}/bridge/share?kind=meeting&id=${meetingId}`));
    expect(share.url).toBe(`http://localhost/c/${club.id}/meetings/${meetingId}`);
    expect(share.text).toContain("Growth Club: October meetup on");
    expect(share.text).toContain("at The library");
    expect(share.whatsapp.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(share.whatsapp)).toContain(share.url);
    expect(share.sms.startsWith("sms:?&body=")).toBe(true);
    expect(share.email.startsWith("mailto:?subject=")).toBe(true);
    expect(share.copy).toBe(`${share.text} ${share.url}`);
    expect((await as(member)(`${base}/bridge/share?kind=poll&id=missing`)).status).toBe(404);
    expect((await as(member)(`${base}/bridge/share?kind=video&id=x`)).status).toBe(422);
    expect((await as(outsider)(`${base}/bridge/share?kind=meeting&id=${meetingId}`)).status).toBe(403);

    // Discord: not configured -> 409; configured -> server-side POST, URL never returned.
    expect((await as(admin)(`${base}/bridge/discord`, { body: { kind: "meeting", id: meetingId } })).status).toBe(409);
    const s = await json(await as(admin)(`${base}/settings`));
    await as(admin)(`${base}/settings`, { method: "PUT", body: { ...s, discordWebhookUrl: "https://discord.com/api/webhooks/42/secret-token", expectedVersion: s.version } });
    let posted: { url: string; body: any } | null = null;
    vi.restoreAllMocks();
    installFetchMock((url, init) => {
      if (url.startsWith("https://discord.com/api/webhooks/")) {
        posted = { url, body: JSON.parse(String(init?.body)) };
        return new Response(null, { status: 204 });
      }
      return undefined;
    });
    expect((await as(member)(`${base}/bridge/discord`, { body: { kind: "meeting", id: meetingId } })).status).toBe(403);
    const res = await as(admin)(`${base}/bridge/discord`, { body: { kind: "meeting", id: meetingId } });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("secret-token");
    expect(posted!.url).toBe("https://discord.com/api/webhooks/42/secret-token");
    expect(posted!.body.embeds[0]).toMatchObject({ title: "October meetup", url: share.url, footer: { text: "Growth Club" } });
    await testEnv.DB.prepare("DELETE FROM club_meetings WHERE id = ?").bind(meetingId).run();
  });
});

describe("cross-club intelligence", () => {
  it("warns about duplicate picks in the viewer's other clubs and suggests their finished books, without exposing members", async () => {
    const otherClub = await createClub(member, "Other Club");
    const shared = await seedEdition("Shared Pick");
    const suggestion = await seedEdition("Suggested Read");
    const year = new Date().getUTCFullYear();
    const a = await json(await as(member)(`/api/clubs/${otherClub.id}/books`, { body: { year, editionId: shared } }));
    expect(a.id).toBeTruthy();
    const b = await json(await as(member)(`/api/clubs/${otherClub.id}/books`, { body: { year, editionId: suggestion } }));
    await as(member)(`/api/clubs/${otherClub.id}/books/${b.id}`, { method: "PUT", body: { status: "completed", note: null, expectedVersion: b.version } });
    // Also put the shared pick on this club's list so it is excluded from suggestions.
    await as(owner)(`${base}/books`, { body: { year, editionId: shared } });

    const intel = await json(await as(member)(`${base}/intelligence?editionId=${shared}`));
    expect(intel.duplicatePicks).toEqual([{ clubName: "Other Club", year, status: "planned" }]);
    expect(intel.suggestions.map((s: any) => s.edition.id)).toEqual([suggestion]);
    expect(intel.suggestions[0].reason).toContain("Finished this year");
    expect(JSON.stringify(intel)).not.toContain(member.username);

    // Another member of this club is not in "Other Club": nothing leaks to them.
    const forAdmin = await json(await as(admin)(`${base}/intelligence?editionId=${shared}`));
    expect(forAdmin).toEqual({ duplicatePicks: [], suggestions: [] });
    expect((await as(member)(`${base}/intelligence?editionId=`)).status).toBe(200);
  });
});
