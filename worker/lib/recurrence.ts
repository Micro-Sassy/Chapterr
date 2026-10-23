import { WAVE2_LIMITS } from "../../shared/constants";
import type { Recurrence } from "../../shared/types";

/**
 * Recurrence expansion for club meetings (docs/FEATURES-2.md §1).
 *
 * Occurrences are computed on the local wall clock of the club's IANA zone
 * and converted back to UTC instants one by one, so a 7 PM meeting stays at
 * 7 PM across daylight-saving changes. Everything uses Intl; no library.
 */

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True when the runtime knows this IANA zone. */
export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** Fall back to UTC for unknown zones so a bad setting never breaks a page. */
export function safeZone(zone: string | null | undefined, fallback = "UTC"): string {
  return isValidTimeZone(zone) ? zone : isValidTimeZone(fallback) ? fallback : "UTC";
}

/** Wall-clock parts of an instant in the given zone. */
export function zonedParts(date: Date, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Some engines print midnight as "24" with hourCycle h23 on older ICU builds.
  const hour = get("hour") % 24;
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute"), second: get("second") };
}

/** The zone's UTC offset (ms) at a given instant. */
function offsetAt(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/**
 * Convert local wall-clock parts in a zone to a UTC instant. Times that do
 * not exist (spring-forward gap) resolve to the instant after the gap; times
 * that happen twice (fall-back) resolve to the first (daylight) one.
 */
export function zonedToUtc(p: LocalParts, timeZone: string): Date {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset1 = offsetAt(new Date(guess), timeZone);
  let result = guess - offset1;
  const offset2 = offsetAt(new Date(result), timeZone);
  if (offset2 !== offset1) {
    result = guess - offset2;
    // Still not a round trip: the wall time falls in a gap; use the later offset.
    if (offsetAt(new Date(result), timeZone) !== offset2) result = guess - Math.min(offset1, offset2);
  }
  return new Date(result);
}

/** Local calendar date (YYYY-MM-DD) of an instant in a zone. */
export function localDateOf(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Calendar-day arithmetic on a UTC "date only" value (no zone involved). */
export function addDays(ymd: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day) + days * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 (Sunday) .. 6 (Saturday) of a calendar date. */
export function weekdayOf(ymd: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day)).getUTCDay();
}

const dateKey = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

type Ymd = { year: number; month: number; day: number };

/** Day of the month for the n-th (or last, n = -1) given weekday; null when the month has no such day. */
function nthWeekdayOfMonth(year: number, month: number, n: number, weekday: number): number | null {
  const dim = daysInMonth(year, month);
  if (n === -1) {
    for (let d = dim; d >= 1; d--) if (weekdayOf({ year, month, day: d }) === weekday) return d;
    return null;
  }
  const firstWeekday = weekdayOf({ year, month, day: 1 });
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  return day <= dim ? day : null;
}

function* weeklyDates(start: Ymd, interval: number, byDay: number[]): Generator<Ymd> {
  const days = byDay.length ? Array.from(new Set(byDay)).sort() : [weekdayOf(start)];
  // Week blocks start on the Sunday of the start date's week.
  const weekStart = addDays(start, -weekdayOf(start));
  const startKey = dateKey(start);
  for (let week = 0; week < 1000; week += interval) {
    const base = addDays(weekStart, week * 7);
    for (const wd of days) {
      const d = addDays(base, wd);
      if (dateKey(d) < startKey) continue;
      yield d;
    }
  }
}

function* monthlyDates(start: Ymd, interval: number, rule: Recurrence): Generator<Ymd> {
  const startKey = dateKey(start);
  for (let i = 0; i < 1000; i++) {
    const total = start.month - 1 + i * interval;
    const year = start.year + Math.floor(total / 12);
    const month = (total % 12) + 1;
    let day: number | null;
    if (rule.nthWeekday) day = nthWeekdayOfMonth(year, month, rule.nthWeekday.n, rule.nthWeekday.day);
    else day = Math.min(rule.byMonthDay ?? start.day, daysInMonth(year, month));
    if (day === null) continue;
    const d = { year, month, day };
    if (dateKey(d) < startKey) continue;
    yield d;
  }
}

function isMonthlyStyle(rule: Recurrence): boolean {
  if (rule.freq === "monthly") return true;
  return rule.freq === "custom" && !rule.byDay?.length && (!!rule.byMonthDay || !!rule.nthWeekday);
}

/**
 * Expand a recurrence into UTC ISO instants, starting with `startsAt` itself
 * (always the first occurrence). Honours `count`, `until` (local date,
 * inclusive) and `limit` (hard cap, default 52).
 */
export function expandOccurrences(startsAt: string, rule: Recurrence, timezone: string, limit: number = WAVE2_LIMITS.recurrenceOccurrencesMax): string[] {
  const zone = safeZone(timezone);
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return [];
  const local = zonedParts(start, zone);
  const max = Math.max(1, Math.min(limit, rule.count ?? limit, WAVE2_LIMITS.recurrenceOccurrencesMax));
  const interval = Math.max(1, rule.freq === "biweekly" ? 2 * (rule.interval ?? 1) : (rule.interval ?? 1));
  const dates = isMonthlyStyle(rule) ? monthlyDates(local, interval, rule) : weeklyDates(local, interval, rule.byDay ?? []);
  const out: string[] = [];
  for (const d of dates) {
    if (rule.until && dateKey(d) > rule.until) break;
    const instant = zonedToUtc({ ...d, hour: local.hour, minute: local.minute, second: local.second }, zone);
    out.push(instant.toISOString());
    if (out.length >= max) break;
  }
  // The first occurrence is the meeting as entered, whatever the weekday filter says.
  if (out.length === 0 || out[0] !== start.toISOString()) {
    const rest = out.filter((iso) => iso > start.toISOString());
    return [start.toISOString(), ...rest].slice(0, max);
  }
  return out;
}

const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** RFC 5545 RRULE text for a recurrence, e.g. `FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=10`. */
export function recurrenceToRRule(rule: Recurrence, opts: { count?: number | null; untilUtc?: string | null } = {}): string {
  const parts: string[] = [];
  const interval = rule.freq === "biweekly" ? 2 * (rule.interval ?? 1) : (rule.interval ?? 1);
  if (isMonthlyStyle(rule)) {
    parts.push("FREQ=MONTHLY");
    if (rule.nthWeekday) parts.push(`BYDAY=${rule.nthWeekday.n}${RRULE_DAYS[rule.nthWeekday.day]}`);
    else if (rule.byMonthDay) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  } else {
    parts.push("FREQ=WEEKLY");
    if (rule.byDay?.length) parts.push(`BYDAY=${Array.from(new Set(rule.byDay)).sort().map((d) => RRULE_DAYS[d]).join(",")}`);
  }
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  const count = opts.count ?? rule.count ?? null;
  if (count) parts.push(`COUNT=${count}`);
  else if (opts.untilUtc) parts.push(`UNTIL=${opts.untilUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`);
  else if (rule.until) parts.push(`UNTIL=${rule.until.replace(/-/g, "")}T235959Z`);
  return parts.join(";");
}

/** Parse the JSON stored in club_meetings.recurrence. */
export function parseRecurrence(value: unknown): Recurrence | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && typeof (parsed as Recurrence).freq === "string") return parsed as Recurrence;
  } catch {
    // ignore
  }
  return null;
}
