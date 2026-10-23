import { Hono, type Context } from "hono";
import { LIMITS, WAVE2_LIMITS } from "../../shared/constants";
import {
  brandingSchema,
  bridgeSchema,
  bridgeShareQuerySchema,
  bulkInviteSchema,
  clubSettingsSchema,
  idSchema,
  intelligenceQuerySchema,
  joinDecisionSchema,
  joinRequestsQuerySchema,
} from "../../shared/schemas";
import type { BulkInviteResult, ClubBranding, ClubIntelligence, ClubSettings, JoinRequest, ShareLinks, ShareLinksExtras } from "../../shared/types";
import { createEmailProvider } from "../email";
import { inviteEmail } from "../email/templates";
import type { AppEnv, Env } from "../env";
import { hasRole, newInviteCode, requireClubRole } from "../lib/club";
import { toCsv, parseInviteCsv } from "../lib/csv";
import { all, first, run } from "../lib/db";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { parseBody, parseWith } from "../lib/http";
import { editionCols, mapEdition, mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { notifyUsers } from "../lib/notify";
import { fileOwner, fileUrl, putFile } from "../lib/storage";
import { formatMeetingTime, newId, nowIso } from "../lib/util";
import { updateVersioned } from "../lib/versioned";
import { publish } from "../realtime/publish";
import { enforceRateLimit } from "../security/rate-limit";
import { afterJoin, assertCanJoin, joinStatements, parseScreeningQuestions } from "./clubs";

/**
 * Club growth and administration (W3): branding, settings, join-request
 * screening, bulk email invites, member export, the sharing "bridge" and
 * cross-club intelligence. Mounted at /api/clubs/:clubId behind requireClubMember.
 */
export const membershipRoutes = new Hono<AppEnv>();

const appUrl = (env: Env) => env.PUBLIC_APP_URL.replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

async function loadBranding(env: Env, clubId: string): Promise<ClubBranding & { version: number }> {
  const r = await first<{ banner_file_id: string | null; accent_color: string | null; version: number }>(
    env.DB,
    "SELECT banner_file_id, accent_color, version FROM clubs WHERE id = ?",
    clubId,
  );
  if (!r) throw notFound("Club not found");
  return { bannerUrl: r.banner_file_id ? fileUrl(clubId, r.banner_file_id) : null, accentColor: r.accent_color, version: Number(r.version) };
}

membershipRoutes.get("/branding", async (c) => c.json(await loadBranding(c.env, c.get("club").id)));

/**
 * Set the accent colour and banner. JSON `{ accentColor, bannerFileId, expectedVersion }`
 * (the banner is a file of kind "banner" uploaded via POST /files), or multipart
 * with a `file` field to upload and set the banner in one request.
 */
membershipRoutes.put("/branding", requireClubRole("admin"), async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  let input: ReturnType<typeof brandingSchema.parse>;
  const type = (c.req.header("content-type") ?? "").toLowerCase();
  if (type.startsWith("multipart/form-data")) {
    const form = await c.req.formData();
    const file = form.get("file");
    let bannerFileId = typeof form.get("bannerFileId") === "string" ? (form.get("bannerFileId") as string) : null;
    if (file instanceof File) {
      await enforceRateLimit(c.env, "file-upload", user.id, { window: 60 * 60, max: 60 });
      const record = await putFile(c.env, {
        clubId: club.id,
        ownerId: user.id,
        kind: "banner",
        title: "Club banner",
        filename: file.name || null,
        contentType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      bannerFileId = record.id;
    }
    input = parseWith(brandingSchema, {
      accentColor: form.get("accentColor") ?? undefined,
      bannerFileId: bannerFileId ?? undefined,
      expectedVersion: Number(form.get("expectedVersion")),
    });
  } else {
    input = await parseBody(c, brandingSchema);
  }
  if (input.bannerFileId) {
    const f = await fileOwner(c.env, club.id, input.bannerFileId);
    if (!f) throw notFound("Banner file not found");
    if (f.kind !== "banner") throw badRequest("Pick a file uploaded as a banner", { bannerFileId: ["Not a banner"] });
  }
  const updated = await updateVersioned({
    db: c.env.DB,
    table: "clubs",
    id: club.id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Club",
    set: { accent_color: input.accentColor, banner_file_id: input.bannerFileId },
    load: () => loadBranding(c.env, club.id),
  });
  c.executionCtx.waitUntil(publish(c.env, club.id, "all", { type: "club.updated", clubId: club.id }));
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface SettingsRow {
  welcome_message: string | null;
  join_policy: "link" | "approval";
  screening_questions: string;
  timezone: string;
  reminder_offsets: string;
  roles_rotation: string;
  discord_webhook_url: string | null;
  version: number;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function loadSettings(env: Env, clubId: string): Promise<ClubSettings & { version: number }> {
  const r = await first<SettingsRow>(
    env.DB,
    "SELECT welcome_message, join_policy, screening_questions, timezone, reminder_offsets, roles_rotation, discord_webhook_url, version FROM clubs WHERE id = ?",
    clubId,
  );
  if (!r) throw notFound("Club not found");
  const rotation = parseJson<Partial<ClubSettings["rolesRotation"]>>(r.roles_rotation, {});
  return {
    welcomeMessage: r.welcome_message,
    joinPolicy: r.join_policy === "approval" ? "approval" : "link",
    screeningQuestions: parseScreeningQuestions(r.screening_questions),
    timezone: r.timezone || "America/Chicago",
    reminderOffsets: parseJson<unknown[]>(r.reminder_offsets, [1440, 120]).filter((n): n is number => typeof n === "number"),
    rolesRotation: { host: rotation.host !== false, picker: rotation.picker !== false, notetaker: rotation.notetaker !== false },
    discordWebhookConfigured: !!r.discord_webhook_url,
    version: Number(r.version),
  };
}

membershipRoutes.get("/settings", requireClubRole("admin"), async (c) => c.json(await loadSettings(c.env, c.get("club").id)));

membershipRoutes.put("/settings", requireClubRole("admin"), async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const input = await parseBody(c, clubSettingsSchema);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    throw badRequest("Unknown time zone", { timezone: ["Use an IANA zone such as America/Chicago"] });
  }
  const questions = input.screeningQuestions.map((q) => ({ id: q.id || newId().slice(0, 12), label: q.label, required: q.required }));
  const set: Record<string, string | number | null> = {
    welcome_message: input.welcomeMessage,
    join_policy: input.joinPolicy,
    screening_questions: JSON.stringify(questions),
    timezone: input.timezone,
    reminder_offsets: JSON.stringify(Array.from(new Set(input.reminderOffsets)).sort((a, b) => b - a)),
    roles_rotation: JSON.stringify(input.rolesRotation),
  };
  // Write-only: undefined keeps the stored webhook, null clears it, a URL replaces it.
  if (input.discordWebhookUrl !== undefined) set.discord_webhook_url = input.discordWebhookUrl;
  const updated = await updateVersioned({
    db: c.env.DB,
    table: "clubs",
    id: club.id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Club",
    set,
    load: () => loadSettings(c.env, club.id),
  });
  c.executionCtx.waitUntil(publish(c.env, club.id, "all", { type: "club.updated", clubId: club.id }));
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// Join requests (screening)
// ---------------------------------------------------------------------------

const REQUEST_SELECT = `SELECT r.id, r.answers, r.message, r.status, r.decided_at, r.created_at, r.invite_id, r.user_id,
    ${memberCols("u", "m_")}, ${memberCols("d", "d_")}
  FROM join_requests r JOIN "user" u ON u.id = r.user_id LEFT JOIN "user" d ON d.id = r.decided_by`;

function mapRequest(r: Row): JoinRequest {
  const answers = parseJson<unknown[]>(r.answers as string, []).filter(
    (a): a is { questionId: string; label: string; answer: string } => !!a && typeof a === "object" && "label" in a,
  );
  return {
    id: String(r.id),
    member: mapMemberOrNull(r, "m_")!,
    answers: answers.map((a) => ({ questionId: String(a.questionId ?? ""), label: String(a.label), answer: String(a.answer ?? "") })),
    message: (r.message as string | null) ?? null,
    status: r.status as JoinRequest["status"],
    decidedBy: mapMemberOrNull(r, "d_"),
    decidedAt: (r.decided_at as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

membershipRoutes.get("/join-requests", requireClubRole("admin"), async (c) => {
  const q = parseWith(joinRequestsQuerySchema, { status: c.req.query("status") });
  const rows = await all<Row>(
    c.env.DB,
    `${REQUEST_SELECT} WHERE r.club_id = ? AND (? IS NULL OR r.status = ?) ORDER BY r.created_at DESC LIMIT 200`,
    c.get("club").id,
    q.status,
    q.status,
  );
  return c.json(rows.map(mapRequest) satisfies JoinRequest[]);
});

async function pendingRequest(c: Context<AppEnv>): Promise<Row & { user_id: string; invite_id: string | null }> {
  const id = parseWith(idSchema, c.req.param("id"));
  const row = await first<Row & { user_id: string; invite_id: string | null }>(c.env.DB, `${REQUEST_SELECT} WHERE r.id = ? AND r.club_id = ?`, id, c.get("club").id);
  if (!row) throw notFound("Request not found");
  if (row.status !== "pending") throw new ApiError(409, "already_decided", "This request has already been decided.");
  return row;
}

membershipRoutes.post("/join-requests/:id/approve", requireClubRole("admin"), async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  await parseBody(c, joinDecisionSchema).catch(() => ({ note: null }));
  const req = await pendingRequest(c);
  const requesterId = req.user_id;
  const already = await first(c.env.DB, "SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ?", club.id, requesterId);
  if (!already) await assertCanJoin(c.env, club.id, requesterId, club.memberLimit);
  const now = nowIso();
  await c.env.DB.batch([
    ...(already ? [] : await joinStatements(c.env, club.id, requesterId, null, now)),
    ...(req.invite_id
      ? [c.env.DB.prepare("UPDATE club_invites SET accepted_by = ? WHERE id = ? AND email IS NOT NULL").bind(requesterId, req.invite_id)]
      : []),
    c.env.DB.prepare("UPDATE join_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ?").bind(user.id, now, req.id as string),
  ]);
  const requesterName = String(req.m_name ?? "A new member");
  c.executionCtx.waitUntil(
    Promise.allSettled([
      notifyUsers(c.env, [requesterId], {
        kind: "join_approved",
        clubId: club.id,
        title: `Welcome to ${club.name}`,
        body: "Your request to join was approved.",
        link: `/c/${club.id}`,
        actorId: user.id,
      }),
      afterJoin(c.env, club, requesterId, requesterName, user.id),
    ]),
  );
  const updated = await first<Row>(c.env.DB, `${REQUEST_SELECT} WHERE r.id = ?`, req.id as string);
  return c.json(mapRequest(updated!));
});

membershipRoutes.post("/join-requests/:id/decline", requireClubRole("admin"), async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const input = await parseBody(c, joinDecisionSchema).catch(() => ({ note: null as string | null }));
  const req = await pendingRequest(c);
  await run(c.env.DB, "UPDATE join_requests SET status = 'declined', decided_by = ?, decided_at = ? WHERE id = ?", user.id, nowIso(), req.id as string);
  c.executionCtx.waitUntil(
    notifyUsers(c.env, [req.user_id], {
      kind: "club_removed",
      clubId: null,
      title: `Your request to join ${club.name} was not approved`,
      body: input.note,
      link: "/",
      actorId: user.id,
    }),
  );
  const updated = await first<Row>(c.env.DB, `${REQUEST_SELECT} WHERE r.id = ?`, req.id as string);
  return c.json(mapRequest(updated!));
});

// ---------------------------------------------------------------------------
// Bulk email invites
// ---------------------------------------------------------------------------

membershipRoutes.post("/invites/bulk", requireClubRole("admin"), async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  await enforceRateLimit(c.env, "invite-bulk", club.id, { window: 60 * 60, max: 3 });
  const input = await parseBody(c, bulkInviteSchema);
  const { rows, invalid } = parseInviteCsv(input.csv);
  if (rows.length + invalid.length === 0) throw badRequest("The file has no rows", { csv: ["Add at least one email address"] });
  if (rows.length + invalid.length > WAVE2_LIMITS.bulkInviteRowsMax) {
    throw badRequest(`Invite up to ${WAVE2_LIMITS.bulkInviteRowsMax} people per upload`, { csv: [`Too many rows (${rows.length + invalid.length})`] });
  }
  const skipped: BulkInviteResult["skipped"] = invalid.map((i) => ({ row: i.row, email: i.value, reason: i.reason }));
  const now = nowIso();
  const [members, pending] = await Promise.all([
    all<{ email: string }>(c.env.DB, `SELECT lower(u.email) AS email FROM club_members m JOIN "user" u ON u.id = m.user_id WHERE m.club_id = ?`, club.id),
    all<{ email: string }>(
      c.env.DB,
      `SELECT lower(i.email) AS email FROM club_invites i WHERE i.club_id = ? AND i.email IS NOT NULL AND i.revoked_at IS NULL
         AND (i.expires_at IS NULL OR i.expires_at > ?) AND (i.max_uses IS NULL OR i.use_count < i.max_uses)`,
      club.id,
      now,
    ),
  ]);
  const memberEmails = new Set(members.map((m) => m.email));
  const pendingEmails = new Set(pending.map((p) => p.email));
  const seen = new Set<string>();
  const toSend: { row: number; email: string; name: string | null; code: string; id: string }[] = [];
  for (const r of rows) {
    if (seen.has(r.email)) skipped.push({ row: r.row, email: r.email, reason: "Duplicate in file" });
    else if (memberEmails.has(r.email)) skipped.push({ row: r.row, email: r.email, reason: "Already a member" });
    else if (pendingEmails.has(r.email)) skipped.push({ row: r.row, email: r.email, reason: "Already invited" });
    else toSend.push({ ...r, code: newInviteCode(LIMITS.inviteCodeLength), id: newId() });
    seen.add(r.email);
  }
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86400_000).toISOString();
  if (toSend.length) {
    await c.env.DB.batch(
      toSend.map((t) =>
        c.env.DB
          .prepare("INSERT INTO club_invites (id, club_id, code, created_by, expires_at, max_uses, created_at, email, sent_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)")
          .bind(t.id, club.id, t.code, user.id, expiresAt, now, t.email, now),
      ),
    );
  }
  let sent = 0;
  let provider;
  try {
    provider = createEmailProvider(c.env);
  } catch (err) {
    console.error("bulk invite email skipped:", err instanceof Error ? err.message : err);
  }
  for (const t of toSend) {
    if (!provider) {
      skipped.push({ row: t.row, email: t.email, reason: "Email is not configured" });
      continue;
    }
    try {
      await provider.send(inviteEmail(t.email, t.name, club.name, user.name, `${appUrl(c.env)}/join/${t.code}`, input.expiresInDays));
      sent++;
    } catch (err) {
      console.error("invite email failed", err instanceof Error ? err.message : err);
      skipped.push({ row: t.row, email: t.email, reason: "Email could not be sent" });
    }
  }
  skipped.sort((a, b) => a.row - b.row);
  return c.json({ sent, skipped } satisfies BulkInviteResult, 201);
});

// ---------------------------------------------------------------------------
// Member export
// ---------------------------------------------------------------------------

membershipRoutes.get("/members/export.csv", requireClubRole("admin"), async (c) => {
  const club = c.get("club");
  const me = c.get("membership");
  const includeEmail = hasRole(me.role, "admin");
  const year = new Date().getUTCFullYear();
  const since = new Date(Date.now() - 365 * 86400_000).toISOString();
  const rows = await all<{ name: string; username: string; email: string; role: string; joined_at: string; attended: number; finished: number }>(
    c.env.DB,
    `SELECT u.name, u.username, u.email, m.role, m.joined_at,
            (SELECT COUNT(*) FROM meeting_attendance a JOIN club_meetings cm ON cm.id = a.meeting_id
              WHERE a.user_id = m.user_id AND a.present = 1 AND cm.club_id = m.club_id AND cm.starts_at >= ?) AS attended,
            (SELECT COUNT(*) FROM user_books ub WHERE ub.user_id = m.user_id AND ub.status = 'finished' AND ub.visibility = 'club'
              AND substr(ub.finished_at, 1, 4) = ?) AS finished
       FROM club_members m JOIN "user" u ON u.id = m.user_id
      WHERE m.club_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name COLLATE NOCASE`,
    since,
    String(year),
    club.id,
  );
  const header = ["Name", "Username", ...(includeEmail ? ["Email"] : []), "Role", "Joined", "Meetings attended (12 months)", `Books finished (${year})`];
  const body = rows.map((r) => [
    r.name,
    r.username,
    ...(includeEmail ? [r.email] : []),
    r.role,
    r.joined_at.slice(0, 10),
    Number(r.attended),
    Number(r.finished),
  ]);
  const safeName = club.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "club";
  return new Response(toCsv(header, body), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-members-${nowIso().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});

// ---------------------------------------------------------------------------
// Bridge: share links and Discord
// ---------------------------------------------------------------------------

interface ShareSource {
  title: string;
  text: string;
  path: string;
}

async function shareSource(env: Env, club: { id: string; name: string }, kind: "meeting" | "poll" | "assignment", id: string): Promise<ShareSource> {
  if (kind === "meeting") {
    const m = await first<{ title: string; starts_at: string; location: string | null; location_url: string | null; timezone: string | null; club_tz: string; book: string | null }>(
      env.DB,
      `SELECT m.title, m.starts_at, m.location, m.location_url, m.timezone, c.timezone AS club_tz, e.title AS book
         FROM club_meetings m JOIN clubs c ON c.id = m.club_id LEFT JOIN book_editions e ON e.id = m.edition_id
        WHERE m.id = ? AND m.club_id = ? AND m.archived_at IS NULL`,
      id,
      club.id,
    );
    if (!m) throw notFound("Meeting not found");
    const when = formatMeetingTime(m.starts_at, m.timezone ?? m.club_tz);
    const where = m.location ? ` at ${m.location}` : "";
    const book = m.book ? ` We are discussing ${m.book}.` : "";
    return { title: m.title, text: `${club.name}: ${m.title} on ${when}${where}.${book} RSVP in Chapterr:`, path: `/c/${club.id}/meetings/${id}` };
  }
  if (kind === "poll") {
    const p = await first<{ title: string; kind: string; closes_at: string | null; options: number }>(
      env.DB,
      `SELECT p.title, p.kind, p.closes_at, (SELECT COUNT(*) FROM poll_options o WHERE o.poll_id = p.id) AS options
         FROM polls p WHERE p.id = ? AND p.club_id = ? AND p.archived_at IS NULL`,
      id,
      club.id,
    );
    if (!p) throw notFound("Poll not found");
    const closes = p.closes_at ? ` Voting closes ${formatMeetingTime(p.closes_at, null)}.` : "";
    return { title: p.title, text: `${club.name} is voting: ${p.title} (${p.options} option${Number(p.options) === 1 ? "" : "s"}).${closes} Cast your vote in Chapterr:`, path: `/c/${club.id}/polls/${id}` };
  }
  const a = await first<{ due_date: string; reading_scope: string | null; book: string; from_page: number | null; to_page: number | null }>(
    env.DB,
    `SELECT a.due_date, a.reading_scope, a.from_page, a.to_page, e.title AS book FROM club_assignments a JOIN book_editions e ON e.id = a.edition_id
      WHERE a.id = ? AND a.club_id = ? AND a.archived_at IS NULL`,
    id,
    club.id,
  );
  if (!a) throw notFound("Assignment not found");
  const scope = a.reading_scope ?? (a.from_page && a.to_page ? `pages ${a.from_page} to ${a.to_page}` : null);
  return {
    title: `${a.book} by ${a.due_date}`,
    text: `${club.name} reading: ${a.book}${scope ? `, ${scope}` : ""}, due ${a.due_date}. Details in Chapterr:`,
    path: `/c/${club.id}/list`,
  };
}

membershipRoutes.get("/bridge/share", async (c) => {
  const club = c.get("club");
  const q = parseWith(bridgeShareQuerySchema, { kind: c.req.query("kind"), id: c.req.query("id") });
  const src = await shareSource(c.env, club, q.kind, q.id);
  const url = `${appUrl(c.env)}${src.path}`;
  const full = `${src.text} ${url}`;
  const links: ShareLinks & ShareLinksExtras = {
    text: src.text,
    url,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(full)}`,
    sms: `sms:?&body=${encodeURIComponent(full)}`,
    email: `mailto:?subject=${encodeURIComponent(`${club.name}: ${src.title}`)}&body=${encodeURIComponent(full)}`,
    copy: full,
  };
  return c.json(links);
});

/** Post an embed to the club's Discord webhook. The URL stays on the server. */
membershipRoutes.post("/bridge/discord", requireClubRole("admin"), async (c) => {
  const club = c.get("club");
  await enforceRateLimit(c.env, "bridge-discord", club.id, { window: 60 * 60, max: 10 });
  const input = await parseBody(c, bridgeSchema);
  const row = await first<{ discord_webhook_url: string | null; accent_color: string | null }>(c.env.DB, "SELECT discord_webhook_url, accent_color FROM clubs WHERE id = ?", club.id);
  if (!row?.discord_webhook_url) throw new ApiError(409, "discord_not_configured", "Add a Discord webhook in club settings first.");
  const src = await shareSource(c.env, club, input.kind, input.id);
  const url = `${appUrl(c.env)}${src.path}`;
  const color = row.accent_color ? parseInt(row.accent_color.slice(1), 16) : 0x1e3a2f;
  let res: Response;
  try {
    res = await fetch(row.discord_webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Chapterr",
        embeds: [{ title: src.title, description: src.text, url, color, footer: { text: club.name }, timestamp: nowIso() }],
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error("discord post failed", err instanceof Error ? err.message : err);
    throw new ApiError(502, "discord_failed", "Discord did not accept the message. Try again in a moment.");
  }
  if (!res.ok) throw new ApiError(502, "discord_failed", `Discord did not accept the message (status ${res.status}). Check the webhook in club settings.`);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Cross-club intelligence
// ---------------------------------------------------------------------------

membershipRoutes.get("/intelligence", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const q = parseWith(intelligenceQuerySchema, { editionId: c.req.query("editionId") });
  const year = new Date().getUTCFullYear();
  // Only clubs the viewer belongs to are consulted, and only book titles ever leave them.
  const otherClubsSql = `SELECT m.club_id FROM club_members m JOIN clubs oc ON oc.id = m.club_id AND oc.archived_at IS NULL WHERE m.user_id = ? AND m.club_id <> ?`;
  const duplicatePicks: ClubIntelligence["duplicatePicks"] = [];
  if (q.editionId) {
    const rows = await all<{ name: string; year: number; status: string }>(
      c.env.DB,
      `SELECT oc.name, b.year, b.status FROM club_annual_books b
         JOIN clubs oc ON oc.id = b.club_id
         JOIN book_editions e ON e.id = b.edition_id
        WHERE b.archived_at IS NULL AND b.club_id IN (${otherClubsSql})
          AND e.book_id = (SELECT book_id FROM book_editions WHERE id = ?)
        ORDER BY b.year DESC`,
      user.id,
      club.id,
      q.editionId,
    );
    duplicatePicks.push(...rows.map((r) => ({ clubName: r.name, year: Number(r.year), status: r.status })));
  }
  const suggestionRows = await all<Row & { clubs: number; completed: number; loved: number }>(
    c.env.DB,
    `SELECT ${editionCols("e", "e_")}, COUNT(DISTINCT b.club_id) AS clubs,
            SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) AS completed,
            (SELECT COUNT(*) FROM reviews r JOIN book_editions re ON re.id = r.edition_id
              WHERE re.book_id = e.book_id AND r.sentiment = 'loved' AND r.visibility = 'club'
                AND r.user_id IN (SELECT m2.user_id FROM club_members m2 WHERE m2.club_id IN (${otherClubsSql}))) AS loved
       FROM club_annual_books b JOIN book_editions e ON e.id = b.edition_id
      WHERE b.archived_at IS NULL AND b.club_id IN (${otherClubsSql})
        AND (b.year = ? OR substr(b.completed_at, 1, 4) = ?)
        AND b.status IN ('completed', 'current')
        AND e.book_id NOT IN (SELECT e2.book_id FROM club_annual_books b2 JOIN book_editions e2 ON e2.id = b2.edition_id WHERE b2.club_id = ? AND b2.archived_at IS NULL)
      GROUP BY e.book_id ORDER BY loved DESC, completed DESC, clubs DESC, e.title LIMIT 5`,
    user.id,
    club.id,
    user.id,
    club.id,
    year,
    String(year),
    club.id,
  );
  const suggestions = suggestionRows.map((r) => {
    const loved = Number(r.loved);
    const completed = Number(r.completed);
    const clubs = Number(r.clubs);
    const reason =
      loved > 0
        ? `Loved by ${loved} reader${loved === 1 ? "" : "s"} in your other club${clubs === 1 ? "" : "s"}`
        : completed > 0
          ? `Finished this year in ${completed === 1 ? "another club of yours" : `${completed} of your other clubs`}`
          : "Being read right now in another club of yours";
    return { edition: mapEdition(r, "e_"), reason };
  });
  return c.json({ duplicatePicks, suggestions } satisfies ClubIntelligence);
});
