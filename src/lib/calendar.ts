import type { Recurrence } from "@shared/types";

/**
 * Calendar helpers for meetings, polls and the club calendar: wall-clock math in
 * an IANA time zone (through Intl, no library), the month grid, and a client-side
 * preview of recurrence rules. The server owns the real expansion.
 */

export const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** A zone the runtime accepts, else the browser's. */
export function safeZone(tz: string | null | undefined): string {
  if (!tz) return browserZone();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return browserZone();
  }
}

/** Every zone the runtime knows, with a short fallback for older engines. */
export function zoneOptions(...pinned: (string | null | undefined)[]): string[] {
  let all: string[];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  if (all.length === 0) {
    all = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Toronto", "America/Vancouver", "America/Mexico_City", "America/Sao_Paulo", "Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam", "Europe/Stockholm", "Europe/Athens", "Africa/Johannesburg", "Africa/Lagos", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney", "Australia/Perth", "Pacific/Auckland", "UTC"];
  }
  const set = new Set<string>();
  for (const p of pinned) if (p) set.add(p);
  for (const z of all) set.add(z);
  return Array.from(set);
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    partsCache.set(tz, f);
  }
  return f;
}

/** The wall-clock reading of an instant in a zone. */
export function zonedParts(date: Date, tz: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(safeZone(tz)).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAY_INDEX[out.weekday ?? "Sun"] ?? 0,
  };
}

/** Minutes the zone is ahead of UTC at that instant (Chicago in winter: -360). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DDTHH:mm" wall clock in a zone → ISO instant (null when unparsable). */
export function zonedToIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00"] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (Number.isNaN(guess)) return null;
  const zone = safeZone(tz);
  const first = tzOffsetMinutes(new Date(guess), zone);
  let result = guess - first * 60_000;
  const second = tzOffsetMinutes(new Date(result), zone);
  if (second !== first) result = guess - second * 60_000;
  return new Date(result).toISOString();
}

/** ISO instant → the "YYYY-MM-DDTHH:mm" a datetime-local input shows for that zone. */
export function isoToZonedInput(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = zonedParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The calendar date ("YYYY-MM-DD") an instant falls on in a zone. */
export function dateKeyInZone(iso: string, tz: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const p = zonedParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Date key for a calendar item: all-day items keep their stored date, timed ones follow the zone. */
export function itemDateKey(item: { startsAt: string; allDay: boolean }, tz: string): string {
  if (item.allDay) return item.startsAt.slice(0, 10);
  return dateKeyInZone(item.startsAt, tz);
}

export function todayKey(tz?: string): string {
  return dateKeyInZone(new Date().toISOString(), tz ?? browserZone());
}

export function formatInZone(iso: string | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: safeZone(tz) }).format(d);
}

/** Short zone name at that instant, e.g. "CST" or "GMT+2". */
export function zoneAbbr(iso: string, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: safeZone(tz), timeZoneName: "short" }).formatToParts(new Date(iso));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export function formatZonedDate(iso: string, tz: string): string {
  return formatInZone(iso, tz, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function formatZonedTime(iso: string, tz: string): string {
  return formatInZone(iso, tz, { hour: "numeric", minute: "2-digit" });
}

/** "Sat 14 Mar 2030, 7:00 to 9:00 PM CST" (the end is dropped when absent). */
export function formatMeetingWhen(startsAt: string, endsAt: string | null | undefined, tz: string): string {
  const date = formatZonedDate(startsAt, tz);
  const start = formatZonedTime(startsAt, tz);
  const abbr = zoneAbbr(startsAt, tz);
  if (!endsAt) return `${date}, ${start} ${abbr}`.trim();
  const sameDay = dateKeyInZone(startsAt, tz) === dateKeyInZone(endsAt, tz);
  const end = sameDay ? formatZonedTime(endsAt, tz) : `${formatZonedDate(endsAt, tz)}, ${formatZonedTime(endsAt, tz)}`;
  return `${date}, ${start} to ${end} ${abbr}`.trim();
}

/** The same instant in the viewer's zone, when it differs from the meeting zone. */
export function viewerTimeNote(iso: string, tz: string): string | null {
  const mine = browserZone();
  if (safeZone(tz) === mine) return null;
  if (tzOffsetMinutes(new Date(iso), tz) === tzOffsetMinutes(new Date(iso), mine)) return null;
  return `${formatInZone(iso, mine, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} ${zoneAbbr(iso, mine)} where you are`;
}

/** Whole days until an instant (negative when passed), counted in the zone. */
export function daysUntil(iso: string, tz: string, now = new Date()): number {
  const a = dateKeyInZone(now.toISOString(), tz);
  const b = dateKeyInZone(iso, tz);
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// --- Months -----------------------------------------------------------------------------

export type MonthKey = string; // "YYYY-MM"

export function monthKeyOf(dateKey: string): MonthKey {
  return dateKey.slice(0, 7);
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function monthLabel(month: MonthKey, opts: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" }): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export interface GridDay {
  /** "YYYY-MM-DD" */
  date: string;
  day: number;
  inMonth: boolean;
  today: boolean;
  /** 0 = Sunday */
  weekday: number;
}

/** Weeks of a month (Sunday first by default), padded with the neighbouring months' days. */
export function monthGrid(month: MonthKey, today: string = todayKey(), weekStartsOn = 0): GridDay[][] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1, 1));
  const lead = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const total = daysInMonth(y!, m!);
  const cells = Math.ceil((lead + total) / 7) * 7;
  const weeks: GridDay[][] = [];
  for (let i = 0; i < cells; i++) {
    const d = new Date(Date.UTC(y!, m! - 1, 1 - lead + i));
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const cell: GridDay = { date, day: d.getUTCDate(), inMonth: d.getUTCMonth() === m! - 1, today: date === today, weekday: d.getUTCDay() };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1]!.push(cell);
  }
  return weeks;
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function weekdayOrder(weekStartsOn = 0): number[] {
  return Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);
}

export function formatDateKey(dateKey: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(new Date(`${dateKey}T12:00:00Z`));
}

// --- Recurrence preview ---------------------------------------------------------------------

export const RECURRENCE_MAX = 52;

/** nth weekday (n 1-5, or -1 for the last) of a month, as a UTC "wall clock" date; null when the month has no such day. */
function nthWeekdayOfMonth(year: number, month0: number, n: number, weekday: number): Date | null {
  if (n === -1) {
    const last = new Date(Date.UTC(year, month0 + 1, 0));
    const back = (last.getUTCDay() - weekday + 7) % 7;
    return new Date(Date.UTC(year, month0, last.getUTCDate() - back));
  }
  const first = new Date(Date.UTC(year, month0, 1));
  const forward = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + forward + (n - 1) * 7;
  if (day > daysInMonth(year, month0 + 1)) return null;
  return new Date(Date.UTC(year, month0, day));
}

/** The rule's natural "nth weekday" for a start date: 2nd Tuesday, last Friday… */
export function nthWeekdayFor(dateKey: string): { n: 1 | 2 | 3 | 4 | 5 | -1; day: number } {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const n = Math.ceil(d.getUTCDate() / 7) as 1 | 2 | 3 | 4 | 5;
  const isLast = d.getUTCDate() + 7 > daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
  return { n: n === 5 || (isLast && n >= 4) ? -1 : n, day: d.getUTCDay() };
}

/**
 * Expand a recurrence rule from its first occurrence, keeping the wall-clock
 * time in the zone across daylight-saving changes. Returns ISO instants
 * including the first. Mirrors the server's expansion closely enough to preview.
 */
export function expandRecurrence(startsAt: string, rule: Recurrence | null | undefined, tz: string, limit = RECURRENCE_MAX): string[] {
  if (!rule) return [startsAt];
  const zone = safeZone(tz);
  const p = zonedParts(new Date(startsAt), zone);
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const max = Math.max(1, Math.min(limit, rule.count ?? RECURRENCE_MAX, RECURRENCE_MAX));
  const until = rule.until ? Date.parse(`${rule.until}T00:00:00Z`) : null;
  const interval = Math.max(1, rule.interval ?? (rule.freq === "biweekly" ? 2 : 1));
  const dates: Date[] = [];
  const accept = (d: Date) => {
    if (d.getTime() < base.getTime()) return true;
    if (until !== null && d.getTime() > until) return false;
    dates.push(d);
    return dates.length < max;
  };

  if (rule.freq === "monthly") {
    const nth = rule.nthWeekday;
    const dayOfMonth = rule.byMonthDay ?? p.day;
    for (let k = 0; k < 12 * 20 && dates.length < max; k++) {
      const y = p.year + Math.floor((p.month - 1 + k * interval) / 12);
      const m0 = (p.month - 1 + k * interval) % 12;
      const d = nth ? nthWeekdayOfMonth(y, m0, nth.n, nth.day) : new Date(Date.UTC(y, m0, Math.min(dayOfMonth, daysInMonth(y, m0 + 1))));
      if (!d) continue;
      if (!accept(d)) break;
    }
  } else {
    const weeks = rule.freq === "weekly" ? 1 : rule.freq === "biweekly" ? 2 : interval;
    const byDay = rule.byDay && rule.byDay.length > 0 ? Array.from(new Set(rule.byDay)).sort((a, b) => a - b) : [base.getUTCDay()];
    const weekStart = new Date(base.getTime() - base.getUTCDay() * 86_400_000);
    outer: for (let w = 0; w < 52 * 20; w++) {
      for (const day of byDay) {
        const d = new Date(weekStart.getTime() + (w * weeks * 7 + day) * 86_400_000);
        if (!accept(d)) break outer;
      }
    }
  }

  const out: string[] = [];
  for (const d of dates) {
    const local = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(p.hour)}:${pad(p.minute)}`;
    const iso = zonedToIso(local, zone);
    if (iso) out.push(iso);
  }
  return out.length ? out : [startsAt];
}

const ordinal = (n: number) => (n === -1 ? "last" : ["first", "second", "third", "fourth", "fifth"][n - 1] ?? `${n}th`);

/** A sentence for a rule: "Every two weeks on Tuesday, until 12 Dec 2026". */
export function describeRecurrence(rule: Recurrence | null | undefined, startsAt: string, tz: string): string {
  if (!rule) return "Does not repeat";
  const start = dateKeyInZone(startsAt, tz);
  const startDay = new Date(`${start}T00:00:00Z`).getUTCDay();
  const days = (rule.byDay && rule.byDay.length ? Array.from(new Set(rule.byDay)).sort((a, b) => a - b) : [startDay]).map((d) => WEEKDAY_LONG[d]).join(", ");
  let head: string;
  switch (rule.freq) {
    case "weekly":
      head = `Every week on ${days}`;
      break;
    case "biweekly":
      head = `Every two weeks on ${days}`;
      break;
    case "monthly": {
      const nth = rule.nthWeekday;
      head = nth ? `Monthly on the ${ordinal(nth.n)} ${WEEKDAY_LONG[nth.day]}` : `Monthly on day ${rule.byMonthDay ?? new Date(`${start}T00:00:00Z`).getUTCDate()}`;
      if ((rule.interval ?? 1) > 1) head = head.replace("Monthly", `Every ${rule.interval} months`);
      break;
    }
    default:
      head = `Every ${rule.interval ?? 1} weeks on ${days}`;
  }
  const tail = rule.until ? `, until ${formatDateKey(rule.until, { day: "numeric", month: "short", year: "numeric" })}` : rule.count ? `, ${rule.count} times` : "";
  return head + tail;
}
