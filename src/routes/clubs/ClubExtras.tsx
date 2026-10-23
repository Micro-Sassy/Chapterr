import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, CalendarDays, MapPin, Pencil, Plus, Sparkles, Tags } from "lucide-react";
import { useState } from "react";
import { CLUB_ACTIVITY_KINDS, type ClubActivityKind } from "@shared/constants";
import type { ClubActivity, EditionSummary, Genre, Meeting } from "@shared/types";
import { BookPicker, BookRow } from "@/components/books";
import { AuditLine, clubApi, useSharedMutation } from "@/components/records";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, IconButton, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api } from "@/lib/api";
import { useClub } from "@/lib/club";
import { formatDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

// --- Meetings ------------------------------------------------------------------------------

function MeetingForm({ clubId, initial, onDone }: { clubId: string; initial?: Meeting; onDone: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [startsAt, setStartsAt] = useState(toLocalInput(initial?.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(initial?.endsAt));
  const [location, setLocation] = useState(initial?.location ?? "");
  const [details, setDetails] = useState(initial?.details ?? "");
  const [edition, setEdition] = useState<EditionSummary | null>(initial?.edition ?? null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useSharedMutation(
    () => {
      const body = { title, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt), location, details, editionId: edition?.id ?? null };
      return initial
        ? api(clubApi(clubId, `/meetings/${initial.id}`), { method: "PUT", body: { ...body, expectedVersion: initial.version } })
        : api(clubApi(clubId, "/meetings"), { body });
    },
    [["meetings", clubId], ["club-dashboard", clubId], ["home"]],
    initial ? "Meeting updated." : "Meeting scheduled.",
  );
  return (
    <div className="space-y-4">
      <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="March meeting" />}</Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts">{(id) => <Input id={id} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}</Field>
        <Field label="Ends (optional)">{(id) => <Input id={id} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}</Field>
      </div>
      <Field label="Location">{(id) => <Input id={id} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Community room, video link…" />}</Field>
      <Field label="Details">{(id) => <Textarea id={id} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />}</Field>
      <div className="space-y-2">
        <p className="text-sm font-medium">Book to discuss (optional)</p>
        {edition && <BookRow edition={edition} link={false} />}
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            {edition ? "Change book" : "Choose book"}
          </Button>
          {edition && (
            <Button size="sm" variant="ghost" onClick={() => setEdition(null)}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <Button
        loading={save.isPending}
        onClick={() => {
          if (!title.trim() || !startsAt) return setError("Add a title and a start time.");
          setError(null);
          save.mutate(undefined, { onSuccess: onDone });
        }}
      >
        Save meeting
      </Button>
      <Dialog open={picking} onClose={() => setPicking(false)} title="Choose a book" wide>
        <BookPicker
          onPick={(e) => {
            setEdition(e);
            setPicking(false);
          }}
        />
      </Dialog>
    </div>
  );
}

export function MeetingsPage() {
  const club = useClub();
  useDocumentTitle(`Meetings · ${club.name}`);
  const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const q = useQuery({
    queryKey: ["meetings", club.id, when, showArchived],
    queryFn: () => api<Meeting[]>(clubApi(club.id, `/meetings?when=${when}${showArchived ? "&archived=1" : ""}`)),
  });
  const archive = useSharedMutation(
    (m: Meeting) => api(clubApi(club.id, `/meetings/${m.id}/${m.archivedAt ? "restore" : "archive"}`), { body: { expectedVersion: m.version } }),
    [["meetings", club.id], ["club-dashboard", club.id], ["home"]],
  );
  return (
    <div>
      <PageHeader
        eyebrow={club.name}
        title="Meetings"
        description="When and where the club meets. Any member can schedule, edit or archive."
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            Plan meeting
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant={when === "upcoming" ? "primary" : "secondary"} size="sm" onClick={() => setWhen("upcoming")}>
          Upcoming
        </Button>
        <Button variant={when === "past" ? "primary" : "secondary"} size="sm" onClick={() => setWhen("past")}>
          Past
        </Button>
        <Checkbox className="ml-2" label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
      </div>
      {q.isPending && <Spinner />}
      {q.data?.length === 0 && (
        <EmptyState icon={CalendarDays} title={when === "upcoming" ? "Nothing scheduled" : "No past meetings"} action={when === "upcoming" ? <Button icon={Plus} onClick={() => setCreating(true)}>Plan meeting</Button> : undefined} />
      )}
      <ul className="space-y-3">
        {q.data?.map((m) => (
          <li key={m.id}>
            <Card className={m.archivedAt ? "opacity-60" : undefined}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="heading-s">
                    {m.title} {m.archivedAt && <Badge>Archived</Badge>}
                  </p>
                  <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                    <CalendarDays className="size-4" aria-hidden /> {formatDateTime(m.startsAt)}
                    {m.endsAt ? ` to ${formatDateTime(m.endsAt)}` : ""}
                  </p>
                  {m.location && (
                    <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                      <MapPin className="size-4" aria-hidden /> {m.location}
                    </p>
                  )}
                  {m.details && <p className="whitespace-pre-wrap pt-1 text-sm">{m.details}</p>}
                  {m.edition && (
                    <div className="pt-2">
                      <BookRow edition={m.edition} />
                    </div>
                  )}
                  <AuditLine item={m} />
                </div>
                {!m.archivedAt && <IconButton icon={Pencil} label="Edit meeting" onClick={() => setEditing(m)} />}
                <IconButton icon={m.archivedAt ? ArchiveRestore : Archive} label={m.archivedAt ? "Restore meeting" : "Archive meeting"} onClick={() => archive.mutate(m)} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Dialog open={creating} onClose={() => setCreating(false)} title="Plan a meeting" wide>
        <MeetingForm clubId={club.id} onDone={() => setCreating(false)} />
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit meeting" wide>
        {editing && <MeetingForm clubId={club.id} initial={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

// --- Activities --------------------------------------------------------------------------------

const kindLabels: Record<ClubActivityKind, string> = { event: "Event", discussion: "Discussion", challenge: "Challenge", other: "Other" };

function ActivityForm({ clubId, initial, onDone }: { clubId: string; initial?: ClubActivity; onDone: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<ClubActivityKind>(initial?.kind ?? "event");
  const [startsAt, setStartsAt] = useState(toLocalInput(initial?.startsAt));
  const [details, setDetails] = useState(initial?.details ?? "");
  const save = useSharedMutation(
    () => {
      const body = { title, kind, details, startsAt: fromLocalInput(startsAt) };
      return initial
        ? api(clubApi(clubId, `/activities/${initial.id}`), { method: "PUT", body: { ...body, expectedVersion: initial.version } })
        : api(clubApi(clubId, "/activities"), { body });
    },
    [["activities", clubId]],
    initial ? "Activity updated." : "Activity added.",
  );
  return (
    <div className="space-y-4">
      <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as ClubActivityKind)}>
              {CLUB_ACTIVITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabels[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="When (optional)">{(id) => <Input id={id} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}</Field>
      </div>
      <Field label="Details">{(id) => <Textarea id={id} rows={4} value={details} onChange={(e) => setDetails(e.target.value)} />}</Field>
      <Button loading={save.isPending} disabled={!title.trim()} onClick={() => save.mutate(undefined, { onSuccess: onDone })}>
        Save
      </Button>
    </div>
  );
}

export function ActivitiesPage() {
  const club = useClub();
  useDocumentTitle(`Activities · ${club.name}`);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClubActivity | null>(null);
  const q = useQuery({ queryKey: ["activities", club.id, showArchived], queryFn: () => api<ClubActivity[]>(clubApi(club.id, `/activities${showArchived ? "?archived=1" : ""}`)) });
  const archive = useSharedMutation(
    (a: ClubActivity) => api(clubApi(club.id, `/activities/${a.id}/${a.archivedAt ? "restore" : "archive"}`), { body: { expectedVersion: a.version } }),
    [["activities", club.id]],
  );
  return (
    <div>
      <PageHeader
        eyebrow={club.name}
        title="Activities"
        description="Socials, challenges, discussions: anything else the club does together."
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            New activity
          </Button>
        }
      />
      <div className="mb-4">
        <Checkbox label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
      </div>
      {q.isPending && <Spinner />}
      {q.data?.length === 0 && <EmptyState icon={Sparkles} title="No activities yet" action={<Button icon={Plus} onClick={() => setCreating(true)}>New activity</Button>} />}
      <ul className="space-y-3">
        {q.data?.map((a) => (
          <li key={a.id}>
            <Card className={a.archivedAt ? "opacity-60" : undefined}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="heading-s flex flex-wrap items-center gap-2">
                    {a.title} <Badge tone="info">{kindLabels[a.kind]}</Badge> {a.archivedAt && <Badge>Archived</Badge>}
                  </p>
                  {a.startsAt && <p className="text-sm text-ink-muted">{formatDateTime(a.startsAt)}</p>}
                  {a.details && <p className="whitespace-pre-wrap text-sm">{a.details}</p>}
                  <AuditLine item={a} />
                </div>
                {!a.archivedAt && <IconButton icon={Pencil} label="Edit activity" onClick={() => setEditing(a)} />}
                <IconButton icon={a.archivedAt ? ArchiveRestore : Archive} label={a.archivedAt ? "Restore" : "Archive"} onClick={() => archive.mutate(a)} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New activity">
        <ActivityForm clubId={club.id} onDone={() => setCreating(false)} />
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit activity">
        {editing && <ActivityForm clubId={club.id} initial={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

// --- Genres ------------------------------------------------------------------------------------------

export function GenresPage() {
  const club = useClub();
  useDocumentTitle(`Genres · ${club.name}`);
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Genre | null>(null);
  const [rename, setRename] = useState("");
  const [browsing, setBrowsing] = useState<Genre | null>(null);
  const q = useQuery({ queryKey: ["genres", club.id, showArchived], queryFn: () => api<Genre[]>(clubApi(club.id, `/genres${showArchived ? "?archived=1" : ""}`)) });
  const books = useQuery({ queryKey: ["genre-books", club.id, browsing?.id], queryFn: () => api<EditionSummary[]>(clubApi(club.id, `/genres/${browsing!.id}/books`)), enabled: !!browsing });
  const create = useSharedMutation(() => api(clubApi(club.id, "/genres"), { body: { name } }), [["genres", club.id]], "Genre added.");
  const update = useSharedMutation((g: Genre) => api(clubApi(club.id, `/genres/${g.id}`), { method: "PUT", body: { name: rename, expectedVersion: g.version } }), [["genres", club.id]], "Genre renamed.");
  const archive = useSharedMutation((g: Genre) => api(clubApi(club.id, `/genres/${g.id}/${g.archivedAt ? "restore" : "archive"}`), { body: { expectedVersion: g.version } }), [["genres", club.id]]);
  return (
    <div>
      <PageHeader eyebrow={club.name} title="Genres" description="The club's shared genre list, used to tag books." />
      <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(undefined, { onSuccess: () => setName("") });
        }}
      >
        <Input aria-label="New genre name" placeholder="New genre, for example Mystery" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button type="submit" icon={Plus} loading={create.isPending}>
          Add genre
        </Button>
        <Checkbox className="ml-2" label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
      </form>
      {q.isPending && <Spinner />}
      {q.data?.length === 0 && <EmptyState icon={Tags} title="No genres yet" />}
      <ul className="grid gap-2 sm:grid-cols-2">
        {q.data?.map((g) => (
          <li key={g.id}>
            <Card className={`flex items-center gap-2 p-3 sm:p-3 ${g.archivedAt ? "opacity-60" : ""}`}>
              <button type="button" className="min-w-0 flex-1 rounded-control px-1 text-left" onClick={() => setBrowsing(g)}>
                <span className="font-medium hover:underline">{g.name}</span>
                <span className="ml-2 text-xs text-ink-muted">{g.bookCount ?? 0} books</span>
              </button>
              {!g.archivedAt && (
                <IconButton
                  icon={Pencil}
                  label={`Rename ${g.name}`}
                  onClick={() => {
                    setEditing(g);
                    setRename(g.name);
                  }}
                />
              )}
              <IconButton icon={g.archivedAt ? ArchiveRestore : Archive} label={g.archivedAt ? `Restore ${g.name}` : `Archive ${g.name}`} onClick={() => archive.mutate(g)} />
            </Card>
          </li>
        ))}
      </ul>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Rename genre">
        <div className="space-y-4">
          <Field label="Name">{(id) => <Input id={id} value={rename} onChange={(e) => setRename(e.target.value)} />}</Field>
          <Button loading={update.isPending} onClick={() => editing && update.mutate(editing, { onSuccess: () => setEditing(null) })}>
            Save
          </Button>
        </div>
      </Dialog>
      <Dialog open={!!browsing} onClose={() => setBrowsing(null)} title={browsing?.name ?? "Genre"} wide>
        {books.isPending ? (
          <Spinner />
        ) : books.data?.length ? (
          <ul className="space-y-3">
            {books.data.map((b) => (
              <li key={b.id}>
                <BookRow edition={b} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No books tagged yet.</p>
        )}
      </Dialog>
    </div>
  );
}
