import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { POLL_KINDS, type PollKind } from "@shared/constants";
import type { EditionSummary, Poll } from "@shared/types";
import { BookPicker, BookRow } from "@/components/books";
import { useMeetings } from "@/components/meetings/api";
import { clubApi, useSharedMutation } from "@/components/records";
import { Alert, Button, Checkbox, Field, IconButton, Input, Select, Textarea } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api } from "@/lib/api";
import { formatZonedDate, zonedToIso } from "@/lib/calendar";
import { POLL_KIND_LABELS, pollInvalidations } from "./api";

interface DraftOption {
  key: number;
  label: string;
  edition: EditionSummary | null;
  startsAt: string;
  endsAt: string;
}

let seq = 0;
const blank = (): DraftOption => ({ key: ++seq, label: "", edition: null, startsAt: "", endsAt: "" });

/** Create a book, date or custom poll. */
export function PollForm({ clubId, tz, defaultKind = "custom", defaultYear, onDone }: { clubId: string; tz: string; defaultKind?: PollKind; defaultYear?: number; onDone: (poll: Poll) => void }) {
  const [kind, setKind] = useState<PollKind>(defaultKind);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<DraftOption[]>([blank(), blank()]);
  const [allowMultiple, setAllowMultiple] = useState(kind === "date");
  const [anonymous, setAnonymous] = useState(false);
  const [allowMemberOptions, setAllowMemberOptions] = useState(true);
  const [closesAt, setClosesAt] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [year, setYear] = useState(String(defaultYear ?? new Date().getFullYear()));
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meetings = useMeetings(clubId, "upcoming");

  const create = useSharedMutation(
    () =>
      api<Poll>(clubApi(clubId, "/polls"), {
        body: {
          kind,
          title: title.trim(),
          description: description.trim() || null,
          options: options
            .filter((o) => (kind === "book" ? o.edition : kind === "date" ? o.startsAt : o.label.trim()))
            .map((o) => ({
              label: kind === "book" ? o.edition!.title : kind === "date" ? formatZonedDate(zonedToIso(o.startsAt, tz)!, tz) : o.label.trim(),
              editionId: o.edition?.id ?? null,
              startsAt: kind === "date" ? zonedToIso(o.startsAt, tz) : null,
              endsAt: kind === "date" && o.endsAt ? zonedToIso(o.endsAt, tz) : null,
            })),
          allowMultiple,
          anonymous,
          allowMemberOptions,
          closesAt: closesAt ? zonedToIso(closesAt, tz) : null,
          year: kind === "book" ? Number(year) || null : null,
          meetingId: kind === "date" && meetingId ? meetingId : null,
        },
      }),
    pollInvalidations(clubId),
    "Poll opened.",
  );

  const changeKind = (k: PollKind) => {
    setKind(k);
    setOptions([blank(), blank()]);
    setAllowMultiple(k === "date");
    if (!title.trim()) setTitle(k === "book" ? "What should we read next?" : k === "date" ? "When should we meet?" : "");
  };
  const update = (key: number, patch: Partial<DraftOption>) => setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  const remove = (key: number) => setOptions((prev) => (prev.length > 2 ? prev.filter((o) => o.key !== key) : prev));
  const filled = options.filter((o) => (kind === "book" ? o.edition : kind === "date" ? o.startsAt : o.label.trim()));

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return setError("Give the poll a title.");
        if (filled.length < 2) return setError("Add at least two options.");
        setError(null);
        create.mutate(undefined, { onSuccess: (p) => onDone(p as Poll) });
      }}
    >
      <Field label="What kind of poll">
        {(id) => (
          <Select id={id} value={kind} onChange={(e) => changeKind(e.target.value as PollKind)}>
            {POLL_KINDS.map((k) => (
              <option key={k} value={k}>
                {POLL_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "book" ? "What should we read next?" : kind === "date" ? "When should we meet?" : "Ask the club"} />}</Field>
      <Field label="Description (optional)">{(id) => <Textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Options</legend>
        {kind === "book" && (
          <>
            <ul className="space-y-2">
              {options
                .filter((o) => o.edition)
                .map((o) => (
                  <li key={o.key} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <BookRow edition={o.edition!} link={false} />
                    </div>
                    <IconButton icon={Trash2} label={`Remove ${o.edition!.title}`} onClick={() => setOptions((prev) => prev.filter((x) => x.key !== o.key))} />
                  </li>
                ))}
            </ul>
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setPicking(true)}>
              Add book
            </Button>
            <Dialog open={picking} onClose={() => setPicking(false)} title="Add a book to the poll" wide>
              <BookPicker
                pickLabel="Add"
                onPick={(e) => {
                  setOptions((prev) => (prev.some((o) => o.edition?.id === e.id) ? prev : [...prev.filter((o) => o.edition), { ...blank(), edition: e, label: e.title }]));
                }}
              />
            </Dialog>
          </>
        )}
        {kind === "date" &&
          options.map((o, i) => (
            <div key={o.key} className="flex flex-wrap items-end gap-2">
              <Field label={`Slot ${i + 1} starts`} className="min-w-52 flex-1">
                {(id) => <Input id={id} type="datetime-local" value={o.startsAt} onChange={(e) => update(o.key, { startsAt: e.target.value })} />}
              </Field>
              <Field label="Ends (optional)" className="min-w-52 flex-1">
                {(id) => <Input id={id} type="datetime-local" min={o.startsAt || undefined} value={o.endsAt} onChange={(e) => update(o.key, { endsAt: e.target.value })} />}
              </Field>
              <IconButton icon={Trash2} label={`Remove slot ${i + 1}`} onClick={() => remove(o.key)} disabled={options.length <= 2} />
            </div>
          ))}
        {kind === "custom" &&
          options.map((o, i) => (
            <div key={o.key} className="flex items-end gap-2">
              <Field label={`Option ${i + 1}`} className="flex-1">
                {(id) => <Input id={id} value={o.label} onChange={(e) => update(o.key, { label: e.target.value })} />}
              </Field>
              <IconButton icon={Trash2} label={`Remove option ${i + 1}`} onClick={() => remove(o.key)} disabled={options.length <= 2} />
            </div>
          ))}
        {kind !== "book" && (
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setOptions((prev) => [...prev, blank()])} disabled={options.length >= 20}>
            Add option
          </Button>
        )}
        <p className="text-xs text-ink-muted">Times are read in {tz.replace(/_/g, " ")}.</p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Closes (optional)" hint="Voting ends then; results are final.">
          {(id, d) => <Input id={id} aria-describedby={d} type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />}
        </Field>
        {kind === "book" && <Field label="Reading list year">{(id) => <Input id={id} type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />}</Field>}
        {kind === "date" && (
          <Field label="Meeting to schedule (optional)" hint="The winning slot updates this meeting; otherwise a new one is created.">
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
                <option value="">A new meeting</option>
                {meetings.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} ({formatZonedDate(m.startsAt, m.timezone ?? tz)})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      <div className="space-y-1.5">
        <Checkbox label="Members may choose several options" checked={allowMultiple} onChange={(e) => setAllowMultiple(e.target.checked)} />
        <Checkbox label="Anonymous (names are never shown)" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        <Checkbox label="Members may add options while the poll is open" checked={allowMemberOptions} onChange={(e) => setAllowMemberOptions(e.target.checked)} />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={create.isPending}>
        Open poll
      </Button>
    </form>
  );
}
