import type { PaceCadence } from "@shared/constants";
import type { PacePlan, PaceScheduleRow } from "@shared/types";
import { todayKey } from "@/lib/calendar";

const DAY = 86_400_000;
const key = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Client-side preview of a pace plan: the due dates the cadence yields between
 * the start and end, with pages split evenly. The server computes the real one.
 */
export function previewPaceSchedule(input: { startsOn: string; endsOn: string; totalPages: number; cadence: PaceCadence; restDays: number[] }): PaceScheduleRow[] {
  const start = Date.parse(`${input.startsOn}T00:00:00Z`);
  const end = Date.parse(`${input.endsOn}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start || input.totalPages < 1) return [];
  const rest = new Set(input.restDays);
  const dates: string[] = [];
  if (input.cadence === "daily") {
    for (let t = start + DAY; t <= end; t += DAY) {
      const d = new Date(t);
      if (!rest.has(d.getUTCDay())) dates.push(key(d));
    }
    if (dates.length === 0 || dates[dates.length - 1] !== key(new Date(end))) dates.push(key(new Date(end)));
  } else {
    const step = input.cadence === "weekly" ? 7 : 3.5;
    for (let i = 1; ; i++) {
      const t = start + Math.round(i * step) * DAY;
      if (t >= end) break;
      dates.push(key(new Date(t)));
    }
    dates.push(key(new Date(end)));
  }
  const unique = Array.from(new Set(dates));
  const n = unique.length;
  return unique.map((dueDate, i) => ({
    dueDate,
    fromPage: Math.round((input.totalPages * i) / n) + 1,
    toPage: i === n - 1 ? input.totalPages : Math.round((input.totalPages * (i + 1)) / n),
    assignmentId: null,
  }));
}

/** The schedule rows due in the next seven days (today included). */
export function rowsThisWeek(plan: Pick<PacePlan, "schedule">, today = todayKey()): PaceScheduleRow[] {
  const t0 = Date.parse(`${today}T00:00:00Z`);
  return plan.schedule.filter((r) => {
    const t = Date.parse(`${r.dueDate}T00:00:00Z`);
    return t >= t0 && t < t0 + 7 * DAY;
  });
}

/** The row whose due date is next (or the last one, once the plan has ended). */
export function nextRow(plan: Pick<PacePlan, "schedule">, today = todayKey()): PaceScheduleRow | null {
  return plan.schedule.find((r) => r.dueDate >= today) ?? plan.schedule[plan.schedule.length - 1] ?? null;
}

/** One warm sentence about the viewer's pace. */
export function paceSentence(personal: PacePlan["personal"]): string {
  if (!personal) return "Mark your progress on the book to see your own pace.";
  if (personal.pagesLeft <= 0) return "You have finished the book. Nothing left to pace.";
  if (personal.daysLeft <= 0) return `${personal.pagesLeft} pages to go and the plan has ended. Read when you can.`;
  const perDay = Math.max(1, Math.ceil(personal.pagesPerDay));
  if (personal.onTrack) return `${perDay} ${perDay === 1 ? "page" : "pages"} a day keeps you on track.`;
  return `You are behind the plan. ${perDay} pages a day catches you up by the end.`;
}
