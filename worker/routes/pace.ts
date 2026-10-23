import { Hono } from "hono";
import type { PaceCadence } from "../../shared/constants";
import { pacePlanSchema, pacePlanUpdateSchema } from "../../shared/schemas";
import type { PacePlan, PaceScheduleRow } from "../../shared/types";
import type { AppEnv } from "../env";
import { first, run } from "../lib/db";
import { ApiError, notFound } from "../lib/errors";
import { parseBody, validationError } from "../lib/http";
import { editionCols, mapEdition, type Row } from "../lib/mappers";
import { addDays, localDateOf, safeZone, weekdayOf } from "../lib/recurrence";
import { newId, nowIso } from "../lib/util";
import { updateVersioned } from "../lib/versioned";
import { z } from "zod";

/**
 * Pace planner (docs/FEATURES-2.md §7): split a book evenly across due dates
 * and create the matching assignments. Mounted at /api/clubs/:clubId/pace-plans
 * from the meetings router. One plan per club per edition.
 */
export const paceRoutes = new Hono<AppEnv>();

const DAY_MS = 86_400_000;

type Ymd = { year: number; month: number; day: number };
const parseYmd = (s: string): Ymd => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)), day: Number(s.slice(8, 10)) });
const fmtYmd = (d: Ymd) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Due dates between the start (exclusive) and the end (inclusive) at the cadence, skipping rest days. */
export function paceDueDates(startsOn: string, endsOn: string, cadence: PaceCadence, restDays: number[]): string[] {
  const rest = new Set(restDays);
  const start = parseYmd(startsOn);
  const total = daysBetween(startsOn, endsOn);
  if (total <= 0) return [endsOn];
  const dates: string[] = [];
  let offset = 0;
  let step = 0;
  for (let guard = 0; guard < 2000; guard++) {
    offset += cadence === "daily" ? 1 : cadence === "weekly" ? 7 : step++ % 2 === 0 ? 3 : 4;
    if (offset >= total) break;
    // Slide forward past rest days; the final date is always the end date.
    let d = addDays(start, offset);
    let moved = 0;
    while (rest.has(weekdayOf(d)) && rest.size < 7 && moved < 7) {
      d = addDays(d, 1);
      moved++;
    }
    const key = fmtYmd(d);
    if (key >= endsOn) break;
    if (dates[dates.length - 1] !== key) dates.push(key);
  }
  dates.push(endsOn);
  return dates;
}

/** Split `totalPages` evenly over the due dates (earlier slots take the remainder). */
export function paceSchedule(startsOn: string, endsOn: string, totalPages: number, cadence: PaceCadence, restDays: number[]): PaceScheduleRow[] {
  const dates = paceDueDates(startsOn, endsOn, cadence, restDays);
  const n = dates.length;
  const base = Math.floor(totalPages / n);
  const remainder = totalPages - base * n;
  const rows: PaceScheduleRow[] = [];
  let page = 1;
  dates.forEach((dueDate, i) => {
    const count = base + (i < remainder ? 1 : 0);
    if (count <= 0) return;
    rows.push({ dueDate, fromPage: page, toPage: page + count - 1, assignmentId: null });
    page += count;
  });
  return rows;
}

const PLAN_SELECT = `SELECT p.id, p.club_id, p.meeting_id, p.starts_on, p.ends_on, p.total_pages, p.cadence, p.rest_days, p.schedule, p.version, p.created_at, p.updated_at,
  ${editionCols("e", "e_")} FROM pace_plans p JOIN book_editions e ON e.id = p.edition_id`;

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function loadPlan(db: D1Database, clubId: string, editionId: string, viewerId: string | null): Promise<PacePlan | null> {
  const r = await first<Row>(db, `${PLAN_SELECT} WHERE p.club_id = ? AND p.edition_id = ?`, clubId, editionId);
  if (!r) return null;
  const schedule = parseJson<PaceScheduleRow[]>(r.schedule, []);
  const totalPages = Number(r.total_pages);
  const plan: PacePlan = {
    id: String(r.id),
    clubId: String(r.club_id),
    edition: mapEdition(r, "e_"),
    meetingId: (r.meeting_id as string | null) ?? null,
    startsOn: String(r.starts_on),
    endsOn: String(r.ends_on),
    totalPages,
    cadence: r.cadence as PaceCadence,
    restDays: parseJson<number[]>(r.rest_days, []),
    schedule,
    personal: null,
    version: Number(r.version),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
  if (viewerId) {
    const [progress, club] = await Promise.all([
      first<{ page: number | null; percent: number | null; finished: number }>(
        db,
        "SELECT page, percent, finished FROM club_reading_progress WHERE club_id = ? AND edition_id = ? AND user_id = ?",
        clubId,
        editionId,
        viewerId,
      ),
      first<{ timezone: string }>(db, "SELECT timezone FROM clubs WHERE id = ?", clubId),
    ]);
    const myPage = progress
      ? progress.finished
        ? totalPages
        : progress.page !== null
          ? Math.min(totalPages, Number(progress.page))
          : progress.percent !== null
            ? Math.round((Number(progress.percent) / 100) * totalPages)
            : 0
      : 0;
    const today = localDateOf(new Date(), safeZone(club?.timezone, "America/Chicago"));
    const daysLeft = Math.max(0, daysBetween(today, plan.endsOn));
    const pagesLeft = Math.max(0, totalPages - myPage);
    const expected = schedule.filter((s) => s.dueDate <= today).reduce((max, s) => Math.max(max, s.toPage), 0);
    plan.personal = {
      myPage,
      pagesLeft,
      daysLeft,
      pagesPerDay: pagesLeft === 0 ? 0 : Math.ceil(pagesLeft / Math.max(1, daysLeft)),
      onTrack: myPage >= expected,
    };
  }
  return plan;
}

interface Resolved {
  totalPages: number;
  endsOn: string;
  meetingId: string | null;
}

async function resolveInputs(
  db: D1Database,
  clubId: string,
  editionId: string,
  input: { meetingId: string | null; startsOn: string; endsOn: string | null; totalPages: number | null },
): Promise<Resolved> {
  const edition = await first<{ page_count: number | null }>(db, "SELECT page_count FROM book_editions WHERE id = ?", editionId);
  if (!edition) throw notFound("Book edition not found");
  const issues: z.core.$ZodIssue[] = [];
  let endsOn = input.endsOn;
  if (input.meetingId) {
    const meeting = await first<{ starts_at: string; timezone: string | null; club_tz: string }>(
      db,
      "SELECT m.starts_at, m.timezone, c.timezone AS club_tz FROM club_meetings m JOIN clubs c ON c.id = m.club_id WHERE m.id = ? AND m.club_id = ?",
      input.meetingId,
      clubId,
    );
    if (!meeting) throw notFound("Meeting not found");
    endsOn ??= localDateOf(new Date(meeting.starts_at), safeZone(meeting.timezone, meeting.club_tz));
  }
  const totalPages = input.totalPages ?? (edition.page_count ? Number(edition.page_count) : null);
  if (!totalPages) issues.push({ code: "custom", path: ["totalPages"], message: "This edition has no page count; enter the total pages", input: input.totalPages });
  if (!endsOn) issues.push({ code: "custom", path: ["endsOn"], message: "Choose an end date or a meeting", input: input.endsOn });
  else if (endsOn <= input.startsOn) issues.push({ code: "custom", path: ["endsOn"], message: "End must be after the start", input: endsOn });
  if (issues.length) throw validationError(new z.ZodError(issues));
  return { totalPages: totalPages!, endsOn: endsOn!, meetingId: input.meetingId };
}

/** Create one assignment per schedule row and return the rows with their ids filled in. */
async function createAssignments(
  db: D1Database,
  clubId: string,
  editionId: string,
  planId: string,
  meetingId: string | null,
  schedule: PaceScheduleRow[],
  userId: string,
): Promise<PaceScheduleRow[]> {
  const now = nowIso();
  const withIds = schedule.map((row) => ({ ...row, assignmentId: newId() }));
  const stmts = withIds.map((row) =>
    db
      .prepare(
        `INSERT INTO club_assignments (id, club_id, edition_id, meeting_id, due_date, reading_scope, details, from_page, to_page, pace_plan_id, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.assignmentId, clubId, editionId, meetingId, row.dueDate, `Pages ${row.fromPage}-${row.toPage}`, null, row.fromPage, row.toPage, planId, userId, userId, now, now),
  );
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return withIds;
}

paceRoutes.post("/", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const input = await parseBody(c, pacePlanSchema);
  const existing = await loadPlan(c.env.DB, clubId, input.editionId, user.id);
  if (existing) throw new ApiError(409, "duplicate", "This club already has a pace plan for that book", { current: existing });
  const resolved = await resolveInputs(c.env.DB, clubId, input.editionId, input);
  let schedule = paceSchedule(input.startsOn, resolved.endsOn, resolved.totalPages, input.cadence, input.restDays);
  const id = newId();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO pace_plans (id, club_id, edition_id, meeting_id, starts_on, ends_on, total_pages, cadence, rest_days, schedule, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    clubId,
    input.editionId,
    resolved.meetingId,
    input.startsOn,
    resolved.endsOn,
    resolved.totalPages,
    input.cadence,
    JSON.stringify(input.restDays),
    JSON.stringify(schedule),
    user.id,
    user.id,
    now,
    now,
  );
  if (input.createAssignments) {
    schedule = await createAssignments(c.env.DB, clubId, input.editionId, id, resolved.meetingId, schedule, user.id);
    await run(c.env.DB, "UPDATE pace_plans SET schedule = ? WHERE id = ?", JSON.stringify(schedule), id);
  }
  return c.json(await loadPlan(c.env.DB, clubId, input.editionId, user.id), 201);
});

paceRoutes.get("/:editionId", async (c) => {
  const plan = await loadPlan(c.env.DB, c.get("club").id, c.req.param("editionId"), c.get("user").id);
  if (!plan) throw notFound("No pace plan for this book");
  return c.json(plan);
});

paceRoutes.put("/:editionId", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const editionId = c.req.param("editionId");
  const input = await parseBody(c, pacePlanUpdateSchema);
  const before = await loadPlan(c.env.DB, clubId, editionId, user.id);
  if (!before) throw notFound("No pace plan for this book");
  const resolved = await resolveInputs(c.env.DB, clubId, editionId, input);
  let schedule = paceSchedule(input.startsOn, resolved.endsOn, resolved.totalPages, input.cadence, input.restDays);
  await updateVersioned({
    db: c.env.DB,
    table: "pace_plans",
    id: before.id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Pace plan",
    set: {
      meeting_id: resolved.meetingId,
      starts_on: input.startsOn,
      ends_on: resolved.endsOn,
      total_pages: resolved.totalPages,
      cadence: input.cadence,
      rest_days: JSON.stringify(input.restDays),
      schedule: JSON.stringify(schedule),
    },
    where: { club_id: clubId },
    load: () => loadPlan(c.env.DB, clubId, editionId, user.id),
  });
  // Assignments from the previous schedule are retired, never silently rewritten.
  await run(c.env.DB, "UPDATE club_assignments SET archived_at = ?, updated_by = ?, updated_at = ? WHERE club_id = ? AND pace_plan_id = ? AND archived_at IS NULL", nowIso(), user.id, nowIso(), clubId, before.id);
  if (input.createAssignments) {
    schedule = await createAssignments(c.env.DB, clubId, editionId, before.id, resolved.meetingId, schedule, user.id);
    await run(c.env.DB, "UPDATE pace_plans SET schedule = ? WHERE id = ?", JSON.stringify(schedule), before.id);
  }
  return c.json(await loadPlan(c.env.DB, clubId, editionId, user.id));
});

paceRoutes.delete("/:editionId", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const editionId = c.req.param("editionId");
  const plan = await loadPlan(c.env.DB, clubId, editionId, null);
  if (!plan) throw notFound("No pace plan for this book");
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE club_assignments SET archived_at = ?, updated_by = ?, updated_at = ? WHERE club_id = ? AND pace_plan_id = ? AND archived_at IS NULL").bind(now, user.id, now, clubId, plan.id),
    c.env.DB.prepare("DELETE FROM pace_plans WHERE id = ? AND club_id = ?").bind(plan.id, clubId),
  ]);
  return c.json({ ok: true });
});

