import type { ReadingLogEntry } from "@shared/types";
import { cx } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { buildStreakStrip } from "./streak";

const LEVEL_CLASS = ["bg-surface-2", "bg-accent/35", "bg-accent/70", "bg-accent"] as const;
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/** Twelve weeks of reading days as a heat strip (Monday at the top). */
export function StreakStrip({ entries, today, weeks = 12 }: { entries: Pick<ReadingLogEntry, "day" | "pages" | "minutes">[]; today: string; weeks?: number }) {
  const strip = buildStreakStrip(entries, today, weeks);
  return (
    <figure className="space-y-2">
      <div className="flex gap-1 overflow-x-auto pb-1" role="img" aria-label={`${strip.daysLogged} reading days in the last ${weeks} weeks`} data-testid="streak-strip">
        <div className="grid grid-rows-7 gap-1 pr-1 text-[10px] leading-none text-ink-muted" aria-hidden>
          {DAY_LABELS.map((d, i) => (
            <span key={i} className="flex size-3.5 items-center justify-center">
              {i % 2 === 0 ? d : ""}
            </span>
          ))}
        </div>
        {strip.weeks.map((week, wi) => (
          <div key={wi} className="grid grid-rows-7 gap-1">
            {week.map((cell) => (
              <span
                key={cell.day}
                title={cell.future ? undefined : `${formatDate(cell.day)}: ${cell.level === 0 ? "nothing logged" : `${cell.pages} pages, ${cell.minutes} min`}`}
                data-level={cell.level}
                data-day={cell.day}
                className={cx("size-3.5 rounded-[3px]", cell.future ? "border border-dashed border-line" : LEVEL_CLASS[cell.level], cell.isToday && "ring-2 ring-ink ring-offset-1 ring-offset-surface")}
              />
            ))}
          </div>
        ))}
      </div>
      <figcaption className="flex items-center gap-3 text-xs text-ink-muted">
        <span>
          {formatDate(strip.from, { month: "short", day: "numeric" })} to {formatDate(strip.to, { month: "short", day: "numeric" })}
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          Less
          {LEVEL_CLASS.map((c, i) => (
            <span key={i} className={cx("size-2.5 rounded-[2px]", c)} aria-hidden />
          ))}
          More
        </span>
      </figcaption>
    </figure>
  );
}
