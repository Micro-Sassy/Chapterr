import { Check, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { ClubReadingProgress } from "@shared/types";
import { Button, Checkbox, cx, Input } from "@/components/ui";
import { progressLabel } from "./gate";

export interface ProgressInput {
  chapter: number | null;
  page: number | null;
  percent: number | null;
  finished: boolean;
}

type Mode = "chapter" | "page" | "percent";
const MODES: { value: Mode; label: string }[] = [
  { value: "chapter", label: "Chapter" },
  { value: "page", label: "Page" },
  { value: "percent", label: "Percent" },
];

function initialMode(p: ClubReadingProgress | null | undefined): Mode {
  if (p?.chapter !== null && p?.chapter !== undefined) return "chapter";
  if (p?.page !== null && p?.page !== undefined) return "page";
  if (p?.percent !== null && p?.percent !== undefined) return "percent";
  return "chapter";
}

/**
 * Where the reader is in the club's book: chapter, page or percent, plus a
 * finished mark. Rooms open as this moves forward. "+1 chapter" is the quick path.
 */
export function ProgressControl({ progress, pageCount, onSave, saving }: { progress: ClubReadingProgress | null | undefined; pageCount?: number | null; onSave: (input: ProgressInput) => void; saving?: boolean }) {
  const [mode, setMode] = useState<Mode>(() => initialMode(progress));
  const [value, setValue] = useState<string>(() => String(progress?.[initialMode(progress)] ?? ""));
  const [finished, setFinished] = useState(!!progress?.finished);

  // Follow server updates (another device, or the quick button).
  useEffect(() => {
    const m = initialMode(progress);
    setMode(m);
    setValue(progress?.[m] === null || progress?.[m] === undefined ? "" : String(progress[m]));
    setFinished(!!progress?.finished);
  }, [progress]);

  const build = (over: Partial<ProgressInput> = {}): ProgressInput => {
    const n = value.trim() === "" ? null : Math.max(0, Math.floor(Number(value)));
    const base: ProgressInput = {
      chapter: progress?.chapter ?? null,
      page: progress?.page ?? null,
      percent: progress?.percent ?? null,
      finished,
    };
    if (n !== null && !Number.isNaN(n)) base[mode] = mode === "percent" ? Math.min(100, n) : n;
    return { ...base, ...over };
  };

  const plusChapter = () => {
    const next = (progress?.chapter ?? 0) + 1;
    onSave({ chapter: next, page: progress?.page ?? null, percent: progress?.percent ?? null, finished: false });
  };

  return (
    <form
      className="space-y-3"
      aria-label="Your progress"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(build());
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          You are at <span className="font-semibold">{progressLabel(progress)}</span>
        </p>
        <Button type="button" size="sm" variant="secondary" icon={Plus} onClick={plusChapter} disabled={saving || !!progress?.finished}>
          1 chapter
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div role="radiogroup" aria-label="Measure" className="flex rounded-control border border-line p-0.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => {
                setMode(m.value);
                const v = progress?.[m.value];
                setValue(v === null || v === undefined ? "" : String(v));
              }}
              className={cx("h-9 rounded-[9px] px-3 text-sm font-medium", mode === m.value ? "bg-primary text-on-primary" : "text-ink-muted hover:bg-surface-2")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <Input
          type="number"
          inputMode="numeric"
          aria-label={mode === "chapter" ? "Chapter number" : mode === "page" ? "Page number" : "Percent read"}
          min={0}
          max={mode === "percent" ? 100 : mode === "page" ? (pageCount ?? 50_000) : 10_000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-10 w-28"
          disabled={finished}
        />
        {mode === "page" && pageCount ? <span className="pb-2.5 text-sm text-ink-muted">of {pageCount}</span> : null}
        <Button type="submit" size="sm" icon={Check} loading={saving} disabled={!finished && value.trim() === "" && !progress}>
          Update
        </Button>
      </div>
      <Checkbox label="I have finished the book" checked={finished} onChange={(e) => setFinished(e.target.checked)} />
    </form>
  );
}
