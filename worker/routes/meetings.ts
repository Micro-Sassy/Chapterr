import { Hono, type Context } from "hono";
import { MEETING_ROLES, RSVP_LABELS, type MeetingRole, type RsvpStatus } from "../../shared/constants";
import {
  attendanceSchema,
  calendarMonthSchema,
  meetingCopySchema,
  meetingCreateSchema,
  meetingEditSchema,
  meetingNotesSchema,
  meetingRolesSchema,
  meetingScopeSchema,
  rsvpSchema,
  signupClaimSchema,
  signupItemSchema,
  signupListSchema,
  versionSchema,
  yearSchema,
} from "../../shared/schemas";
import type {
  AttendanceSummary,
  CalendarItem,
  CalendarMonth,
  CalendarYear,
  MeetingDetail,
  MeetingFull,
  MeetingScope,
  MemberSummary,
  RoleLedger,
  RoleLedgerEntry,
  RsvpEntry,
  SignupList,
} from "../../shared/types";
import type { AppEnv } from "../env";
import { hasRole } from "../lib/club";
import { all, bool, first, placeholders, run } from "../lib/db";
import { requireEdition } from "../lib/editions";
import { ApiError, badRequest, forbidden, notFound } from "../lib/errors";
import { parseBody, parseWith } from "../lib/http";
import type { IcsEvent } from "../lib/ics";
import { buildIcs } from "../lib/ics";
import { auditCols, auditJoins, editionCols, mapAudit, mapEdition, mapEditionOrNull, mapMember, mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { emailClubUpdate, notifyUsers } from "../lib/notify";
import { buildMeetingPack } from "../lib/pack";
import { expandOccurrences, localDateOf, parseRecurrence, recurrenceToRRule, safeZone, zonedToUtc } from "../lib/recurrence";
import { formatMeetingTime, newId, nowIso } from "../lib/util";
import { updateVersioned } from "../lib/versioned";
import { consumeRateLimit, enforceRateLimit } from "../security/rate-limit";
import { paceRoutes } from "./pace";

/**
 * Meetings, RSVPs, attendance, roles, notes, sign-up lists, meeting packs and
 * calendar views (docs/FEATURES-2.md §1). Mounted at /api/clubs/:clubId behind
 * requireClubMember; every query is scoped to the club.
 */
export const meetingRoutes = new Hono<AppEnv>();
meetingRoutes.route("/pace-plans", paceRoutes);

const includeArchived = (q: string | undefined) => q === "1" || q === "true";
const HOUR = 3600_000;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** `?1` is the viewer (null when there is none), so "mine" fields resolve per member. */
const MEETING_SELECT = `SELECT m.id, m.title, m.starts_at, m.ends_at, m.location, m.details, m.archived_at, m.timezone, m.location_url, m.rsvp_deadline,
  m.recurrence, m.series_id, m.notes, m.copied_from_id, m.host_user_id,
  ${auditCols("m")}, ${editionCols("e", "e_")}, ${memberCols("hu", "h_")}, ${memberCols("pu", "p_")}, ${memberCols("nu", "n_")},
  (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status = 'going') AS rsvp_going,
  (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status = 'maybe') AS rsvp_maybe,
  (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status = 'no') AS rsvp_no,
  (SELECT COALESCE(SUM(r.guests), 0) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status = 'going') AS rsvp_guests,
  (SELECT r.status FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.user_id = ?1) AS rsvp_mine,
  (SELECT r.guests FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.user_id = ?1) AS rsvp_mine_guests,
  (SELECT COUNT(*) FROM meeting_attendance a WHERE a.meeting_id = m.id AND a.present = 1) AS att_present,
  (SELECT a.present FROM meeting_attendance a WHERE a.meeting_id = m.id AND a.user_id = ?1) AS att_mine,
  CASE WHEN m.series_id IS NULL THEN NULL ELSE (SELECT COUNT(*) FROM club_meetings s WHERE s.series_id = m.series_id AND s.archived_at IS NULL AND s.starts_at < m.starts_at) + 1 END AS occ_index,
  CASE WHEN m.series_id IS NULL THEN NULL ELSE (SELECT COUNT(*) FROM club_meetings s WHERE s.series_id = m.series_id AND s.archived_at IS NULL) END AS occ_total
  FROM club_meetings m LEFT JOIN book_editions e ON e.id = m.edition_id ${auditJoins("m")}
  LEFT JOIN "user" hu ON hu.id = m.host_user_id LEFT JOIN "user" pu ON pu.id = m.picker_user_id LEFT JOIN "user" nu ON nu.id = m.notetaker_user_id`;

function mapMeeting(r: Row, now = Date.now()): MeetingFull {
  const deadline = (r.rsvp_deadline as string | null) ?? null;
  const present = Number(r.att_present ?? 0);
  const attendance: AttendanceSummary = {
    present,
    marked: present > 0,
    mine: r.att_mine === null || r.att_mine === undefined ? (present > 0 ? false : null) : bool(r.att_mine),
  };
  return {
    id: String(r.id),
    title: String(r.title),
    startsAt: String(r.starts_at),
    endsAt: (r.ends_at as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    details: (r.details as string | null) ?? null,
    edition: mapEditionOrNull(r, "e_"),
    archivedAt: (r.archived_at as string | null) ?? null,
    ...mapAudit(r),
    timezone: (r.timezone as string | null) ?? null,
    locationUrl: (r.location_url as string | null) ?? null,
    rsvpDeadline: deadline,
    recurrence: parseRecurrence(r.recurrence),
    seriesId: (r.series_id as string | null) ?? null,
    occurrence: r.occ_index ? { index: Number(r.occ_index), total: Number(r.occ_total) } : null,
    roles: { host: mapMemberOrNull(r, "h_"), picker: mapMemberOrNull(r, "p_"), notetaker: mapMemberOrNull(r, "n_") },
    notes: (r.notes as string | null) ?? null,
    copiedFromId: (r.copied_from_id as string | null) ?? null,
    rsvp: {
      going: Number(r.rsvp_going ?? 0),
      maybe: Number(r.rsvp_maybe ?? 0),
      no: Number(r.rsvp_no ?? 0),
      goingGuests: Number(r.rsvp_guests ?? 0),
      mine: (r.rsvp_mine as RsvpStatus | null) ?? null,
      myGuests: Number(r.rsvp_mine_guests ?? 0),
      deadlinePassed: !!deadline && Date.parse(deadline) < now,
    },
    attendance,
  };
}

export async function loadMeeting(db: D1Database, clubId: string, id: string, viewerId: string | null = null): Promise<MeetingFull | null> {
  const r = await first<Row>(db, `${MEETING_SELECT} WHERE m.club_id = ? AND m.id = ?`, viewerId, clubId, id);
  return r ? mapMeeting(r) : null;
}

export async function loadMeetings(
  db: D1Database,
  clubId: string,
  where: string,
  params: string[],
  order = "m.starts_at",
  limit = 200,
  viewerId: string | null = null,
): Promise<MeetingFull[]> {
  const rows = await all<Row>(db, `${MEETING_SELECT} WHERE m.club_id = ? AND (${where}) ORDER BY ${order} LIMIT ${limit}`, viewerId, clubId, ...params);
  const now = Date.now();
  return rows.map((r) => mapMeeting(r, now));
}

async function requireMeeting(db: D1Database, clubId: string, id: string, viewerId: string | null): Promise<MeetingFull> {
  const meeting = await loadMeeting(db, clubId, id, viewerId);
  if (!meeting) throw notFound("Meeting not found");
  return meeting;
}

async function loadRsvps(db: D1Database, meetingId: string): Promise<RsvpEntry[]> {
  const rows = await all<Row>(
    db,
    `SELECT ${memberCols("u", "m_")}, r.status, r.guests, r.note, r.updated_at FROM meeting_rsvps r JOIN "user" u ON u.id = r.user_id
      WHERE r.meeting_id = ? ORDER BY r.status, u.name COLLATE NOCASE`,
    meetingId,
  );
  return rows.map((r) => ({
    ...mapMember(r, "m_"),
    status: r.status as RsvpStatus,
    guests: Number(r.guests),
    note: (r.note as string | null) ?? null,
    updatedAt: String(r.updated_at),
  }));
}

async function loadAttendees(db: D1Database, meetingId: string): Promise<MemberSummary[]> {
  const rows = await all<Row>(
    db,
    `SELECT ${memberCols("u", "m_")} FROM meeting_attendance a JOIN "user" u ON u.id = a.user_id WHERE a.meeting_id = ? AND a.present = 1 ORDER BY u.name COLLATE NOCASE`,
    meetingId,
  );
  return rows.map((r) => mapMember(r, "m_"));
}

export async function loadSignupLists(db: D1Database, clubId: string, meetingId: string, viewerId: string): Promise<SignupList[]> {
  const lists = await all<Row>(db, "SELECT id, meeting_id, title, kind, version FROM signup_lists WHERE club_id = ? AND meeting_id = ? ORDER BY created_at", clubId, meetingId);
  if (lists.length === 0) return [];
  const listIds = lists.map((l) => String(l.id));
  const items = await all<Row>(
    db,
    `SELECT i.id, i.list_id, i.label, i.quantity, i.position FROM signup_items i WHERE i.list_id IN (${placeholders(listIds.length)}) ORDER BY i.position, i.created_at`,
    ...listIds,
  );
  const itemIds = items.map((i) => String(i.id));
  const claims = itemIds.length
    ? await all<Row>(
        db,
        `SELECT c.item_id, c.note, c.user_id, ${memberCols("u", "m_")} FROM signup_claims c JOIN "user" u ON u.id = c.user_id WHERE c.item_id IN (${placeholders(itemIds.length)}) ORDER BY c.created_at`,
        ...itemIds,
      )
    : [];
  return lists.map((l) => ({
    id: String(l.id),
    meetingId: String(l.meeting_id),
    title: String(l.title),
    kind: l.kind as SignupList["kind"],
    version: Number(l.version),
    items: items
      .filter((i) => i.list_id === l.id)
      .map((i) => {
        const mine = claims.filter((c) => c.item_id === i.id);
        return {
          id: String(i.id),
          label: String(i.label),
          quantity: Number(i.quantity),
          position: Number(i.position),
          claims: mine.map((c) => ({ ...mapMember(c, "m_"), note: (c.note as string | null) ?? null })),
          mine: mine.some((c) => c.user_id === viewerId),
        };
      }),
  }));
}

async function loadMeetingDetail(db: D1Database, clubId: string, id: string, viewerId: string): Promise<MeetingDetail> {
  const meeting = await requireMeeting(db, clubId, id, viewerId);
  const [rsvps, attendees, signupLists] = await Promise.all([loadRsvps(db, id), loadAttendees(db, id), loadSignupLists(db, clubId, id, viewerId)]);
  return { ...meeting, rsvps, attendees, signupLists };
}

async function clubZone(db: D1Database, clubId: string): Promise<string> {
  const row = await first<{ timezone: string }>(db, "SELECT timezone FROM clubs WHERE id = ?", clubId);
  return safeZone(row?.timezone, "America/Chicago");
}

async function memberIdSet(db: D1Database, clubId: string): Promise<Set<string>> {
  const rows = await all<{ user_id: string }>(db, "SELECT user_id FROM club_members WHERE club_id = ?", clubId);
  return new Set(rows.map((r) => r.user_id));
}

// ---------------------------------------------------------------------------
// Roles ledger
// ---------------------------------------------------------------------------

interface LedgerState {
  /** Members ordered by join date (the final tie-breaker). */
  members: { id: string; joinedAt: string; summary: MemberSummary }[];
  counts: Map<string, Record<MeetingRole, number>>;
  last: Map<string, Partial<Record<MeetingRole, string>>>;
}

const zeroCounts = (): Record<MeetingRole, number> => ({ host: 0, picker: 0, notetaker: 0 });

async function loadLedgerState(db: D1Database, clubId: string): Promise<LedgerState> {
  const members = await all<Row>(
    db,
    `SELECT cm.joined_at, ${memberCols("u", "m_")} FROM club_members cm JOIN "user" u ON u.id = cm.user_id WHERE cm.club_id = ? ORDER BY cm.joined_at, u.name COLLATE NOCASE`,
    clubId,
  );
  const ledger = await all<{ user_id: string; role: MeetingRole; n: number; last: string }>(
    db,
    "SELECT user_id, role, COUNT(*) AS n, MAX(assigned_at) AS last FROM role_ledger WHERE club_id = ? GROUP BY user_id, role",
    clubId,
  );
  const counts = new Map<string, Record<MeetingRole, number>>();
  const last = new Map<string, Partial<Record<MeetingRole, string>>>();
  for (const m of members) {
    counts.set(String(m.m_id), zeroCounts());
    last.set(String(m.m_id), {});
  }
  for (const l of ledger) {
    const c = counts.get(l.user_id);
    if (!c) continue;
    c[l.role] = Number(l.n);
    last.get(l.user_id)![l.role] = l.last;
  }
  return { members: members.map((m) => ({ id: String(m.m_id), joinedAt: String(m.joined_at), summary: mapMember(m, "m_") })), counts, last };
}

/** Fewest assignments of the role, then longest ago (never first), then longest-standing member. */
function pickFor(role: MeetingRole, state: LedgerState, excluded: Set<string>): MemberSummary | null {
  const pool = state.members.filter((m) => !excluded.has(m.id));
  const candidates = pool.length ? pool : state.members;
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const ca = state.counts.get(a.id)![role];
    const cb = state.counts.get(b.id)![role];
    if (ca !== cb) return ca - cb;
    const la = state.last.get(a.id)![role] ?? "";
    const lb = state.last.get(b.id)![role] ?? "";
    if (la !== lb) return la < lb ? -1 : 1;
    return a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : 0;
  });
  return sorted[0]!.summary;
}

function recordPick(state: LedgerState, role: MeetingRole, userId: string, at: string) {
  state.counts.get(userId)![role] += 1;
  state.last.get(userId)![role] = at;
}

async function enabledRoles(db: D1Database, clubId: string): Promise<MeetingRole[]> {
  const row = await first<{ roles_rotation: string }>(db, "SELECT roles_rotation FROM clubs WHERE id = ?", clubId);
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(row?.roles_rotation ?? "{}") as Record<string, unknown>;
  } catch {
    cfg = {};
  }
  return MEETING_ROLES.filter((r) => cfg[r] !== false);
}

/** Suggest one member per role without giving one person two roles when the club is big enough. */
function suggestAll(state: LedgerState, roles: MeetingRole[], excluded: Set<string>): Record<MeetingRole, MemberSummary | null> {
  const out: Record<MeetingRole, MemberSummary | null> = { host: null, picker: null, notetaker: null };
  const taken = new Set(excluded);
  for (const role of roles) {
    const pick = pickFor(role, state, taken);
    out[role] = pick;
    if (pick && state.members.length > taken.size + 1) taken.add(pick.id);
  }
  return out;
}

/** Statements that set the role columns and rewrite the ledger rows for this meeting. */
function roleStatements(db: D1Database, clubId: string, meetingId: string, roles: Partial<Record<MeetingRole, string | null>>, at: string): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];
  for (const role of MEETING_ROLES) {
    if (!(role in roles)) continue;
    const userId = roles[role] ?? null;
    stmts.push(db.prepare(`UPDATE club_meetings SET ${role}_user_id = ? WHERE id = ? AND club_id = ?`).bind(userId, meetingId, clubId));
    stmts.push(db.prepare("DELETE FROM role_ledger WHERE meeting_id = ? AND role = ?").bind(meetingId, role));
    if (userId) {
      stmts.push(
        db.prepare("INSERT INTO role_ledger (id, club_id, role, user_id, meeting_id, assigned_at) VALUES (?, ?, ?, ?, ?, ?)").bind(newId(), clubId, role, userId, meetingId, at),
      );
    }
  }
  return stmts;
}

meetingRoutes.get("/roles/ledger", async (c) => {
  const clubId = c.get("club").id;
  const [state, roles] = await Promise.all([loadLedgerState(c.env.DB, clubId), enabledRoles(c.env.DB, clubId)]);
  const members: RoleLedgerEntry[] = state.members.map((m) => ({ ...m.summary, counts: state.counts.get(m.id)!, lastAssignedAt: state.last.get(m.id)! }));
  const body: RoleLedger = { members, suggested: suggestAll(state, roles, new Set()) };
  return c.json(body);
});

meetingRoutes.put("/meetings/:id/roles", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("id");
  if (!hasRole(c.get("membership").role, "admin")) throw forbidden("Only club admins can assign roles");
  const input = await parseBody(c, meetingRolesSchema);
  await requireMeeting(c.env.DB, clubId, id, user.id);
  const members = await memberIdSet(c.env.DB, clubId);
  for (const role of MEETING_ROLES) {
    const uid = input[role];
    if (uid && !members.has(uid)) throw badRequest(`The ${role} must be a member of this club`, { [role]: ["Not a club member"] });
  }
  const now = nowIso();
  await c.env.DB.batch([
    ...roleStatements(c.env.DB, clubId, id, input, now),
    c.env.DB.prepare("UPDATE club_meetings SET version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND club_id = ?").bind(user.id, now, id, clubId),
  ]);
  return c.json(await loadMeetingDetail(c.env.DB, clubId, id, user.id));
});

// ---------------------------------------------------------------------------
// List / detail / .ics
// ---------------------------------------------------------------------------

meetingRoutes.get("/meetings", async (c) => {
  const clubId = c.get("club").id;
  const viewer = c.get("user").id;
  const when = c.req.query("when") ?? "upcoming";
  const base = includeArchived(c.req.query("archived")) ? "1 = 1" : "m.archived_at IS NULL";
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (from || to) {
    const clauses = [base];
    const params: string[] = [];
    if (from) {
      if (Number.isNaN(Date.parse(from))) throw badRequest("Invalid from");
      clauses.push("m.starts_at >= ?");
      params.push(new Date(from).toISOString());
    }
    if (to) {
      if (Number.isNaN(Date.parse(to))) throw badRequest("Invalid to");
      clauses.push("m.starts_at < ?");
      params.push(new Date(to).toISOString());
    }
    return c.json(await loadMeetings(c.env.DB, clubId, clauses.join(" AND "), params, "m.starts_at", 500, viewer));
  }
  const now = nowIso();
  if (when === "past") return c.json(await loadMeetings(c.env.DB, clubId, `${base} AND m.starts_at < ?`, [now], "m.starts_at DESC", 200, viewer));
  if (when === "all") return c.json(await loadMeetings(c.env.DB, clubId, base, [], "m.starts_at DESC", 500, viewer));
  // "upcoming" includes meetings that started within the last 6 hours.
  const since = new Date(Date.now() - 6 * HOUR).toISOString();
  return c.json(await loadMeetings(c.env.DB, clubId, `${base} AND m.starts_at >= ?`, [since], "m.starts_at", 200, viewer));
});

/** VEVENT for a meeting; recurring meetings carry an RRULE for the remaining occurrences when asked. */
export function meetingToIcsEvent(m: MeetingFull, clubId: string, origin: string, opts: { rruleCount?: number | null } = {}): IcsEvent {
  const description = [m.details, m.edition ? `Book: ${m.edition.title}` : null, m.locationUrl].filter(Boolean).join("\n");
  const rrule = opts.rruleCount && opts.rruleCount > 1 && m.recurrence ? recurrenceToRRule(m.recurrence, { count: opts.rruleCount }) : null;
  return {
    uid: `${m.id}@chapterr.io`,
    start: m.startsAt,
    end: m.endsAt,
    summary: m.title,
    description: description || null,
    location: m.location,
    url: `${origin}/c/${clubId}/meetings/${m.id}`,
    rrule,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    status: m.archivedAt ? "CANCELLED" : "CONFIRMED",
  };
}

export function appOrigin(url: string): string {
  return url.replace(/\/+$/, "");
}

meetingRoutes.get("/meetings/:file{[A-Za-z0-9_-]+\\.ics}", async (c) => {
  const club = c.get("club");
  const user = c.get("user");
  const id = c.req.param("file").replace(/\.ics$/, "");
  const meeting = await requireMeeting(c.env.DB, club.id, id, user.id);
  let remaining: number | null = null;
  if (meeting.seriesId) {
    const row = await first<{ n: number }>(
      c.env.DB,
      "SELECT COUNT(*) AS n FROM club_meetings WHERE club_id = ? AND series_id = ? AND archived_at IS NULL AND starts_at >= ?",
      club.id,
      meeting.seriesId,
      meeting.startsAt,
    );
    remaining = Number(row?.n ?? 0);
  }
  const zone = safeZone(meeting.timezone, await clubZone(c.env.DB, club.id));
  const ics = buildIcs({ name: club.name, timezone: zone, events: [meetingToIcsEvent(meeting, club.id, appOrigin(c.env.PUBLIC_APP_URL), { rruleCount: remaining })] });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="meeting-${id}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
});

meetingRoutes.get("/meetings/:id", async (c) => {
  return c.json(await loadMeetingDetail(c.env.DB, c.get("club").id, c.req.param("id"), c.get("user").id));
});

// ---------------------------------------------------------------------------
// Create (with recurrence and auto-assigned roles)
// ---------------------------------------------------------------------------

async function notifyNewMeeting(c: Context<AppEnv>, meeting: MeetingFull, occurrences: number) {
  const user = c.get("user");
  const club = c.get("club");
  const title = occurrences > 1 ? `New recurring meeting: ${meeting.title}` : `New meeting: ${meeting.title}`;
  // The notice links to the list (where new meetings are highlighted), as in wave 1.
  const path = `/c/${club.id}/meetings`;
  const zone = meeting.timezone ?? (await clubZone(c.env.DB, club.id));
  c.executionCtx.waitUntil(
    Promise.all([
      notifyUsers(c.env, "club", { kind: "club_meeting", clubId: club.id, title, body: meeting.location, link: path, actorId: user.id }),
      emailClubUpdate(c.env, {
        clubId: club.id,
        clubName: club.name,
        actorId: user.id,
        heading: title,
        lines: [
          `${user.name} scheduled a meeting of ${club.name} for ${formatMeetingTime(meeting.startsAt, zone)}${occurrences > 1 ? ` (${occurrences} occurrences)` : ""}.`,
          ...(meeting.location ? [`Where: ${meeting.location}`] : []),
        ],
        path,
      }),
    ]),
  );
}

meetingRoutes.post("/meetings", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  await enforceRateLimit(c.env, "meeting-create", club.id, { window: 3600, max: 30 });
  const input = await parseBody(c, meetingCreateSchema);
  if (input.editionId) await requireEdition(c.env.DB, input.editionId);
  const members = await memberIdSet(c.env.DB, club.id);
  if (input.roles) {
    for (const role of MEETING_ROLES) {
      const uid = input.roles[role];
      if (uid && !members.has(uid)) throw badRequest(`The ${role} must be a member of this club`, { [role]: ["Not a club member"] });
    }
  }
  const zone = safeZone(input.timezone, await clubZone(c.env.DB, club.id));
  const startsAt = new Date(input.startsAt).toISOString();
  const occurrences = input.recurrence ? expandOccurrences(startsAt, input.recurrence, zone) : [startsAt];
  const seriesId = input.recurrence ? newId() : null;
  const duration = input.endsAt ? Date.parse(input.endsAt) - Date.parse(startsAt) : null;
  const rsvpLead = input.rsvpDeadline ? Date.parse(startsAt) - Date.parse(input.rsvpDeadline) : null;
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const ids: string[] = [];
  const state = input.autoAssignRoles ? await loadLedgerState(c.env.DB, club.id) : null;
  const rotating = state ? await enabledRoles(c.env.DB, club.id) : [];
  for (const occ of occurrences) {
    const id = newId();
    ids.push(id);
    const startMs = Date.parse(occ);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO club_meetings (id, club_id, title, starts_at, ends_at, location, location_url, details, edition_id, timezone, rsvp_deadline, recurrence, series_id,
           created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        club.id,
        input.title,
        occ,
        duration !== null ? new Date(startMs + duration).toISOString() : null,
        input.location,
        input.locationUrl,
        input.details,
        input.editionId,
        zone,
        rsvpLead !== null ? new Date(startMs - rsvpLead).toISOString() : null,
        input.recurrence ? JSON.stringify(input.recurrence) : null,
        seriesId,
        user.id,
        user.id,
        now,
        now,
      ),
    );
    if (input.roles) {
      stmts.push(...roleStatements(c.env.DB, club.id, id, input.roles, now));
    } else if (state) {
      const picks = suggestAll(state, rotating, new Set());
      const roles: Partial<Record<MeetingRole, string | null>> = {};
      for (const role of rotating) {
        const pick = picks[role];
        roles[role] = pick?.id ?? null;
        if (pick) recordPick(state, role, pick.id, occ);
      }
      stmts.push(...roleStatements(c.env.DB, club.id, id, roles, now));
    }
  }
  // D1 batches are limited in size; chunk very long series.
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  const meeting = await requireMeeting(c.env.DB, club.id, ids[0]!, user.id);
  await notifyNewMeeting(c, meeting, occurrences.length);
  return c.json(meeting, 201);
});

// ---------------------------------------------------------------------------
// Edit / archive / restore with series scope
// ---------------------------------------------------------------------------

/** Ids and start times of the other occurrences the scope covers. */
async function seriesSiblings(db: D1Database, clubId: string, meeting: MeetingFull, scope: MeetingScope, archived: "live" | "archived" | "any") {
  if (scope === "this" || !meeting.seriesId) return [];
  const archivedClause = archived === "live" ? "AND archived_at IS NULL" : archived === "archived" ? "AND archived_at IS NOT NULL" : "";
  return all<{ id: string; starts_at: string; ends_at: string | null }>(
    db,
    `SELECT id, starts_at, ends_at FROM club_meetings WHERE club_id = ? AND series_id = ? AND id <> ? ${archivedClause} ${scope === "future" ? "AND starts_at > ?" : ""} ORDER BY starts_at`,
    clubId,
    meeting.seriesId,
    meeting.id,
    ...(scope === "future" ? [meeting.startsAt] : []),
  );
}

meetingRoutes.put("/meetings/:id", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("id");
  const scope = parseWith(meetingScopeSchema, c.req.query("scope") ?? undefined);
  const input = await parseBody(c, meetingEditSchema);
  if (input.editionId) await requireEdition(c.env.DB, input.editionId);
  const before = await requireMeeting(c.env.DB, clubId, id, user.id);
  const zone = input.timezone ?? before.timezone;
  const startsAt = new Date(input.startsAt).toISOString();
  const endsAt = input.endsAt ? new Date(input.endsAt).toISOString() : null;
  const rsvpDeadline = input.rsvpDeadline ? new Date(input.rsvpDeadline).toISOString() : null;
  const fields = { title: input.title, location: input.location, location_url: input.locationUrl, details: input.details, edition_id: input.editionId, timezone: zone };
  const meeting = await updateVersioned({
    db: c.env.DB,
    table: "club_meetings",
    id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Meeting",
    set: { ...fields, starts_at: startsAt, ends_at: endsAt, rsvp_deadline: rsvpDeadline },
    where: { club_id: clubId },
    load: () => loadMeeting(c.env.DB, clubId, id, user.id),
  });
  const siblings = await seriesSiblings(c.env.DB, clubId, before, scope, "live");
  const now = nowIso();
  if (siblings.length) {
    const delta = Date.parse(startsAt) - Date.parse(before.startsAt);
    const duration = endsAt ? Date.parse(endsAt) - Date.parse(startsAt) : null;
    const lead = rsvpDeadline ? Date.parse(startsAt) - Date.parse(rsvpDeadline) : null;
    const stmts = siblings.map((s) => {
      const start = Date.parse(s.starts_at) + delta;
      return c.env.DB.prepare(
        `UPDATE club_meetings SET title = ?, location = ?, location_url = ?, details = ?, edition_id = ?, timezone = ?, starts_at = ?, ends_at = ?, rsvp_deadline = ?,
           version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND club_id = ?`,
      ).bind(
        fields.title,
        fields.location,
        fields.location_url,
        fields.details,
        fields.edition_id,
        fields.timezone,
        new Date(start).toISOString(),
        duration !== null ? new Date(start + duration).toISOString() : null,
        lead !== null ? new Date(start - lead).toISOString() : null,
        user.id,
        now,
        s.id,
        clubId,
      );
    });
    for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  }
  if (input.roles) {
    await c.env.DB.batch(roleStatements(c.env.DB, clubId, id, input.roles, now));
    return c.json(await requireMeeting(c.env.DB, clubId, id, user.id));
  }
  return c.json(meeting);
});

for (const action of ["archive", "restore"] as const) {
  meetingRoutes.post(`/meetings/:id/${action}`, async (c) => {
    const user = c.get("user");
    const clubId = c.get("club").id;
    const id = c.req.param("id");
    const scope = parseWith(meetingScopeSchema, c.req.query("scope") ?? undefined);
    const { expectedVersion } = await parseBody(c, versionSchema);
    const before = await requireMeeting(c.env.DB, clubId, id, user.id);
    const archivedAt = action === "archive" ? nowIso() : null;
    const meeting = await updateVersioned({
      db: c.env.DB,
      table: "club_meetings",
      id,
      expectedVersion,
      userId: user.id,
      label: "Meeting",
      set: { archived_at: archivedAt },
      where: { club_id: clubId },
      load: () => loadMeeting(c.env.DB, clubId, id, user.id),
    });
    const siblings = await seriesSiblings(c.env.DB, clubId, before, scope, action === "archive" ? "live" : "archived");
    if (siblings.length) {
      const now = nowIso();
      await c.env.DB.batch(
        siblings.map((s) =>
          c.env.DB.prepare("UPDATE club_meetings SET archived_at = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND club_id = ?").bind(archivedAt, user.id, now, s.id, clubId),
        ),
      );
    }
    return c.json(siblings.length ? await requireMeeting(c.env.DB, clubId, id, user.id) : meeting);
  });
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

meetingRoutes.post("/meetings/:id/copy", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  await enforceRateLimit(c.env, "meeting-create", club.id, { window: 3600, max: 30 });
  const source = await requireMeeting(c.env.DB, club.id, c.req.param("id"), user.id);
  const input = await parseBody(c, meetingCopySchema);
  const startsAt = new Date(input.startsAt).toISOString();
  const duration = source.endsAt ? Date.parse(source.endsAt) - Date.parse(source.startsAt) : null;
  const id = newId();
  const now = nowIso();
  const keep = input.keep;
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO club_meetings (id, club_id, title, starts_at, ends_at, location, location_url, details, edition_id, timezone, copied_from_id, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      club.id,
      source.title,
      startsAt,
      duration !== null ? new Date(Date.parse(startsAt) + duration).toISOString() : null,
      keep.location ? source.location : null,
      keep.location ? source.locationUrl : null,
      keep.details ? source.details : null,
      keep.book ? (source.edition?.id ?? null) : null,
      source.timezone,
      source.id,
      user.id,
      user.id,
      now,
      now,
    ),
  ];
  if (keep.signups) {
    const lists = await loadSignupLists(c.env.DB, club.id, source.id, user.id);
    for (const list of lists) {
      const listId = newId();
      stmts.push(
        c.env.DB.prepare(
          "INSERT INTO signup_lists (id, club_id, meeting_id, title, kind, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(listId, club.id, id, list.title, list.kind, user.id, user.id, now, now),
      );
      for (const item of list.items) {
        stmts.push(
          c.env.DB.prepare("INSERT INTO signup_items (id, list_id, label, quantity, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
            newId(),
            listId,
            item.label,
            item.quantity,
            item.position,
            user.id,
            now,
          ),
        );
      }
    }
  }
  await c.env.DB.batch(stmts);
  const meeting = await requireMeeting(c.env.DB, club.id, id, user.id);
  await notifyNewMeeting(c, meeting, 1);
  return c.json(await loadMeetingDetail(c.env.DB, club.id, id, user.id), 201);
});

// ---------------------------------------------------------------------------
// RSVP
// ---------------------------------------------------------------------------

meetingRoutes.put("/meetings/:id/rsvp", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const id = c.req.param("id");
  await enforceRateLimit(c.env, "rsvp", user.id, { window: 3600, max: 60 });
  const input = await parseBody(c, rsvpSchema);
  const meeting = await requireMeeting(c.env.DB, club.id, id, user.id);
  if (meeting.archivedAt) throw new ApiError(409, "rsvp_closed", "This meeting has been archived");
  if (meeting.rsvpDeadline && Date.parse(meeting.rsvpDeadline) < Date.now()) throw new ApiError(409, "rsvp_closed", "RSVPs closed for this meeting");
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO meeting_rsvps (meeting_id, user_id, status, guests, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (meeting_id, user_id) DO UPDATE SET status = excluded.status, guests = excluded.guests, note = excluded.note, updated_at = excluded.updated_at`,
    id,
    user.id,
    input.status,
    input.guests,
    input.note,
    now,
  );
  const hostId = meeting.roles.host?.id ?? null;
  if (hostId && hostId !== user.id) {
    // At most one RSVP notice per member per meeting per hour (not scaled for environments).
    const throttle = await consumeRateLimit(c.env.DB, `rsvp-notify:${id}:${user.id}`, { window: 3600, max: 1 });
    if (throttle.allowed) {
      c.executionCtx.waitUntil(
        notifyUsers(c.env, [hostId], {
          kind: "rsvp_update",
          clubId: club.id,
          title: `${user.name}: ${RSVP_LABELS[input.status]}`,
          body: `${meeting.title}${input.guests ? ` (+${input.guests} guest${input.guests === 1 ? "" : "s"})` : ""}${input.note ? ` - ${input.note}` : ""}`,
          link: `/c/${club.id}/meetings/${id}`,
          actorId: user.id,
        }),
      );
    }
  }
  return c.json(await requireMeeting(c.env.DB, club.id, id, user.id));
});

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

meetingRoutes.put("/meetings/:id/attendance", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("id");
  const input = await parseBody(c, attendanceSchema);
  const meeting = await requireMeeting(c.env.DB, clubId, id, user.id);
  if (!hasRole(c.get("membership").role, "admin") && meeting.roles.host?.id !== user.id) throw forbidden("Only club admins or the host can mark attendance");
  const members = await memberIdSet(c.env.DB, clubId);
  const ids = Array.from(new Set(input.userIds)).filter((uid) => members.has(uid));
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM meeting_attendance WHERE meeting_id = ?").bind(id),
    ...ids.map((uid) => c.env.DB.prepare("INSERT INTO meeting_attendance (meeting_id, user_id, present, marked_by, marked_at) VALUES (?, ?, 1, ?, ?)").bind(id, uid, user.id, now)),
  ]);
  return c.json(await loadMeetingDetail(c.env.DB, clubId, id, user.id));
});

meetingRoutes.post("/meetings/:id/attendance/me", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("id");
  const meeting = await requireMeeting(c.env.DB, clubId, id, user.id);
  const distance = Math.abs(Date.now() - Date.parse(meeting.startsAt));
  if (distance > 6 * HOUR) throw new ApiError(409, "checkin_closed", "Self check-in is open from six hours before to six hours after the meeting");
  await run(
    c.env.DB,
    `INSERT INTO meeting_attendance (meeting_id, user_id, present, marked_by, marked_at) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT (meeting_id, user_id) DO UPDATE SET present = 1, marked_at = excluded.marked_at`,
    id,
    user.id,
    user.id,
    nowIso(),
  );
  return c.json(await requireMeeting(c.env.DB, clubId, id, user.id));
});

// ---------------------------------------------------------------------------
// Notes and meeting pack
// ---------------------------------------------------------------------------

meetingRoutes.put("/meetings/:id/notes", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("id");
  const input = await parseBody(c, meetingNotesSchema);
  const meeting = await updateVersioned({
    db: c.env.DB,
    table: "club_meetings",
    id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Meeting",
    set: { notes: input.notes },
    where: { club_id: clubId },
    load: () => loadMeeting(c.env.DB, clubId, id, user.id),
  });
  return c.json(meeting);
});

meetingRoutes.get("/meetings/:id/pack", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const meeting = await requireMeeting(c.env.DB, clubId, c.req.param("id"), user.id);
  return c.json(await buildMeetingPack(c.env.DB, clubId, meeting, user.id, c.req.query("refresh") === "1"));
});

// ---------------------------------------------------------------------------
// Sign-up lists
// ---------------------------------------------------------------------------

async function requireList(db: D1Database, clubId: string, listId: string): Promise<{ id: string; meeting_id: string }> {
  const row = await first<{ id: string; meeting_id: string }>(db, "SELECT id, meeting_id FROM signup_lists WHERE id = ? AND club_id = ?", listId, clubId);
  if (!row) throw notFound("Sign-up list not found");
  return row;
}

async function requireItem(db: D1Database, clubId: string, itemId: string): Promise<{ id: string; list_id: string; meeting_id: string; quantity: number }> {
  const row = await first<{ id: string; list_id: string; meeting_id: string; quantity: number }>(
    db,
    "SELECT i.id, i.list_id, l.meeting_id, i.quantity FROM signup_items i JOIN signup_lists l ON l.id = i.list_id WHERE i.id = ? AND l.club_id = ?",
    itemId,
    clubId,
  );
  if (!row) throw notFound("Sign-up item not found");
  return row;
}

async function oneList(db: D1Database, clubId: string, meetingId: string, listId: string, viewerId: string): Promise<SignupList> {
  const list = (await loadSignupLists(db, clubId, meetingId, viewerId)).find((l) => l.id === listId);
  if (!list) throw notFound("Sign-up list not found");
  return list;
}

async function touchList(db: D1Database, listId: string, userId: string): Promise<void> {
  await run(db, "UPDATE signup_lists SET version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?", userId, nowIso(), listId);
}

meetingRoutes.post("/meetings/:id/signups", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const meetingId = c.req.param("id");
  const input = await parseBody(c, signupListSchema);
  await requireMeeting(c.env.DB, clubId, meetingId, user.id);
  const id = newId();
  const now = nowIso();
  await run(
    c.env.DB,
    "INSERT INTO signup_lists (id, club_id, meeting_id, title, kind, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    clubId,
    meetingId,
    input.title,
    input.kind,
    user.id,
    user.id,
    now,
    now,
  );
  return c.json(await oneList(c.env.DB, clubId, meetingId, id, user.id), 201);
});

meetingRoutes.delete("/signups/:listId", async (c) => {
  const clubId = c.get("club").id;
  const list = await requireList(c.env.DB, clubId, c.req.param("listId"));
  await run(c.env.DB, "DELETE FROM signup_lists WHERE id = ? AND club_id = ?", list.id, clubId);
  return c.json({ ok: true });
});

meetingRoutes.post("/signups/:listId/items", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const list = await requireList(c.env.DB, clubId, c.req.param("listId"));
  const input = await parseBody(c, signupItemSchema);
  const count = await first<{ n: number; p: number | null }>(c.env.DB, "SELECT COUNT(*) AS n, MAX(position) AS p FROM signup_items WHERE list_id = ?", list.id);
  if (Number(count?.n ?? 0) >= 60) throw new ApiError(409, "list_full", "This list already has 60 items");
  await run(
    c.env.DB,
    "INSERT INTO signup_items (id, list_id, label, quantity, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    newId(),
    list.id,
    input.label,
    input.quantity,
    (count?.p ?? -1) + 1,
    user.id,
    nowIso(),
  );
  await touchList(c.env.DB, list.id, user.id);
  return c.json(await oneList(c.env.DB, clubId, list.meeting_id, list.id, user.id), 201);
});

meetingRoutes.put("/signups/items/:itemId", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const item = await requireItem(c.env.DB, clubId, c.req.param("itemId"));
  const input = await parseBody(c, signupItemSchema);
  await run(c.env.DB, "UPDATE signup_items SET label = ?, quantity = ? WHERE id = ?", input.label, input.quantity, item.id);
  await touchList(c.env.DB, item.list_id, user.id);
  return c.json(await oneList(c.env.DB, clubId, item.meeting_id, item.list_id, user.id));
});

meetingRoutes.delete("/signups/items/:itemId", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const item = await requireItem(c.env.DB, clubId, c.req.param("itemId"));
  await run(c.env.DB, "DELETE FROM signup_items WHERE id = ?", item.id);
  await touchList(c.env.DB, item.list_id, user.id);
  return c.json(await oneList(c.env.DB, clubId, item.meeting_id, item.list_id, user.id));
});

/** Toggle the caller's claim on an item (claim when unclaimed, release when claimed). */
meetingRoutes.put("/signups/items/:itemId/claim", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const item = await requireItem(c.env.DB, clubId, c.req.param("itemId"));
  const input = await parseBody(c, signupClaimSchema);
  const existing = await first<{ item_id: string }>(c.env.DB, "SELECT item_id FROM signup_claims WHERE item_id = ? AND user_id = ?", item.id, user.id);
  if (existing) {
    await run(c.env.DB, "DELETE FROM signup_claims WHERE item_id = ? AND user_id = ?", item.id, user.id);
  } else {
    const claimed = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM signup_claims WHERE item_id = ?", item.id);
    if (Number(claimed?.n ?? 0) >= Number(item.quantity)) throw new ApiError(409, "item_taken", "Everyone needed for this item has already signed up");
    await run(c.env.DB, "INSERT INTO signup_claims (item_id, user_id, note, created_at) VALUES (?, ?, ?, ?)", item.id, user.id, input.note, nowIso());
  }
  await touchList(c.env.DB, item.list_id, user.id);
  return c.json(await oneList(c.env.DB, clubId, item.meeting_id, item.list_id, user.id));
});

// ---------------------------------------------------------------------------
// Calendar views and feed URL
// ---------------------------------------------------------------------------

async function calendarItems(db: D1Database, clubId: string, viewerId: string, fromIso: string, toIso: string, fromDate: string, toDate: string): Promise<CalendarItem[]> {
  const [meetings, assignments, polls] = await Promise.all([
    loadMeetings(db, clubId, "m.archived_at IS NULL AND m.starts_at >= ? AND m.starts_at < ?", [fromIso, toIso], "m.starts_at", 500, viewerId),
    all<Row>(
      db,
      `SELECT a.id, a.due_date, a.reading_scope, ${editionCols("e", "e_")} FROM club_assignments a JOIN book_editions e ON e.id = a.edition_id
        WHERE a.club_id = ? AND a.archived_at IS NULL AND a.due_date >= ? AND a.due_date <= ? ORDER BY a.due_date`,
      clubId,
      fromDate,
      toDate,
    ),
    all<{ id: string; title: string; closes_at: string }>(
      db,
      "SELECT id, title, closes_at FROM polls WHERE club_id = ? AND archived_at IS NULL AND closes_at IS NOT NULL AND closes_at >= ? AND closes_at < ? ORDER BY closes_at",
      clubId,
      fromIso,
      toIso,
    ),
  ]);
  const items: CalendarItem[] = [
    ...meetings.map<CalendarItem>((m) => ({
      id: m.id,
      kind: "meeting",
      title: m.title,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      allDay: false,
      link: `/c/${clubId}/meetings/${m.id}`,
      edition: m.edition,
      rsvp: m.rsvp.mine,
    })),
    ...assignments.map<CalendarItem>((a) => {
      const edition = mapEdition(a, "e_");
      return {
        id: String(a.id),
        kind: "assignment",
        title: `Read ${edition.title}${a.reading_scope ? `: ${a.reading_scope}` : ""}`,
        startsAt: String(a.due_date),
        endsAt: null,
        allDay: true,
        link: `/c/${clubId}`,
        edition,
        rsvp: null,
      };
    }),
    ...polls.map<CalendarItem>((p) => ({
      id: p.id,
      kind: "poll",
      title: `Poll closes: ${p.title}`,
      startsAt: p.closes_at,
      endsAt: null,
      allDay: false,
      link: `/c/${clubId}/polls/${p.id}`,
      edition: null,
      rsvp: null,
    })),
  ];
  return items.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
}

function monthBounds(year: number, month: number, zone: string) {
  const fromIso = zonedToUtc({ year, month, day: 1, hour: 0, minute: 0, second: 0 }, zone).toISOString();
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const toIso = zonedToUtc({ ...next, day: 1, hour: 0, minute: 0, second: 0 }, zone).toISOString();
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const nextKey = `${next.year}-${String(next.month).padStart(2, "0")}`;
  return { fromIso, toIso, fromDate: `${key}-01`, toDate: `${nextKey}-00`, key };
}

meetingRoutes.get("/calendar", async (c) => {
  const clubId = c.get("club").id;
  const viewer = c.get("user").id;
  const zone = await clubZone(c.env.DB, clubId);
  const monthParam = c.req.query("month");
  const yearParam = c.req.query("year");
  if (monthParam) {
    const month = parseWith(calendarMonthSchema, monthParam);
    const b = monthBounds(Number(month.slice(0, 4)), Number(month.slice(5, 7)), zone);
    const body: CalendarMonth = { month, items: await calendarItems(c.env.DB, clubId, viewer, b.fromIso, b.toIso, b.fromDate, b.toDate) };
    return c.json(body);
  }
  const year = parseWith(yearSchema, yearParam ?? new Date().getUTCFullYear());
  const first_ = monthBounds(year, 1, zone);
  const last = monthBounds(year, 12, zone);
  const items = await calendarItems(c.env.DB, clubId, viewer, first_.fromIso, last.toIso, first_.fromDate, last.toDate);
  const months: CalendarYear["months"] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, "0")}`;
    const inMonth = items.filter((i) => (i.allDay ? i.startsAt.slice(0, 7) : localDateOf(new Date(i.startsAt), zone).slice(0, 7)) === key);
    months.push({
      month: key,
      counts: {
        meetings: inMonth.filter((i) => i.kind === "meeting").length,
        assignments: inMonth.filter((i) => i.kind === "assignment").length,
        polls: inMonth.filter((i) => i.kind === "poll").length,
      },
      items: inMonth,
    });
  }
  const body: CalendarYear = { year, months };
  return c.json(body);
});

/** HMAC-SHA256(secret, userId:clubId) as base64url. */
export async function calendarTokenMac(secret: string, userId: string, clubId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${userId}:${clubId}`));
  return toBase64Url(new Uint8Array(sig));
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): string | null {
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    return atob(b64);
  } catch {
    return null;
  }
}

meetingRoutes.get("/calendar/feed-url", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const mac = await calendarTokenMac(c.env.BETTER_AUTH_SECRET, user.id, clubId);
  const token = toBase64Url(new TextEncoder().encode(`${user.id}:${clubId}:${mac}`));
  return c.json({ url: `${appOrigin(c.env.PUBLIC_APP_URL)}/api/public/calendar/${token}.ics` });
});
