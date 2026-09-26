import { Hono } from "hono";
import {
  activitySchema,
  activityUpdateSchema,
  assignmentSchema,
  assignmentUpdateSchema,
  clubAnnualBookCreateSchema,
  clubAnnualBookUpdateSchema,
  clubAnnualReorderSchema,
  clubGoalSchema,
  meetingSchema,
  meetingUpdateSchema,
  versionSchema,
  yearSchema,
} from "../../shared/schemas";
import type { Assignment, ClubActivity, ClubAnnualBook, ClubGoal, Meeting } from "../../shared/types";
import type { AppEnv } from "../env";
import { all, first, run } from "../lib/db";
import { requireEdition } from "../lib/editions";
import { ApiError, conflict, notFound } from "../lib/errors";
import { parseBody, parseWith } from "../lib/http";
import { auditCols, auditJoins, editionCols, mapAudit, mapEdition, mapEditionOrNull, type Row } from "../lib/mappers";
import { emailClubUpdate, notifyUsers } from "../lib/notify";
import { currentYear, newId, nowIso } from "../lib/util";
import { updateVersioned } from "../lib/versioned";

/**
 * Shared club data. There are no roles: every signed-in member may create,
 * edit, reorder and archive these records. Concurrent edits are detected with
 * a per-record version number (HTTP 409 on conflict). created_by/updated_by
 * are recorded for transparency but grant no special powers.
 */
export const clubRoutes = new Hono<AppEnv>();

const includeArchived = (q: string | undefined) => q === "1" || q === "true";

// ---------------------------------------------------------------------------
// Annual goal
// ---------------------------------------------------------------------------

async function clubCompleted(db: D1Database, year: number): Promise<number> {
  const row = await first<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM club_annual_books WHERE year = ? AND status = 'completed' AND archived_at IS NULL",
    year,
  );
  return Number(row?.n ?? 0);
}

export async function loadClubGoal(db: D1Database, year: number): Promise<ClubGoal | null> {
  const r = await first<Row>(db, `SELECT g.id, g.year, g.target, ${auditCols("g")} FROM club_annual_goals g ${auditJoins("g")} WHERE g.year = ?`, year);
  if (!r) return null;
  return { id: String(r.id), year: Number(r.year), target: Number(r.target), completed: await clubCompleted(db, year), ...mapAudit(r) };
}

clubRoutes.get("/goal", async (c) => {
  const year = parseWith(yearSchema, c.req.query("year") ?? currentYear());
  return c.json({ goal: await loadClubGoal(c.env.DB, year), completed: await clubCompleted(c.env.DB, year), year });
});

clubRoutes.put("/goal", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, clubGoalSchema);
  const existing = await first<{ id: string }>(c.env.DB, "SELECT id FROM club_annual_goals WHERE year = ?", input.year);
  if (!existing) {
    const now = nowIso();
    try {
      await run(
        c.env.DB,
        "INSERT INTO club_annual_goals (id, year, target, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        newId(),
        input.year,
        input.target,
        user.id,
        user.id,
        now,
        now,
      );
    } catch {
      throw conflict("Someone else just set this year's goal. Review it and try again.", await loadClubGoal(c.env.DB, input.year));
    }
    return c.json(await loadClubGoal(c.env.DB, input.year), 201);
  }
  if (!input.expectedVersion) {
    throw conflict("A goal for this year already exists. Review it and try again.", await loadClubGoal(c.env.DB, input.year));
  }
  const goal = await updateVersioned({
    db: c.env.DB,
    table: "club_annual_goals",
    id: existing.id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Goal",
    set: { target: input.target },
    load: () => loadClubGoal(c.env.DB, input.year),
  });
  return c.json(goal);
});

// ---------------------------------------------------------------------------
// Shared annual book list
// ---------------------------------------------------------------------------

function mapAnnualBook(r: Row): ClubAnnualBook {
  return {
    id: String(r.id),
    year: Number(r.year),
    edition: mapEdition(r, "e_"),
    position: Number(r.position),
    status: r.status as ClubAnnualBook["status"],
    completedAt: (r.completed_at as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    archivedAt: (r.archived_at as string | null) ?? null,
    ...mapAudit(r),
  };
}

const ANNUAL_SELECT = `SELECT b.id, b.year, b.position, b.status, b.completed_at, b.note, b.archived_at, ${auditCols("b")}, ${editionCols("e", "e_")}
  FROM club_annual_books b JOIN book_editions e ON e.id = b.edition_id ${auditJoins("b")}`;

export async function loadAnnualBooks(db: D1Database, year: number, withArchived = false): Promise<ClubAnnualBook[]> {
  const rows = await all<Row>(
    db,
    `${ANNUAL_SELECT} WHERE b.year = ? ${withArchived ? "" : "AND b.archived_at IS NULL"} ORDER BY b.archived_at IS NOT NULL, b.position, b.created_at`,
    year,
  );
  return rows.map(mapAnnualBook);
}

async function loadAnnualBook(db: D1Database, id: string): Promise<ClubAnnualBook | null> {
  const r = await first<Row>(db, `${ANNUAL_SELECT} WHERE b.id = ?`, id);
  return r ? mapAnnualBook(r) : null;
}

clubRoutes.get("/books", async (c) => {
  const year = parseWith(yearSchema, c.req.query("year") ?? currentYear());
  return c.json(await loadAnnualBooks(c.env.DB, year, includeArchived(c.req.query("archived"))));
});

clubRoutes.get("/books/years", async (c) => {
  const rows = await all<{ year: number }>(
    c.env.DB,
    "SELECT DISTINCT year FROM club_annual_books UNION SELECT year FROM club_annual_goals ORDER BY year DESC",
  );
  return c.json(rows.map((r) => Number(r.year)));
});

clubRoutes.post("/books", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, clubAnnualBookCreateSchema);
  await requireEdition(c.env.DB, input.editionId);
  const dup = await first<{ id: string }>(
    c.env.DB,
    "SELECT id FROM club_annual_books WHERE year = ? AND edition_id = ? AND archived_at IS NULL",
    input.year,
    input.editionId,
  );
  if (dup) throw new ApiError(409, "duplicate", "That book is already on this year's list", { current: await loadAnnualBook(c.env.DB, dup.id) });
  const max = await first<{ p: number | null }>(c.env.DB, "SELECT MAX(position) AS p FROM club_annual_books WHERE year = ?", input.year);
  const id = newId();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO club_annual_books (id, year, edition_id, position, status, completed_at, note, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.year,
    input.editionId,
    (max?.p ?? -1) + 1,
    input.status,
    input.status === "completed" ? now.slice(0, 10) : null,
    input.note,
    user.id,
    user.id,
    now,
    now,
  );
  return c.json(await loadAnnualBook(c.env.DB, id), 201);
});

clubRoutes.put("/books/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = await parseBody(c, clubAnnualBookUpdateSchema);
  const before = await loadAnnualBook(c.env.DB, id);
  if (!before) throw notFound("List entry not found");
  const completedAt = input.status === "completed" ? (before.completedAt ?? nowIso().slice(0, 10)) : null;
  const book = await updateVersioned({
    db: c.env.DB,
    table: "club_annual_books",
    id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "List entry",
    set: { status: input.status, note: input.note, completed_at: completedAt },
    load: () => loadAnnualBook(c.env.DB, id),
  });
  return c.json(book);
});

/**
 * Reorder the whole list for a year. The client sends the ids in the order it
 * sees them; if the set no longer matches (someone added/archived an entry in
 * the meantime) the request is rejected with the current list.
 */
clubRoutes.post("/books/reorder", async (c) => {
  const user = c.get("user");
  const { year, orderedIds } = await parseBody(c, clubAnnualReorderSchema);
  const current = await all<{ id: string }>(c.env.DB, "SELECT id FROM club_annual_books WHERE year = ? AND archived_at IS NULL", year);
  const currentSet = new Set(current.map((r) => r.id));
  const same = orderedIds.length === currentSet.size && new Set(orderedIds).size === orderedIds.length && orderedIds.every((id) => currentSet.has(id));
  if (!same) throw conflict("The list changed while you were reordering it. Here is the latest version.", await loadAnnualBooks(c.env.DB, year));
  const now = nowIso();
  await c.env.DB.batch(
    orderedIds.map((id, index) =>
      c.env.DB.prepare(
        "UPDATE club_annual_books SET position = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND year = ?",
      ).bind(index, user.id, now, id, year),
    ),
  );
  return c.json(await loadAnnualBooks(c.env.DB, year));
});

for (const action of ["archive", "restore"] as const) {
  clubRoutes.post(`/books/:id/${action}`, async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const { expectedVersion } = await parseBody(c, versionSchema);
    if (action === "restore") {
      const entry = await loadAnnualBook(c.env.DB, id);
      if (entry) {
        const clash = await first<{ id: string }>(
          c.env.DB,
          "SELECT id FROM club_annual_books WHERE year = ? AND edition_id = ? AND archived_at IS NULL AND id <> ?",
          entry.year,
          entry.edition.id,
          id,
        );
        if (clash) throw new ApiError(409, "duplicate", "That book is already back on this year's list");
      }
    }
    const book = await updateVersioned({
      db: c.env.DB,
      table: "club_annual_books",
      id,
      expectedVersion,
      userId: user.id,
      label: "List entry",
      set: { archived_at: action === "archive" ? nowIso() : null },
      load: () => loadAnnualBook(c.env.DB, id),
    });
    return c.json(book);
  });
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

const MEETING_SELECT = `SELECT m.id, m.title, m.starts_at, m.ends_at, m.location, m.details, m.archived_at, ${auditCols("m")}, ${editionCols("e", "e_")}
  FROM club_meetings m LEFT JOIN book_editions e ON e.id = m.edition_id ${auditJoins("m")}`;

function mapMeeting(r: Row): Meeting {
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
  };
}

export async function loadMeeting(db: D1Database, id: string): Promise<Meeting | null> {
  const r = await first<Row>(db, `${MEETING_SELECT} WHERE m.id = ?`, id);
  return r ? mapMeeting(r) : null;
}

export async function loadMeetings(db: D1Database, where: string, params: string[], order = "m.starts_at", limit = 200): Promise<Meeting[]> {
  const rows = await all<Row>(db, `${MEETING_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${limit}`, ...params);
  return rows.map(mapMeeting);
}

clubRoutes.get("/meetings", async (c) => {
  const when = c.req.query("when") ?? "upcoming";
  const archived = includeArchived(c.req.query("archived"));
  const now = nowIso();
  const base = archived ? "1 = 1" : "m.archived_at IS NULL";
  if (when === "past") return c.json(await loadMeetings(c.env.DB, `${base} AND m.starts_at < ?`, [now], "m.starts_at DESC"));
  if (when === "all") return c.json(await loadMeetings(c.env.DB, base, [], "m.starts_at DESC"));
  // "upcoming" includes meetings that started within the last 6 hours.
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  return c.json(await loadMeetings(c.env.DB, `${base} AND m.starts_at >= ?`, [since]));
});

clubRoutes.get("/meetings/:id", async (c) => {
  const meeting = await loadMeeting(c.env.DB, c.req.param("id"));
  if (!meeting) throw notFound("Meeting not found");
  return c.json(meeting);
});

clubRoutes.post("/meetings", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, meetingSchema);
  if (input.editionId) await requireEdition(c.env.DB, input.editionId);
  const id = newId();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO club_meetings (id, title, starts_at, ends_at, location, details, edition_id, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.title,
    new Date(input.startsAt).toISOString(),
    input.endsAt ? new Date(input.endsAt).toISOString() : null,
    input.location,
    input.details,
    input.editionId,
    user.id,
    user.id,
    now,
    now,
  );
  const meeting = await loadMeeting(c.env.DB, id);
  if (meeting) {
    const title = `New meeting: ${meeting.title}`;
    c.executionCtx.waitUntil(
      Promise.all([
        notifyUsers(c.env, "all", { kind: "club_meeting", title, body: meeting.location, link: `/club/meetings`, actorId: user.id }),
        emailClubUpdate(
          c.env,
          user.id,
          title,
          [`${user.name} scheduled a club meeting starting ${new Date(meeting.startsAt).toUTCString()}.`, ...(meeting.location ? [`Where: ${meeting.location}`] : [])],
          "/club/meetings",
        ),
      ]),
    );
  }
  return c.json(meeting, 201);
});

clubRoutes.put("/meetings/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = await parseBody(c, meetingUpdateSchema);
  if (input.editionId) await requireEdition(c.env.DB, input.editionId);
  const meeting = await updateVersioned({
    db: c.env.DB,
    table: "club_meetings",
    id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Meeting",
    set: {
      title: input.title,
      starts_at: new Date(input.startsAt).toISOString(),
      ends_at: input.endsAt ? new Date(input.endsAt).toISOString() : null,
      location: input.location,
      details: input.details,
      edition_id: input.editionId,
    },
    load: () => loadMeeting(c.env.DB, id),
  });
  return c.json(meeting);
});

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

const ASSIGNMENT_SELECT = `SELECT a.id, a.due_date, a.reading_scope, a.details, a.archived_at, ${auditCols("a")}, ${editionCols("e", "e_")},
  m.id AS mt_id, m.title AS mt_title, m.starts_at AS mt_starts_at
  FROM club_assignments a JOIN book_editions e ON e.id = a.edition_id LEFT JOIN club_meetings m ON m.id = a.meeting_id ${auditJoins("a")}`;

function mapAssignment(r: Row): Assignment {
  return {
    id: String(r.id),
    edition: mapEdition(r, "e_"),
    meeting: r.mt_id ? { id: String(r.mt_id), title: String(r.mt_title), startsAt: String(r.mt_starts_at) } : null,
    dueDate: String(r.due_date),
    readingScope: (r.reading_scope as string | null) ?? null,
    details: (r.details as string | null) ?? null,
    archivedAt: (r.archived_at as string | null) ?? null,
    ...mapAudit(r),
  };
}

export async function loadAssignment(db: D1Database, id: string): Promise<Assignment | null> {
  const r = await first<Row>(db, `${ASSIGNMENT_SELECT} WHERE a.id = ?`, id);
  return r ? mapAssignment(r) : null;
}

export async function loadAssignments(db: D1Database, where: string, params: string[], order = "a.due_date", limit = 200): Promise<Assignment[]> {
  const rows = await all<Row>(db, `${ASSIGNMENT_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${limit}`, ...params);
  return rows.map(mapAssignment);
}

clubRoutes.get("/assignments", async (c) => {
  const when = c.req.query("when") ?? "current";
  const base = includeArchived(c.req.query("archived")) ? "1 = 1" : "a.archived_at IS NULL";
  const today = nowIso().slice(0, 10);
  if (when === "past") return c.json(await loadAssignments(c.env.DB, `${base} AND a.due_date < ?`, [today], "a.due_date DESC"));
  if (when === "all") return c.json(await loadAssignments(c.env.DB, base, [], "a.due_date DESC"));
  return c.json(await loadAssignments(c.env.DB, `${base} AND a.due_date >= ?`, [today]));
});

clubRoutes.post("/assignments", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, assignmentSchema);
  await requireEdition(c.env.DB, input.editionId);
  if (input.meetingId && !(await loadMeeting(c.env.DB, input.meetingId))) throw notFound("Meeting not found");
  const id = newId();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO club_assignments (id, edition_id, meeting_id, due_date, reading_scope, details, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.editionId,
    input.meetingId,
    input.dueDate,
    input.readingScope,
    input.details,
    user.id,
    user.id,
    now,
    now,
  );
  const assignment = await loadAssignment(c.env.DB, id);
  if (assignment) {
    const title = `New assignment: ${assignment.edition.title}`;
    const body = `${assignment.readingScope ? `${assignment.readingScope} — ` : ""}due ${assignment.dueDate}`;
    c.executionCtx.waitUntil(
      Promise.all([
        notifyUsers(c.env, "all", { kind: "club_assignment", title, body, link: "/club", actorId: user.id }),
        emailClubUpdate(c.env, user.id, title, [`${user.name} added a reading assignment: ${body}.`], "/club"),
      ]),
    );
  }
  return c.json(assignment, 201);
});

clubRoutes.put("/assignments/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = await parseBody(c, assignmentUpdateSchema);
  await requireEdition(c.env.DB, input.editionId);
  if (input.meetingId && !(await loadMeeting(c.env.DB, input.meetingId))) throw notFound("Meeting not found");
  const assignment = await updateVersioned({
    db: c.env.DB,
    table: "club_assignments",
    id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Assignment",
    set: {
      edition_id: input.editionId,
      meeting_id: input.meetingId,
      due_date: input.dueDate,
      reading_scope: input.readingScope,
      details: input.details,
    },
    load: () => loadAssignment(c.env.DB, id),
  });
  return c.json(assignment);
});

// ---------------------------------------------------------------------------
// Other shared group activities
// ---------------------------------------------------------------------------

const ACTIVITY_SELECT = `SELECT t.id, t.title, t.kind, t.details, t.starts_at, t.archived_at, ${auditCols("t")} FROM club_activities t ${auditJoins("t")}`;

function mapActivity(r: Row): ClubActivity {
  return {
    id: String(r.id),
    title: String(r.title),
    kind: r.kind as ClubActivity["kind"],
    details: (r.details as string | null) ?? null,
    startsAt: (r.starts_at as string | null) ?? null,
    archivedAt: (r.archived_at as string | null) ?? null,
    ...mapAudit(r),
  };
}

async function loadActivity(db: D1Database, id: string): Promise<ClubActivity | null> {
  const r = await first<Row>(db, `${ACTIVITY_SELECT} WHERE t.id = ?`, id);
  return r ? mapActivity(r) : null;
}

clubRoutes.get("/activities", async (c) => {
  const archived = includeArchived(c.req.query("archived"));
  const rows = await all<Row>(
    c.env.DB,
    `${ACTIVITY_SELECT} ${archived ? "" : "WHERE t.archived_at IS NULL"} ORDER BY t.archived_at IS NOT NULL, COALESCE(t.starts_at, t.created_at) DESC LIMIT 200`,
  );
  return c.json(rows.map(mapActivity));
});

clubRoutes.post("/activities", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, activitySchema);
  const id = newId();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO club_activities (id, title, kind, details, starts_at, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.title,
    input.kind,
    input.details,
    input.startsAt ? new Date(input.startsAt).toISOString() : null,
    user.id,
    user.id,
    now,
    now,
  );
  return c.json(await loadActivity(c.env.DB, id), 201);
});

clubRoutes.put("/activities/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = await parseBody(c, activityUpdateSchema);
  const activity = await updateVersioned({
    db: c.env.DB,
    table: "club_activities",
    id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Activity",
    set: {
      title: input.title,
      kind: input.kind,
      details: input.details,
      starts_at: input.startsAt ? new Date(input.startsAt).toISOString() : null,
    },
    load: () => loadActivity(c.env.DB, id),
  });
  return c.json(activity);
});

// Archive / restore for meetings, assignments and activities.
const archivable = {
  meetings: { table: "club_meetings", label: "Meeting", load: loadMeeting },
  assignments: { table: "club_assignments", label: "Assignment", load: loadAssignment },
  activities: { table: "club_activities", label: "Activity", load: loadActivity },
} as const;

for (const [path, cfg] of Object.entries(archivable)) {
  for (const action of ["archive", "restore"] as const) {
    clubRoutes.post(`/${path}/:id/${action}`, async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");
      const { expectedVersion } = await parseBody(c, versionSchema);
      const record = await updateVersioned<unknown>({
        db: c.env.DB,
        table: cfg.table,
        id,
        expectedVersion,
        userId: user.id,
        label: cfg.label,
        set: { archived_at: action === "archive" ? nowIso() : null },
        load: () => cfg.load(c.env.DB, id),
      });
      return c.json(record);
    });
  }
}
