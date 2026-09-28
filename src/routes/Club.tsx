import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, CalendarDays, ClipboardList, Pencil, Plus, Share2, Sparkles, Tags, Target } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { CLUB_BOOK_STATUSES, type ClubBookStatus } from "@shared/constants";
import type { Assignment, ClubAnnualBook, ClubGoal, EditionSummary, Meeting } from "@shared/types";
import { BookPicker, BookRow } from "@/components/books";
import { ShareDialog } from "@/components/content";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, IconButton, Input, PageHeader, ProgressBar, SectionTitle, Select, Spinner, Textarea } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { formatDate, relativeTime, todayIso } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

const statusLabels: Record<ClubBookStatus, string> = { planned: "Planned", current: "Reading now", completed: "Completed" };

/** Standard handling for shared-record mutations: refresh on success, explain 409 conflicts. */
export function useSharedMutation<TVars>(fn: (v: TVars) => Promise<unknown>, keys: unknown[][], success?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of keys) void qc.invalidateQueries({ queryKey: k });
      if (success) toast(success);
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 409) {
        for (const k of keys) void qc.invalidateQueries({ queryKey: k });
      }
      toast(errorMessage(err), "error");
    },
  });
}

export function AuditLine({ item }: { item: { createdBy: { displayName: string } | null; updatedBy: { displayName: string } | null; createdAt: string; updatedAt: string } }) {
  return (
    <span className="text-xs text-ink-muted">
      Added by {item.createdBy?.displayName ?? "a former member"}
      {item.updatedAt !== item.createdAt && item.updatedBy ? ` · edited by ${item.updatedBy.displayName} ${relativeTime(item.updatedAt)}` : ""}
    </span>
  );
}

function ClubNav() {
  const links: { to: string; label: string; icon: typeof CalendarDays }[] = [
    { to: "/club/meetings", label: "Meetings", icon: CalendarDays },
    { to: "/club/activities", label: "Activities", icon: Sparkles },
    { to: "/club/genres", label: "Genres", icon: Tags },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius)] border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-2">
          <l.icon className="size-4" aria-hidden /> {l.label}
        </Link>
      ))}
    </div>
  );
}

function GoalEditor({ year, goal, completed }: { year: number; goal: ClubGoal | null; completed: number }) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(String(goal?.target ?? 12));
  const save = useSharedMutation(
    () => api("/api/club/goal", { method: "PUT", body: { year, target: Number(target), expectedVersion: goal?.version } }),
    [["club-goal"], ["dashboard"]],
    "Club goal saved",
  );
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Target className="size-4 text-accent" aria-hidden /> {year} club goal
        </h2>
        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>
          {goal ? "Edit" : "Set goal"}
        </Button>
      </div>
      {goal ? (
        <>
          <p className="mt-2 font-serif text-3xl font-semibold">
            {completed}
            <span className="text-lg text-ink-muted"> / {goal.target} books read together</span>
          </p>
          <div className="mt-3">
            <ProgressBar value={completed} max={goal.target} label="Club goal progress" />
          </div>
          <p className="mt-2">
            <AuditLine item={goal} />
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">No goal yet for {year}. Completed books on the list: {completed}.</p>
      )}
      <Dialog open={editing} onClose={() => setEditing(false)} title={`${year} club goal`}>
        <div className="space-y-4">
          <Field label="Number of books">{(id) => <Input id={id} type="number" min={1} max={1000} value={target} onChange={(e) => setTarget(e.target.value)} />}</Field>
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => setEditing(false),
              })
            }
          >
            Save goal
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}

function AnnualList({ year }: { year: number }) {
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState<ClubAnnualBook | null>(null);
  const q = useQuery({
    queryKey: ["club-books", year, showArchived],
    queryFn: () => api<ClubAnnualBook[]>(`/api/club/books?year=${year}${showArchived ? "&archived=1" : ""}`),
  });
  const keys = [["club-books"], ["club-goal"], ["dashboard"]];
  const add = useSharedMutation((e: EditionSummary) => api("/api/club/books", { body: { year, editionId: e.id } }), keys, "Added to the list");
  const reorder = useSharedMutation((ids: string[]) => api("/api/club/books/reorder", { body: { year, orderedIds: ids } }), keys);
  const archive = useSharedMutation(
    (b: ClubAnnualBook) => api(`/api/club/books/${b.id}/${b.archivedAt ? "restore" : "archive"}`, { body: { expectedVersion: b.version } }),
    keys,
  );
  const update = useSharedMutation(
    (v: { book: ClubAnnualBook; status: ClubBookStatus; note: string }) =>
      api(`/api/club/books/${v.book.id}`, { method: "PUT", body: { status: v.status, note: v.note, expectedVersion: v.book.version } }),
    keys,
    "List entry updated",
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
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data?.length === 0 && <EmptyState title="The list is empty">Any member can add books for the club to read this year.</EmptyState>}
      <ol className="space-y-2">
        {(q.data ?? []).map((b) => {
          const index = active.findIndex((a) => a.id === b.id);
          return (
            <li key={b.id}>
              <Card className={b.archivedAt ? "p-3 opacity-60" : "p-3"}>
                <div className="flex items-center gap-2">
                  {!b.archivedAt && <span className="w-6 text-right text-sm font-semibold text-ink-muted">{index + 1}.</span>}
                  <div className="min-w-0 flex-1">
                    <BookRow
                      edition={b.edition}
                      meta={
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={b.status === "completed" ? "accent" : b.status === "current" ? "highlight" : "neutral"}>{statusLabels[b.status]}</Badge>
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
      <ShareDialog open={sharing} onClose={() => setSharing(false)} input={{ resourceType: "club_list", year }} label={`the club's ${year} reading list`} />
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

function EditionChooser({ value, onChange }: { value: EditionSummary | null; onChange: (e: EditionSummary) => void }) {
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

function AssignmentForm({ initial, onDone }: { initial?: Assignment; onDone: () => void }) {
  const meetings = useQuery({ queryKey: ["meetings", "upcoming"], queryFn: () => api<Meeting[]>("/api/club/meetings") });
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
        ? api(`/api/club/assignments/${initial.id}`, { method: "PUT", body: { ...body, expectedVersion: initial.version } })
        : api("/api/club/assignments", { body });
    },
    [["assignments"], ["dashboard"]],
    initial ? "Assignment updated" : "Assignment added",
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
      <Field label="What to read" hint="e.g. Chapters 1–10 or pages 1–120">
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

function Assignments() {
  const [when, setWhen] = useState<"current" | "past">("current");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const q = useQuery({ queryKey: ["assignments", when], queryFn: () => api<Assignment[]>(`/api/club/assignments?when=${when}&today=${todayIso()}`) });
  const archive = useSharedMutation((a: Assignment) => api(`/api/club/assignments/${a.id}/archive`, { body: { expectedVersion: a.version } }), [["assignments"], ["dashboard"]], "Assignment archived");
  return (
    <section>
      <SectionTitle action={<Button size="sm" icon={Plus} onClick={() => setCreating(true)}>New assignment</Button>}>
        <span className="flex items-center gap-2">
          <ClipboardList className="size-4 text-accent" aria-hidden /> Assignments
        </span>
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
            <Card className="p-3">
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
        <AssignmentForm onDone={() => setCreating(false)} />
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit assignment" wide>
        {editing && <AssignmentForm initial={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </section>
  );
}

export function ClubPage() {
  useDocumentTitle("Club");
  const [params, setParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = Number(params.get("year")) || thisYear;
  const goal = useQuery({ queryKey: ["club-goal", year], queryFn: () => api<{ goal: ClubGoal | null; completed: number }>(`/api/club/goal?year=${year}`) });
  const years = useQuery({ queryKey: ["club-years"], queryFn: () => api<number[]>("/api/club/books/years") });
  const yearOptions = Array.from(new Set([thisYear + 1, thisYear, ...(years.data ?? []), year])).sort((a, b) => b - a);
  return (
    <div className="space-y-8">
      <PageHeader
        title="The club"
        description="Shared lists, goals and plans. Any member can add, edit, reorder or archive."
        actions={
          <Select aria-label="Year" value={year} onChange={(e) => setParams({ year: e.target.value })} className="w-28">
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        }
      />
      <ClubNav />
      {goal.data && <GoalEditor key={`${year}-${goal.data.goal?.version ?? 0}`} year={year} goal={goal.data.goal} completed={goal.data.completed} />}
      <AnnualList year={year} />
      <Assignments />
    </div>
  );
}

export function SubPage({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm">
        <Link to="/club" className="text-accent underline">
          ← Club
        </Link>
      </p>
      <PageHeader title={title} description={description} />
      {children}
    </div>
  );
}
