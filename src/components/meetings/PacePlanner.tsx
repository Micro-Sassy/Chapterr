import { useQuery } from "@tanstack/react-query";
import { Gauge, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { PACE_CADENCES, type PaceCadence } from "@shared/constants";
import type { EditionSummary, PacePlan } from "@shared/types";
import { clubApi, useSharedMutation } from "@/components/records";
import { Alert, Badge, Button, Card, Checkbox, cx, Field, Input, ProgressBar, Select, Spinner } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api, ApiRequestError } from "@/lib/api";
import { formatDateKey, todayKey, WEEKDAY_LONG, WEEKDAY_SHORT } from "@/lib/calendar";
import { useClubTimezone, useMeetings } from "./api";
import { nextRow, paceSentence, previewPaceSchedule } from "./pace";

export const CADENCE_LABELS: Record<PaceCadence, string> = { weekly: "Once a week", twice_weekly: "Twice a week", daily: "Every day" };

export const paceKeys = { plan: (clubId: string, editionId: string) => ["pace-plan", clubId, editionId] as const };
export const paceInvalidations = (clubId: string): unknown[][] => [["pace-plan", clubId], ["assignments", clubId], ["calendar", clubId], ["club-dashboard", clubId], ["home"]];

/** The club's pace plan for an edition; `null` when none exists. */
export function usePacePlan(clubId: string, editionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: paceKeys.plan(clubId, editionId ?? ""),
    queryFn: async () => {
      try {
        return await api<PacePlan>(clubApi(clubId, `/pace-plans/${encodeURIComponent(editionId!)}`));
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: enabled && !!editionId,
    staleTime: 30_000,
  });
}

/** "Plan the pace": start, meeting (prefills the end), pages, cadence, rest days, with a preview. */
export function PacePlanDialog({ open, onClose, clubId, edition, existing }: { open: boolean; onClose: () => void; clubId: string; edition: EditionSummary; existing?: PacePlan | null }) {
  const tz = useClubTimezone();
  const meetings = useMeetings(clubId, "upcoming");
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? todayKey(tz));
  const [meetingId, setMeetingId] = useState(existing?.meetingId ?? "");
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? "");
  const [totalPages, setTotalPages] = useState(String(existing?.totalPages ?? edition.pageCount ?? ""));
  const [cadence, setCadence] = useState<PaceCadence>(existing?.cadence ?? "weekly");
  const [restDays, setRestDays] = useState<number[]>(existing?.restDays ?? []);
  const [createAssignments, setCreateAssignments] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const preview = previewPaceSchedule({ startsOn, endsOn, totalPages: Number(totalPages) || 0, cadence, restDays });
  const save = useSharedMutation(
    () => {
      const body = { editionId: edition.id, meetingId: meetingId || null, startsOn, endsOn: endsOn || null, totalPages: Number(totalPages) || null, cadence, restDays, createAssignments };
      return existing
        ? api<PacePlan>(clubApi(clubId, `/pace-plans/${encodeURIComponent(edition.id)}`), { method: "PUT", body: { ...body, expectedVersion: existing.version } })
        : api<PacePlan>(clubApi(clubId, "/pace-plans"), { body });
    },
    paceInvalidations(clubId),
    existing ? "Pace updated." : createAssignments ? "Pace planned and assignments created." : "Pace planned.",
  );
  const pickMeeting = (id: string) => {
    setMeetingId(id);
    const m = meetings.data?.find((x) => x.id === id);
    if (m) setEndsOn(m.startsAt.slice(0, 10));
  };
  return (
    <Dialog open={open} onClose={onClose} title={existing ? "Edit the pace" : "Plan the pace"} wide>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!startsOn || !endsOn) return setError("Choose a start and an end date.");
          if (endsOn <= startsOn) return setError("The end has to come after the start.");
          if (!(Number(totalPages) > 0)) return setError("How many pages is the book?");
          setError(null);
          save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <p className="text-sm text-ink-muted">
          Split <span className="book-title text-base text-ink">{edition.title}</span> into even chunks between two dates. Each chunk becomes an assignment with page ranges (and Kindle locations or audio times when the club has added mappings).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start reading">{(id) => <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />}</Field>
          <Field label="Finish by meeting (optional)" hint="Sets the end date.">
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={meetingId} onChange={(e) => pickMeeting(e.target.value)}>
                <option value="">Pick a date instead</option>
                {meetings.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} ({formatDateKey(m.startsAt.slice(0, 10))})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Finish by">{(id) => <Input id={id} type="date" min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} required />}</Field>
          <Field label="Total pages" hint={edition.pageCount ? `This edition lists ${edition.pageCount}.` : "The edition has no page count; enter one."}>
            {(id, d) => <Input id={id} aria-describedby={d} type="number" min={1} max={50000} value={totalPages} onChange={(e) => setTotalPages(e.target.value)} required />}
          </Field>
          <Field label="Cadence">
            {(id) => (
              <Select id={id} value={cadence} onChange={(e) => setCadence(e.target.value as PaceCadence)}>
                {PACE_CADENCES.map((c) => (
                  <option key={c} value={c}>
                    {CADENCE_LABELS[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {cadence === "daily" && (
          <div>
            <p className="mb-1.5 text-sm font-medium">Rest days</p>
            <div role="group" aria-label="Rest days" className="flex flex-wrap gap-1.5">
              {WEEKDAY_SHORT.map((label, day) => {
                const on = restDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    aria-label={WEEKDAY_LONG[day]}
                    onClick={() => setRestDays(on ? restDays.filter((d) => d !== day) : restDays.length < 6 ? [...restDays, day].sort() : restDays)}
                    className={cx("h-9 w-11 rounded-control border text-sm font-medium", on ? "border-primary bg-primary text-on-primary" : "border-line bg-surface hover:bg-surface-2")}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {!existing && <Checkbox label="Create a reading assignment for each chunk" checked={createAssignments} onChange={(e) => setCreateAssignments(e.target.checked)} />}
        {preview.length > 0 && (
          <div className="max-h-56 overflow-auto rounded-control border border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">Preview of the schedule</caption>
              <thead className="sticky top-0 bg-surface">
                <tr className="text-left">
                  <th scope="col" className="label px-3 py-2 text-ink-muted">
                    Due
                  </th>
                  <th scope="col" className="label px-3 py-2 text-ink-muted">
                    Pages
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.dueDate} className="border-t border-line/60">
                    <td className="px-3 py-1.5">{formatDateKey(r.dueDate, { weekday: "short", day: "numeric", month: "short" })}</td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {r.fromPage} to {r.toPage}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {preview.length > 0 && (
          <p className="text-xs text-ink-muted">
            {preview.length} {preview.length === 1 ? "chunk" : "chunks"}, about {Math.ceil((Number(totalPages) || 0) / preview.length)} pages each.
          </p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" loading={save.isPending}>
          {existing ? "Save pace" : createAssignments ? "Create assignments" : "Save pace"}
        </Button>
      </form>
    </Dialog>
  );
}

/** Opens the pace dialog for a book, editing the existing plan when there is one. */
export function PacePlanLauncher({ clubId, edition, onClose }: { clubId: string; edition: EditionSummary; onClose: () => void }) {
  const q = usePacePlan(clubId, edition.id);
  if (q.isPending) {
    return (
      <Dialog open onClose={onClose} title="Plan the pace">
        <Spinner />
      </Dialog>
    );
  }
  return <PacePlanDialog open onClose={onClose} clubId={clubId} edition={edition} existing={q.data ?? undefined} />;
}

/** The schedule and the viewer's own pace for a book with a plan; a prompt to plan one otherwise. */
export function PacePanel({ clubId, edition, compact = false }: { clubId: string; edition: EditionSummary; compact?: boolean }) {
  const q = usePacePlan(clubId, edition.id);
  const [planning, setPlanning] = useState(false);
  const remove = useSharedMutation(() => api(clubApi(clubId, `/pace-plans/${encodeURIComponent(edition.id)}`), { method: "DELETE" }), paceInvalidations(clubId), "Pace plan removed.");
  const today = todayKey();
  if (q.isPending) return <Spinner />;
  if (q.isError) return null;
  const plan = q.data;
  if (!plan) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-dashed border-line px-4 py-3 text-sm">
        <span className="text-ink-muted">No pace set for this book yet.</span>
        <Button size="sm" variant="secondary" icon={Gauge} onClick={() => setPlanning(true)}>
          Plan pace
        </Button>
        {planning && <PacePlanDialog open onClose={() => setPlanning(false)} clubId={clubId} edition={edition} />}
      </div>
    );
  }
  const next = nextRow(plan, today);
  const done = plan.schedule.filter((r) => r.dueDate < today).length;
  const personal = plan.personal;
  return (
    <Card className={compact ? "p-4 sm:p-4" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="heading-s flex items-center gap-2">
            <Gauge className="size-4 text-ink-muted" aria-hidden /> Pace for <span className="book-title">{edition.title}</span>
          </h3>
          <p className="text-sm text-ink-muted">
            {plan.totalPages} pages, {CADENCE_LABELS[plan.cadence].toLowerCase()}, {formatDateKey(plan.startsOn)} to {formatDateKey(plan.endsOn)}.
          </p>
        </div>
        {!compact && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setPlanning(true)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" icon={Trash2} loading={remove.isPending} onClick={() => remove.mutate(undefined)}>
              Remove
            </Button>
          </div>
        )}
      </div>
      <div className={cx("mt-3 rounded-control border px-3 py-2.5 text-sm", personal && !personal.onTrack && personal.pagesLeft > 0 ? "border-accent/50 bg-accent-soft" : "border-line bg-surface-2/50")}>
        <p className="font-medium">{paceSentence(personal)}</p>
        {personal && (
          <p className="mt-0.5 text-xs text-ink-muted">
            You are on page {personal.myPage} of {plan.totalPages}; {personal.pagesLeft} left over {personal.daysLeft} {personal.daysLeft === 1 ? "day" : "days"}.
            {next && ` Next: pages ${next.fromPage} to ${next.toPage} by ${formatDateKey(next.dueDate)}.`}
          </p>
        )}
        {personal && (
          <div className="mt-2">
            <ProgressBar value={personal.myPage} max={plan.totalPages} label={`Your progress in ${edition.title}`} />
          </div>
        )}
      </div>
      {!compact && (
        <ol className="mt-3 divide-y divide-line/60 text-sm" aria-label="Schedule">
          {plan.schedule.map((r, i) => {
            const past = r.dueDate < today;
            const isNext = next?.dueDate === r.dueDate;
            return (
              <li key={r.dueDate} className={cx("flex items-center gap-3 py-1.5", past && "text-ink-muted")}>
                <span className="w-6 text-right tabular-nums">{i + 1}.</span>
                <span className="w-32 shrink-0">{formatDateKey(r.dueDate)}</span>
                <span className="tabular-nums">
                  pages {r.fromPage} to {r.toPage}
                </span>
                {isNext && <Badge tone="brass">Next</Badge>}
                {past && i < done && <Badge tone="neutral">Past</Badge>}
              </li>
            );
          })}
        </ol>
      )}
      {planning && <PacePlanDialog open onClose={() => setPlanning(false)} clubId={clubId} edition={edition} existing={plan} />}
    </Card>
  );
}
