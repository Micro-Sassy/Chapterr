import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { CalendarItem, CalendarYear } from "@shared/types";
import { Button, cx, IconButton } from "@/components/ui";
import { formatDateKey, formatZonedTime, itemDateKey, monthGrid, monthKeyOf, monthLabel, shiftMonth, todayKey, WEEKDAY_LONG, WEEKDAY_SHORT, weekdayOrder, type MonthKey } from "@/lib/calendar";

/** Colour tokens per item kind: meetings in Forest, due dates in Brass, polls in slate. */
export const CALENDAR_KIND_LABEL: Record<CalendarItem["kind"], string> = { meeting: "Meeting", assignment: "Due", poll: "Poll closes" };
const chipTone: Record<CalendarItem["kind"], string> = {
  meeting: "border-primary bg-primary text-on-primary hover:bg-primary-hover",
  assignment: "border-accent/50 bg-accent-soft text-ink hover:border-accent",
  poll: "border-info/40 bg-info-soft text-ink hover:border-info",
};
const dotTone: Record<CalendarItem["kind"], string> = { meeting: "bg-primary", assignment: "bg-accent", poll: "bg-info" };

export function groupByDay(items: CalendarItem[], timezone: string): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  for (const item of [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const k = itemDateKey(item, timezone);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function CalendarChip({ item, timezone, compact = false }: { item: CalendarItem; timezone: string; compact?: boolean }) {
  const time = item.allDay ? null : formatZonedTime(item.startsAt, timezone);
  return (
    <Link
      to={item.link}
      className={cx("block truncate rounded-chip border px-1.5 py-0.5 text-xs font-semibold leading-5", chipTone[item.kind])}
      title={`${CALENDAR_KIND_LABEL[item.kind]}: ${item.title}${time ? ` at ${time}` : ""}`}
    >
      {!compact && time && <span className="mr-1 font-normal opacity-80">{time}</span>}
      <span className={item.edition ? "book-title font-medium" : undefined}>{item.title}</span>
    </Link>
  );
}

export function MonthNav({ month, onChange, children }: { month: MonthKey; onChange: (m: MonthKey) => void; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Previous month" onClick={() => onChange(shiftMonth(month, -1))} />
        <h2 className="heading-s min-w-44 text-center" aria-live="polite">
          {monthLabel(month)}
        </h2>
        <IconButton icon={ChevronRight} label="Next month" onClick={() => onChange(shiftMonth(month, 1))} />
        <Button size="sm" variant="ghost" onClick={() => onChange(monthKeyOf(todayKey()))}>
          Today
        </Button>
      </div>
      {children}
    </div>
  );
}

/**
 * A month as a real table (weekday headers, one cell per day) on larger screens
 * and a list stacked by day on phones. Items render as linked chips.
 */
export function CalendarGrid({
  month,
  items,
  timezone,
  today = todayKey(timezone),
  weekStartsOn = 0,
  onDayClick,
  emptyText = "Nothing on the calendar this month.",
}: {
  month: MonthKey;
  items: CalendarItem[];
  timezone: string;
  today?: string;
  weekStartsOn?: number;
  onDayClick?: (date: string) => void;
  emptyText?: string;
}) {
  const weeks = monthGrid(month, today, weekStartsOn);
  const byDay = groupByDay(items, timezone);
  const order = weekdayOrder(weekStartsOn);
  const label = monthLabel(month);
  const monthDays = weeks.flat().filter((d) => d.inMonth && byDay.has(d.date));
  return (
    <div>
      <table className="hidden w-full table-fixed border-collapse md:table" aria-label={`${label} calendar`}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {order.map((d) => (
              <th key={d} scope="col" abbr={WEEKDAY_LONG[d]} className="label border-b border-line pb-2 text-left text-ink-muted">
                {WEEKDAY_SHORT[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i} className="align-top">
              {week.map((day) => {
                const dayItems = byDay.get(day.date) ?? [];
                return (
                  <td key={day.date} className={cx("h-28 border-b border-r border-line p-1.5 first:border-l", !day.inMonth && "bg-surface-2/40 text-ink-muted")}>
                    <div className="flex items-start justify-between">
                      {onDayClick ? (
                        <button
                          type="button"
                          onClick={() => onDayClick(day.date)}
                          aria-label={formatDateKey(day.date, { weekday: "long", day: "numeric", month: "long" })}
                          aria-current={day.today ? "date" : undefined}
                          className={cx("inline-flex size-7 items-center justify-center rounded-full text-sm tabular-nums hover:bg-surface-2", day.today && "bg-primary font-semibold text-on-primary hover:bg-primary-hover")}
                        >
                          {day.day}
                        </button>
                      ) : (
                        <time
                          dateTime={day.date}
                          aria-current={day.today ? "date" : undefined}
                          aria-label={formatDateKey(day.date, { weekday: "long", day: "numeric", month: "long" })}
                          className={cx("inline-flex size-7 items-center justify-center rounded-full text-sm tabular-nums", day.today && "bg-primary font-semibold text-on-primary")}
                        >
                          {day.day}
                        </time>
                      )}
                    </div>
                    {dayItems.length > 0 && (
                      <ul className="mt-1 space-y-1">
                        {dayItems.slice(0, 3).map((item) => (
                          <li key={`${item.kind}-${item.id}`}>
                            <CalendarChip item={item} timezone={timezone} />
                          </li>
                        ))}
                        {dayItems.length > 3 && <li className="px-1 text-xs text-ink-muted">{dayItems.length - 3} more</li>}
                      </ul>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <ol className="space-y-3 md:hidden" aria-label={`${label} list`}>
        {monthDays.length === 0 && <li className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">{emptyText}</li>}
        {monthDays.map((day) => (
          <li key={day.date} className="flex gap-3">
            <time dateTime={day.date} className={cx("flex w-12 shrink-0 flex-col items-center rounded-control border border-line py-1.5 text-center", day.today && "border-primary bg-primary text-on-primary")}>
              <span className="label">{WEEKDAY_SHORT[day.weekday]}</span>
              <span className="text-lg font-semibold tabular-nums">{day.day}</span>
            </time>
            <ul className="min-w-0 flex-1 space-y-1.5">
              {(byDay.get(day.date) ?? []).map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <CalendarChip item={item} timezone={timezone} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Twelve small months with a dot per item kind and counts; clicking a month opens it. */
export function YearGrid({ year, months, timezone, onPickMonth, today = todayKey(timezone) }: { year: number; months: CalendarYear["months"]; timezone: string; onPickMonth: (month: MonthKey) => void; today?: string }) {
  const byMonth = new Map(months.map((m) => [m.month, m]));
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={`${year} overview`}>
      {Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).map((month) => {
        const data = byMonth.get(month);
        const days = groupByDay(data?.items ?? [], timezone);
        const counts = data?.counts ?? { meetings: 0, assignments: 0, polls: 0 };
        const total = counts.meetings + counts.assignments + counts.polls;
        return (
          <li key={month}>
            <button type="button" onClick={() => onPickMonth(month)} className="w-full rounded-card border border-line bg-surface p-3 text-left hover:bg-surface-2" aria-label={`${monthLabel(month)}: ${total} ${total === 1 ? "item" : "items"}`}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-semibold">{monthLabel(month, { month: "long" })}</span>
                <span className="text-xs text-ink-muted">
                  {counts.meetings ? `${counts.meetings} ${counts.meetings === 1 ? "meeting" : "meetings"}` : ""}
                  {counts.assignments ? `${counts.meetings ? " · " : ""}${counts.assignments} due` : ""}
                  {counts.polls ? `${counts.meetings || counts.assignments ? " · " : ""}${counts.polls} ${counts.polls === 1 ? "poll" : "polls"}` : ""}
                </span>
              </div>
              <div className="grid grid-cols-7 gap-px text-center text-[10px] leading-4 text-ink-muted" aria-hidden>
                {weekdayOrder(0).map((d) => (
                  <span key={d}>{WEEKDAY_SHORT[d]?.charAt(0)}</span>
                ))}
                {monthGrid(month, today).flat().map((day) => {
                  const kinds = new Set((days.get(day.date) ?? []).map((it) => it.kind));
                  return (
                    <span key={day.date} className={cx("flex flex-col items-center", !day.inMonth && "opacity-0")}>
                      <span className={cx("inline-flex size-4 items-center justify-center rounded-full tabular-nums", day.today && "bg-primary font-semibold text-on-primary")}>{day.day}</span>
                      <span className="flex h-1 gap-px">
                        {Array.from(kinds).map((k) => (
                          <span key={k} className={cx("size-1 rounded-full", dotTone[k])} />
                        ))}
                      </span>
                    </span>
                  );
                })}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function CalendarLegend() {
  return (
    <ul className="flex flex-wrap gap-3 text-xs text-ink-muted" aria-label="Legend">
      {(Object.keys(CALENDAR_KIND_LABEL) as CalendarItem["kind"][]).map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className={cx("size-2.5 rounded-full", dotTone[k])} aria-hidden /> {CALENDAR_KIND_LABEL[k]}
        </li>
      ))}
    </ul>
  );
}
