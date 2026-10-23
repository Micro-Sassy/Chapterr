import type { Recurrence } from "@shared/types";
import { cx, Field, Input, Select } from "@/components/ui";
import { dateKeyInZone, describeRecurrence, expandRecurrence, formatZonedDate, formatZonedTime, nthWeekdayFor, RECURRENCE_MAX, WEEKDAY_LONG, WEEKDAY_SHORT, zonedToIso } from "@/lib/calendar";

type RepeatChoice = "none" | Recurrence["freq"];
type EndChoice = "never" | "until" | "count";

export const DEFAULT_RECURRENCE = (freq: Recurrence["freq"], startKey: string): Recurrence => {
  const weekday = new Date(`${startKey}T00:00:00Z`).getUTCDay();
  if (freq === "monthly") return { freq, nthWeekday: nthWeekdayFor(startKey), until: null, count: 6 };
  return { freq, interval: freq === "custom" ? 3 : undefined, byDay: [weekday], until: null, count: freq === "weekly" ? 12 : 6 };
};

/**
 * Weekly / every two weeks / monthly (nth weekday or day of month) / every N
 * weeks, ending on a date or after a count, with a preview of the first dates.
 */
export function RecurrenceBuilder({ value, onChange, startsAtLocal, timezone }: { value: Recurrence | null; onChange: (r: Recurrence | null) => void; startsAtLocal: string; timezone: string }) {
  const startIso = startsAtLocal ? zonedToIso(startsAtLocal, timezone) : null;
  const startKey = startIso ? dateKeyInZone(startIso, timezone) : null;
  const repeat: RepeatChoice = value?.freq ?? "none";
  const ending: EndChoice = value?.until ? "until" : value?.count ? "count" : "never";
  const preview = startIso && value ? expandRecurrence(startIso, value, timezone, RECURRENCE_MAX) : [];
  const update = (patch: Partial<Recurrence>) => value && onChange({ ...value, ...patch });

  return (
    <fieldset className="space-y-3 rounded-control border border-line p-4">
      <legend className="px-1 text-sm font-medium">Repeats</legend>
      <Select
        aria-label="Repeats"
        value={repeat}
        onChange={(e) => {
          const v = e.target.value as RepeatChoice;
          if (v === "none") return onChange(null);
          onChange(DEFAULT_RECURRENCE(v, startKey ?? new Date().toISOString().slice(0, 10)));
        }}
      >
        <option value="none">Does not repeat</option>
        <option value="weekly">Every week</option>
        <option value="biweekly">Every two weeks</option>
        <option value="monthly">Every month</option>
        <option value="custom">Every few weeks</option>
      </Select>
      {value && !startsAtLocal && <p className="text-xs text-ink-muted">Set the start time first and the preview will follow.</p>}

      {value && value.freq !== "monthly" && (
        <div className="space-y-3">
          {value.freq === "custom" && (
            <Field label="Every how many weeks" className="max-w-40">
              {(id) => <Input id={id} type="number" min={1} max={12} value={value.interval ?? 1} onChange={(e) => update({ interval: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} />}
            </Field>
          )}
          <div role="group" aria-label="On which days" className="flex flex-wrap gap-1.5">
            {WEEKDAY_SHORT.map((label, day) => {
              const on = (value.byDay ?? []).includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  aria-label={WEEKDAY_LONG[day]}
                  onClick={() => {
                    const set = new Set(value.byDay ?? []);
                    if (on) set.delete(day);
                    else set.add(day);
                    update({ byDay: set.size ? Array.from(set).sort() : value.byDay });
                  }}
                  className={cx("h-9 w-11 rounded-control border text-sm font-medium", on ? "border-primary bg-primary text-on-primary" : "border-line bg-surface hover:bg-surface-2")}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {value && value.freq === "monthly" && startKey && (
        <div role="radiogroup" aria-label="Monthly pattern" className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="monthly-pattern" checked={!!value.nthWeekday} onChange={() => update({ nthWeekday: nthWeekdayFor(startKey), byMonthDay: undefined })} />
            On the {describeNth(nthWeekdayFor(startKey))}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="monthly-pattern" checked={!value.nthWeekday} onChange={() => update({ nthWeekday: undefined, byMonthDay: new Date(`${startKey}T00:00:00Z`).getUTCDate() })} />
            On day {new Date(`${startKey}T00:00:00Z`).getUTCDate()} of the month
          </label>
          <Field label="Every how many months" className="max-w-40">
            {(id) => <Input id={id} type="number" min={1} max={12} value={value.interval ?? 1} onChange={(e) => update({ interval: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} />}
          </Field>
        </div>
      )}

      {value && (
        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <Field label="Ends">
            {(id) => (
              <Select
                id={id}
                value={ending}
                onChange={(e) => {
                  const v = e.target.value as EndChoice;
                  if (v === "never") update({ until: null, count: null });
                  if (v === "until") update({ count: null, until: startKey ?? null });
                  if (v === "count") update({ until: null, count: 6 });
                }}
              >
                <option value="never">After {RECURRENCE_MAX} meetings</option>
                <option value="until">On a date</option>
                <option value="count">After a number of meetings</option>
              </Select>
            )}
          </Field>
          {ending === "until" && <Field label="Last date">{(id) => <Input id={id} type="date" min={startKey ?? undefined} value={value.until ?? ""} onChange={(e) => update({ until: e.target.value || null })} />}</Field>}
          {ending === "count" && <Field label="Number of meetings">{(id) => <Input id={id} type="number" min={1} max={RECURRENCE_MAX} value={value.count ?? 1} onChange={(e) => update({ count: Math.max(1, Math.min(RECURRENCE_MAX, Number(e.target.value) || 1)) })} />}</Field>}
        </div>
      )}

      {value && startIso && (
        <div className="rounded-control bg-surface-2/60 p-3 text-sm">
          <p className="font-medium">{describeRecurrence(value, startIso, timezone)}</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-ink-muted" aria-label="First dates">
            {preview.slice(0, 5).map((iso) => (
              <li key={iso}>
                {formatZonedDate(iso, timezone)}, {formatZonedTime(iso, timezone)}
              </li>
            ))}
          </ol>
          <p className="mt-1.5 text-xs text-ink-muted">{preview.length >= RECURRENCE_MAX ? `The first ${RECURRENCE_MAX} meetings are created.` : `${preview.length} ${preview.length === 1 ? "meeting" : "meetings"} in all.`}</p>
        </div>
      )}
    </fieldset>
  );
}

function describeNth(n: { n: number; day: number }) {
  const ord = n.n === -1 ? "last" : ["first", "second", "third", "fourth", "fifth"][n.n - 1];
  return `${ord} ${WEEKDAY_LONG[n.day]}`;
}

