import { safeZone, zonedParts } from "./recurrence";

/**
 * Minimal RFC 5545 writer for club calendars (docs/FEATURES-2.md §1).
 * Events carry DTSTART;TZID=<club zone> so clients render the local wall
 * clock; all-day events (assignment due dates) use VALUE=DATE.
 */

export interface IcsEvent {
  /** Stable id; `<meetingId>@chapterr.io`. */
  uid: string;
  /** UTC ISO instant (or YYYY-MM-DD when allDay). */
  start: string;
  end?: string | null;
  allDay?: boolean;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** RFC 5545 RRULE value (without the "RRULE:" prefix). */
  rrule?: string | null;
  /** Last modification instant (UTC ISO). */
  updatedAt?: string | null;
  createdAt?: string | null;
  status?: "CONFIRMED" | "CANCELLED" | "TENTATIVE";
}

export interface IcsCalendar {
  name: string;
  timezone: string;
  description?: string | null;
  events: IcsEvent[];
}

/** Escape TEXT values: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold a content line at 75 octets (RFC 5545 §3.1), continuation lines start with a space. */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (currentBytes + size > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 20261105T190000 in the given zone (floating local time for use with TZID). */
export function formatLocalStamp(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  return `${p.year}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;
}

/** 20261105T010000Z */
export function formatUtcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function dateValue(ymdOrIso: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymdOrIso)) return ymdOrIso.replace(/-/g, "");
  const p = zonedParts(new Date(ymdOrIso), timeZone);
  return `${p.year}${pad(p.month)}${pad(p.day)}`;
}

function addOneDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildIcs(cal: IcsCalendar): string {
  const zone = safeZone(cal.timezone);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Chapterr//Club calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(cal.name)}`,
    `X-WR-TIMEZONE:${zone}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  if (cal.description) lines.push(`X-WR-CALDESC:${escapeIcsText(cal.description)}`);
  const stamp = formatUtcStamp(new Date().toISOString());
  for (const ev of cal.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.allDay) {
      const start = dateValue(ev.start, zone);
      lines.push(`DTSTART;VALUE=DATE:${start}`);
      lines.push(`DTEND;VALUE=DATE:${ev.end ? dateValue(ev.end, zone) : addOneDay(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`).replace(/-/g, "")}`);
    } else {
      lines.push(`DTSTART;TZID=${zone}:${formatLocalStamp(ev.start, zone)}`);
      const end = ev.end ?? new Date(new Date(ev.start).getTime() + 2 * 3600_000).toISOString();
      lines.push(`DTEND;TZID=${zone}:${formatLocalStamp(end, zone)}`);
    }
    if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
    lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push(`STATUS:${ev.status ?? "CONFIRMED"}`);
    if (ev.createdAt) lines.push(`CREATED:${formatUtcStamp(ev.createdAt)}`);
    if (ev.updatedAt) lines.push(`LAST-MODIFIED:${formatUtcStamp(ev.updatedAt)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
