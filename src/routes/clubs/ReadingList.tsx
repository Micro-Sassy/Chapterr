import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, ClipboardList, Pencil, Plus, Share2, Tags, Target } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { CLUB_BOOK_STATUSES, type ClubBookStatus } from "@shared/constants";
import type { Assignment, ClubAnnualBook, ClubGoal, EditionSummary, Meeting } from "@shared/types";
import { BookPicker, BookRow } from "@/components/books";
import { ShareDialog } from "@/components/content";
import { AuditLine, clubApi, useSharedMutation } from "@/components/records";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, IconButton, Input, LinkButton, PageHeader, ProgressBar, SectionTitle, Select, Spinner, Textarea, type BadgeTone } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api } from "@/lib/api";
import { clubPath, useClub } from "@/lib/club";
import { formatDate, todayIso } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

const statusLabels: Record<ClubBookStatus, string> = { planned: "Planned", current: "Reading now", completed: "Finished" };
const statusTone = (s: ClubBookStatus): BadgeTone => (s === "completed" ? "success" : s === "current" ? "brass" : "neutral");

function GoalEditor({ clubId, year, goal, completed }: { clubId: string; year: number; goal: ClubGoal | null; completed: number }) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(String(goal?.target ?? 12));
  const save = useSharedMutation(
    () => api(clubApi(clubId, "/goal"), { method: "PUT", body: { year, target: Number(target), expectedVersion: goal?.version } }),
    [["club-goal", clubId], ["club-dashboard", clubId], ["home"]],
    "Club goal saved.",
  );
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="heading-s flex items-center gap-2">
          <Target className="size-4 text-ink-muted" aria-hidden /> {year} club goal
        </h2>
        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>
          {goal ? "Edit" : "Set goal"}
        </Button>
      </div>
      {goal ? (
        <>
          <p className="mt-2 font-display text-4xl font-medium">
            {completed}
            <span className="text-lg text-ink-muted"> of {goal.target} books read together</span>
          </p>
          <div className="mt-4">
            <ProgressBar value={completed} max={goal.target} label="Club goal progress" />
          </div>
          <p className="mt-2">
            <AuditLine item={goal} />
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">
          No goal yet for {year}. Finished books on the list: {completed}.
        </p>
      )}
      <Dialog open={editing} onClose={() => setEditing(false)} title={`${year} club goal`}>
        <div className="space-y-4">
          <Field label="Number of books">{(id) => <Input id={id} type="number" min={1} max={1000} value={target} onChange={(e) => setTarget(e.target.value)} />}</Field>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => setEditing(false) })}>
            Save goal
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}

function AnnualList({ clubId, year }: { clubId: string; year: number }) {
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState<ClubAnnualBook | null>(null);
  const q = useQuery({
    queryKey: ["club-books", clubId, year, showArchived],
    queryFn: () => api<ClubAnnualBook[]>(clubApi(clubId, `/books?year=${year}${showArchived ? "&archived=1" : ""}`)),
  });
  const keys = [["club-books", clubId], ["club-goal", clubId], ["club-dashboard", clubId], ["home"]];
  const add = useSharedMutation((e: EditionSummary) => api(clubApi(clubId, "/books"), { body: { year, editionId: e.id } }), keys, "Added to the list.");
  const reorder = useSharedMutation((ids: string[]) => api(clubApi(clubId, "/books/reorder"), { body: { year, orderedIds: ids } }), keys);
  const archive = useSharedMutation(
    (b: ClubAnnualBook) => api(clubApi(clubId, `/books/${b.id}/${b.archivedAt ? "restore" : "archive"}`), { body: { expectedVersion: b.version } }),
    keys,
  );
  const update = useSharedMutation(
    (v: { book: ClubAnnualBook; status: ClubBookStatus; note: string }) =>
      api(clubApi(clubId, `/books/${v.book.id}`), { method: "PUT", body: { status: v.status, note: v.note, expectedVersion: v.book.version } }),
    keys,
    "List entry updated.",
  );

  const active = (q.data ?? []).filter((b) => !b.archivedAt);
  const move = (index: number, delta: number) => {
    const ids = active.map((b) => b.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  };

  return (
    <section>
      <SectionTitle
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={Share2} onClick={() => setSharing(true)}>
              Share
            </Button>
            <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
              Add book
            </Button>
          </div>
        }
      >
        {year} reading list
      </SectionTitle>
      <Checkbox className="mb-3" label="Show archived entries" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">Couldn't load the list. Try again in a moment.</Alert>}
      {q.data?.length === 0 && (
        <EmptyState title="The list is empty" action={<Button icon={Plus} onClick={() => setAdding(true)}>Add book</Button>}>
          Any member can add books for the club to read this year.
        </EmptyState>
      )}
      <ol className="space-y-2">
        {(q.data ?? []).map((b) => {
          const index = active.findIndex((a) => a.id === b.id);
          return (
            <li key={b.id}>
              <Card className={b.archivedAt ? "p-3 opacity-60 sm:p-4" : "p-3 sm:p-4"}>
                <div className="flex items-center gap-2">
                  {!b.archivedAt && <span className="w-6 text-right text-sm font-semibold text-ink-muted">{index + 1}.</span>}
                  <div className="min-w-0 flex-1">
                    <BookRow
                      edition={b.edition}
                      meta={
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={statusTone(b.status)}>{statusLabels[b.status]}</Badge>
                          {b.archivedAt && <Badge>Archived</Badge>}
                          <AuditLine item={b} />
                        </span>
                      }
                    />
                    {b.note && <p className="mt-1 pl-15 text-sm text-ink-muted">{b.note}</p>}
                  </div>
                  <div className="flex flex-wrap justify-end">
                    {!b.archivedAt && (
                      <>
                        <IconButton icon={ArrowUp} label={`Move ${b.edition.title} up`} disabled={index === 0 || reorder.isPending || q.isFetching} onClick={() => move(index, -1)} />
                        <IconButton
                          icon={ArrowDown}
                          label={`Move ${b.edition.title} down`}
                          disabled={index === active.length - 1 || reorder.isPending || q.isFetching}
                          onClick={() => move(index, 1)}
                        />
                        <IconButton icon={Pencil} label={`Edit ${b.edition.title}`} onClick={() => setEditing(b)} />
                      </>
                    )}
                    <IconButton icon={b.archivedAt ? ArchiveRestore : Archive} label={b.archivedAt ? "Restore" : "Archive"} onClick={() => archive.mutate(b)} />
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      <Dialog open={adding} onClose={() => setAdding(false)} title={`Add to the ${year} list`} wide>
        <BookPicker pickLabel="Add" onPick={(e) => add.mutate(e, { onSuccess: () => setAdding(false) })} />
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit list entry">
        {editing && <AnnualEntryForm book={editing} onSave={(status, note) => update.mutate({ book: editing, status, note }, { onSuccess: () => setEditing(null) })} busy={update.isPending} />}
      </Dialog>
      <ShareDialog open={sharing} onClose={() => setSharing(false)} input={{ resourceType: "club_list", clubId, year }} label={`the club's ${year} reading list`} />
    </section>
  );
}

function AnnualEntryForm({ book, onSave, busy }: { book: ClubAnnualBook; onSave: (s: ClubBookStatus, note: string) => void; busy: boolean }) {
  const [status, setStatus] = useState(book.status);
  const [note, setNote] = useState(book.note ?? "");
  return (
    <div className="space-y-4">
      <BookRow edition={book.edition} link={false} />
      <Field label="Status">
        {(id) => (
          <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as ClubBookStatus)}>
            {CLUB_BOOK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Note">{(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <Button loading={busy} onClick={() => onSave(status, note)}>
        Save
      </Button>
    </div>
  );
}

// --- Assignments ----------------------------------------------------------------------------

export function EditionChooser({ value, onChange }: { value: EditionSummary | null; onChange: (e: EditionSummary) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      {value ? <BookRow edition={value} link={false} /> : <p className="text-sm text-ink-muted">No book selected.</p>}
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {value ? "Change book" : "Choose book"}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Choose a book" wide>
        <BookPicker
          onPick={(e) => {
            onChange(e);
            setOpen(false);
          }}
        />
      </Dialog>
    </div>
  );
}

function AssignmentForm({ clubId, initial, onDone }: { clubId: string; initial?: Assignment; onDone: () => void }) {
  const meetings = useQuery({ queryKey: ["meetings", clubId, "upcoming"], queryFn: () => api<Meeting[]>(clubApi(clubId, "/meetings")) });
  const [edition, setEdition] = useState<EditionSummary | null>(initial?.edition ?? null);
  const [meetingId, setMeetingId] = useState(initial?.meeting?.id ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [scope, setScope] = useState(initial?.readingScope ?? "");
  const [details, setDetails] = useState(initial?.details ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useSharedMutation(
    () => {
      const body = { editionId: edition?.id, meetingId: meetingId || null, dueDate, readingScope: scope, details };
      return initial
        ? api(clubApi(clubId, `/assignments/${initial.id}`), { method: "PUT", body: { ...body, expectedVersion: initial.version } })
        : api(clubApi(clubId, "/assignments"), { body });
    },
    [["assignments", clubId], ["club-dashboard", clubId], ["home"]],
    initial ? "Assignment updated." : "Assignment added.",
  );
  return (
    <div className="space-y-4">
      <Field label="Book">{() => <EditionChooser value={edition} onChange={setEdition} />}</Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Due date">{(id) => <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
        <Field label="Meeting (optional)">
          {(id) => (
            <Select id={id} value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
              <option value="">None</option>
              {initial?.meeting && !meetings.data?.some((m) => m.id === initial.meeting!.id) && <option value={initial.meeting.id}>{initial.meeting.title}</option>}
              {meetings.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({formatDate(m.startsAt)})
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="What to read" hint="For example: chapters 1 to 10, or pages 1 to 120.">
        {(id, d) => <Input id={id} aria-describedby={d} value={scope} onChange={(e) => setScope(e.target.value)} />}
      </Field>
      <Field label="Details">{(id) => <Textarea id={id} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />}</Field>
      {error && <Alert tone="error">{error}</Alert>}
      <Button
        loading={save.isPending}
        onClick={() => {
          if (!edition || !dueDate) return setError("Choose a book and a due date.");
          setError(null);
          save.mutate(undefined, { onSuccess: onDone });
        }}
      >
        Save assignment
      </Button>
    </div>
  );
}

function Assignments({ clubId }: { clubId: string }) {
  const [when, setWhen] = useState<"current" | "past">("current");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const q = useQuery({ queryKey: ["assignments", clubId, when], queryFn: () => api<Assignment[]>(clubApi(clubId, `/assignments?when=${when}&today=${todayIso()}`)) });
  const archive = useSharedMutation(
    (a: Assignment) => api(clubApi(clubId, `/assignments/${a.id}/archive`), { body: { expectedVersion: a.version } }),
    [["assignments", clubId], ["club-dashboard", clubId], ["home"]],
    "Assignment archived.",
  );
  return (
    <section>
      <SectionTitle
        action={
          <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
            New assignment
          </Button>
        }
      >
        Assignments
      </SectionTitle>
      <div className="mb-3 flex gap-2">
        <Button size="sm" variant={when === "current" ? "primary" : "secondary"} onClick={() => setWhen("current")}>
          Upcoming
        </Button>
        <Button size="sm" variant={when === "past" ? "primary" : "secondary"} onClick={() => setWhen("past")}>
          Past
        </Button>
      </div>
      {q.isPending && <Spinner />}
      {q.data?.length === 0 && <EmptyState icon={ClipboardList} title={when === "current" ? "No upcoming assignments" : "No past assignments"} />}
      <ul className="space-y-2">
        {q.data?.map((a) => (
          <li key={a.id}>
            <Card className="p-3 sm:p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <BookRow
                    edition={a.edition}
                    meta={
                      <span className="space-y-0.5">
                        <span className="block font-medium text-ink">
                          {a.readingScope ?? "Read"} · due {formatDate(a.dueDate)}
                        </span>
                        {a.meeting && <span className="block">For: {a.meeting.title}</span>}
                        <AuditLine item={a} />
                      </span>
                    }
                  />
                  {a.details && <p className="mt-2 whitespace-pre-wrap text-sm">{a.details}</p>}
                </div>
                <IconButton icon={Pencil} label="Edit assignment" onClick={() => setEditing(a)} />
                <IconButton icon={Archive} label="Archive assignment" onClick={() => archive.mutate(a)} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New assignment" wide>
        <AssignmentForm clubId={clubId} onDone={() => setCreating(false)} />
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit assignment" wide>
        {editing && <AssignmentForm clubId={clubId} initial={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </section>
  );
}

export function ReadingListPage() {
  const club = useClub();
  useDocumentTitle(`Reading list · ${club.name}`);
  const [params, setParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = Number(params.get("year")) || thisYear;
  const goal = useQuery({ queryKey: ["club-goal", club.id, year], queryFn: () => api<{ goal: ClubGoal | null; completed: number }>(clubApi(club.id, `/goal?year=${year}`)) });
  const years = useQuery({ queryKey: ["club-years", club.id], queryFn: () => api<number[]>(clubApi(club.id, "/books/years")) });
  const yearOptions = Array.from(new Set([thisYear + 1, thisYear, ...(years.data ?? []), year])).sort((a, b) => b - a);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={club.name}
        title="Reading list"
        description="The shelf the club reads together: this year's books, the goal, and what to read by when. Any member can add, edit, reorder or archive."
        actions={
          <>
            <LinkButton to={clubPath(club.id, "genres")} variant="secondary" icon={Tags}>
              Genres
            </LinkButton>
            <Select aria-label="Year" value={year} onChange={(e) => setParams({ year: e.target.value })} className="w-28">
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </>
        }
      />
      {goal.data && <GoalEditor key={`${year}-${goal.data.goal?.version ?? 0}`} clubId={club.id} year={year} goal={goal.data.goal} completed={goal.data.completed} />}
      <AnnualList clubId={club.id} year={year} />
      <Assignments clubId={club.id} />
    </div>
  );
}
