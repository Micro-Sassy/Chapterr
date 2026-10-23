import type { Streak } from "../../shared/types";
import { all, first, run } from "./db";
import { localToday, nowIso } from "./util";

/**
 * Reading log and streaks. A day counts when the member logged pages or
 * minutes (> 0). Days are calendar dates in the member's own zone
 * (profiles.timezone when set, else the browser's `?today=` hint, else UTC).
 */

const DAY_MS = 86_400_000;

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Today's calendar date in an IANA zone (UTC when the zone is unknown). */
export function todayInZone(timeZone: string | null | undefined, now = new Date()): string {
  if (!timeZone) return now.toISOString().slice(0, 10);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = `${get("year")}-${get("month")}-${get("day")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : now.toISOString().slice(0, 10);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** The member's "today": profile zone first, then the client's hint, then UTC. */
export async function memberToday(db: D1Database, userId: string, hint?: string | null): Promise<string> {
  const row = await first<{ timezone: string | null }>(db, "SELECT timezone FROM profiles WHERE user_id = ?", userId);
  if (row?.timezone) return todayInZone(row.timezone);
  return localToday(hint);
}

/**
 * Streak maths over a set of active days (YYYY-MM-DD, any order). The current
 * streak must reach today or yesterday (a day in progress does not break it).
 */
export function computeStreak(activeDays: Iterable<string>, today: string): Streak {
  const days = Array.from(new Set(activeDays)).sort();
  let longest = 0;
  let runLen = 0;
  let prev: string | null = null;
  for (const d of days) {
    runLen = prev && addDays(prev, 1) === d ? runLen + 1 : 1;
    if (runLen > longest) longest = runLen;
    prev = d;
  }
  const set = new Set(days);
  const lastDay = days.length ? days[days.length - 1]! : null;
  let current = 0;
  const anchor = set.has(today) ? today : set.has(addDays(today, -1)) ? addDays(today, -1) : null;
  if (anchor) {
    let d = anchor;
    while (set.has(d)) {
      current++;
      d = addDays(d, -1);
    }
  }
  return { current, longest, today: set.has(today), lastDay };
}

/** Longest run of consecutive active days inside [from, to]. */
export function longestStreakWithin(activeDays: Iterable<string>, from: string, to: string): number {
  const days = Array.from(activeDays).filter((d) => d >= from && d <= to);
  return computeStreak(days, to).longest;
}

export async function activeDays(db: D1Database, userId: string, from?: string | null, to?: string | null): Promise<string[]> {
  const rows = await all<{ day: string }>(
    db,
    `SELECT day FROM reading_log WHERE user_id = ? AND (pages > 0 OR minutes > 0)
       AND (? IS NULL OR day >= ?) AND (? IS NULL OR day <= ?) ORDER BY day`,
    userId,
    from ?? null,
    from ?? null,
    to ?? null,
    to ?? null,
  );
  return rows.map((r) => r.day);
}

export async function loadStreak(db: D1Database, userId: string, today: string): Promise<Streak> {
  return computeStreak(await activeDays(db, userId), today);
}

/**
 * Record reading activity for today without replacing what the member typed:
 * pages are added to the day's total and the edition is remembered. Called
 * when progress is marked in the library or a club book. `pagesDelta` of null
 * or <= 0 (percent-only updates, "finished" without a page count) still marks
 * the day active by adding one page.
 *
 * Signature for other streams: `logReadingToday(db, userId, editionId, pagesDelta, todayHint?)`.
 */
export async function logReadingToday(
  db: D1Database,
  userId: string,
  editionId: string | null,
  pagesDelta: number | null,
  todayHint?: string | null,
): Promise<{ day: string; pages: number }> {
  const day = await memberToday(db, userId, todayHint);
  const add = pagesDelta !== null && Number.isFinite(pagesDelta) && pagesDelta > 0 ? Math.min(Math.round(pagesDelta), 5000) : 1;
  const now = nowIso();
  await run(
    db,
    `INSERT INTO reading_log (user_id, day, edition_id, pages, minutes, note, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT (user_id, day) DO UPDATE SET pages = MIN(reading_log.pages + excluded.pages, 5000),
       edition_id = COALESCE(excluded.edition_id, reading_log.edition_id), updated_at = excluded.updated_at`,
    userId,
    day,
    editionId,
    add,
    now,
    now,
  );
  const row = await first<{ pages: number }>(db, "SELECT pages FROM reading_log WHERE user_id = ? AND day = ?", userId, day);
  return { day, pages: Number(row?.pages ?? add) };
}
