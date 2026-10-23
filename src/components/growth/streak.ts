import type { ReadingLogEntry } from "@shared/types";

export interface StreakCell {
  day: string;
  pages: number;
  minutes: number;
  /** 0 none, 1 light, 2 steady, 3 strong. */
  level: 0 | 1 | 2 | 3;
  isToday: boolean;
  /** Days after today render as placeholders. */
  future: boolean;
}

export interface StreakStrip {
  /** Weeks, oldest first, each 7 days starting Monday. */
  weeks: StreakCell[][];
  from: string;
  to: string;
  daysLogged: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

export function levelFor(pages: number, minutes: number): StreakCell["level"] {
  if (pages <= 0 && minutes <= 0) return 0;
  if (pages >= 60 || minutes >= 60) return 3;
  if (pages >= 20 || minutes >= 20) return 2;
  return 1;
}

/**
 * Lay the last `weeks` weeks (ending with the current week, Monday to Sunday) out as
 * a heat strip. Entries outside the window are ignored.
 */
export function buildStreakStrip(entries: Pick<ReadingLogEntry, "day" | "pages" | "minutes">[], today: string, weeks = 12): StreakStrip {
  const byDay = new Map(entries.map((e) => [e.day, e]));
  const todayDate = new Date(`${today}T12:00:00`);
  // Monday = 0 … Sunday = 6
  const weekday = (todayDate.getDay() + 6) % 7;
  const endOfWeek = addDays(today, 6 - weekday);
  const start = addDays(endOfWeek, -(weeks * 7 - 1));
  const out: StreakCell[][] = [];
  let day = start;
  let daysLogged = 0;
  for (let w = 0; w < weeks; w++) {
    const week: StreakCell[] = [];
    for (let i = 0; i < 7; i++) {
      const e = byDay.get(day);
      const pages = e?.pages ?? 0;
      const minutes = e?.minutes ?? 0;
      const level = levelFor(pages, minutes);
      if (level > 0 && day <= today) daysLogged++;
      week.push({ day, pages, minutes, level, isToday: day === today, future: day > today });
      day = addDays(day, 1);
    }
    out.push(week);
  }
  return { weeks: out, from: start, to: endOfWeek, daysLogged };
}

/** Current run of consecutive logged days ending today or yesterday (the server is the source of truth; this is for optimistic display). */
export function currentStreak(entries: Pick<ReadingLogEntry, "day" | "pages" | "minutes">[], today: string): number {
  const logged = new Set(entries.filter((e) => e.pages > 0 || e.minutes > 0).map((e) => e.day));
  let day = logged.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (logged.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/** Copy for the home streak chip. */
export function streakChipText(streak: { current: number; today: boolean }): string {
  if (streak.current === 0) return "Start a streak: log today";
  const days = `${streak.current}-day streak`;
  return streak.today ? `${days}, logged today` : `${days}, log today`;
}
