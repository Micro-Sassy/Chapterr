import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ListPlus, Pencil, Quote as QuoteIcon, Sparkles, Star, Tags, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useParams } from "react-router";
import type { z } from "zod";
import { READING_STATUSES, READING_STATUS_LABELS } from "@shared/constants";
import { userBookSchema } from "@shared/schemas";
import type { ClubMember, EditionDetail, EditionSummary, Genre, Quote, Review, UserBook } from "@shared/types";
import { BookCover } from "@/components/BookCover";
import { BookRow, EditionForm } from "@/components/books";
import { QuoteCard, QuoteForm, ReviewCard, ReviewForm, VisibilityField } from "@/components/content";
import { FeasibilityPanel, IntelligenceNotice, MappingsPanel, RoomsLinks } from "@/components/growth/BookPanels";
import { clubApi } from "@/components/records";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, LinkButton, SectionTitle, Select, Spinner, Textarea, TextLink } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { clubPath, useCurrentClubId, useMe } from "@/lib/club";
import { authorsLine, todayIso } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

interface EditionResponse {
  edition: EditionDetail;
  /** Reading-status counts among members who share a club with the viewer. */
  clubStats?: Partial<Record<string, number>>;
  otherEditions: EditionSummary[];
}

type ShelfValues = z.input<typeof userBookSchema>;

/** Choose one of the member's clubs; defaults to the club in scope. */
function useClubChoice() {
  const me = useMe();
  const current = useCurrentClubId();
  const clubs = me.data?.clubs ?? [];
  const [clubId, setClubId] = useState<string>("");
  const effective = clubId || current || clubs[0]?.id || "";
  return { clubs, clubId: effective, setClubId, loading: me.isPending };
}

function ClubField({ clubs, value, onChange }: { clubs: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  if (clubs.length <= 1) return null;
  return (
    <Field label="Club">
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function NoClubs() {
  return (
    <EmptyState title="You're not in a club yet" action={<LinkButton to="/clubs/new">Create a club</LinkButton>}>
      Clubs are where recommendations, reading lists and genres live.
    </EmptyState>
  );
}

function ShelfForm({ editionId, entry, onDone }: { editionId: string; entry: UserBook | null; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const form = useForm<ShelfValues>({
    resolver: zodResolver(userBookSchema),
    defaultValues: {
      editionId,
      status: entry?.status ?? "tbr",
      startedAt: entry?.startedAt ?? "",
      finishedAt: entry?.finishedAt ?? "",
      currentPage: entry?.currentPage ?? "",
      progressPercent: entry?.progressPercent ?? "",
      visibility: entry?.visibility ?? me.data?.profile.defaultVisibility ?? "club",
      notes: entry?.notes ?? "",
    } as ShelfValues,
  });
  const status = form.watch("status");
  const save = useMutation({
    mutationFn: (v: ShelfValues) => {
      // Default dates use the member's local calendar day, not the server's (UTC).
      const body = { ...v };
      if (body.status === "reading" && !body.startedAt && !entry?.startedAt) body.startedAt = todayIso();
      if (body.status === "finished" && !body.finishedAt && !entry?.finishedAt) body.finishedAt = todayIso();
      return api<UserBook>(`/api/library/editions/${editionId}`, { method: "PUT", body });
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["library"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
      void qc.invalidateQueries({ queryKey: ["goal"] });
      toast(saved.status === "finished" ? "Finished. Nicely done!" : "Shelved.");
      onDone();
    },
  });
  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      <Field label="Status">
        {(id) => (
          <Select id={id} {...form.register("status")}>
            {READING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {READING_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Started" error={e.startedAt?.message}>
          {(id) => <Input id={id} type="date" {...form.register("startedAt")} />}
        </Field>
        {status === "finished" && (
          <Field label="Finished" hint="Defaults to today" error={e.finishedAt?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" {...form.register("finishedAt")} />}
          </Field>
        )}
        {status === "reading" && (
          <>
            <Field label="Current page" error={e.currentPage?.message}>
              {(id) => <Input id={id} inputMode="numeric" {...form.register("currentPage")} />}
            </Field>
            <Field label="Progress %" error={e.progressPercent?.message}>
              {(id) => <Input id={id} inputMode="numeric" {...form.register("progressPercent")} />}
            </Field>
          </>
        )}
      </div>
      <VisibilityField field={form.register("visibility")} />
      <Field label="Personal notes" hint="Only you can ever see these notes." error={e.notes?.message}>
        {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} {...form.register("notes")} />}
      </Field>
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <Button type="submit" loading={save.isPending}>
        Save
      </Button>
    </form>
  );
}

function RecommendForm({ editionId, onDone }: { editionId: string; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const { clubs, clubId, setClubId, loading } = useClubChoice();
  const members = useQuery({ queryKey: ["club-members", clubId], queryFn: () => api<ClubMember[]>(clubApi(clubId, "/members")), enabled: !!clubId });
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const send = useMutation({
    mutationFn: () => api(clubApi(clubId, "/recommendations"), { body: { editionId, recipientUserId: recipient || null, note } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recommendations"] });
      toast("Recommendation sent.");
      onDone();
    },
  });
  if (loading) return <Spinner />;
  if (!clubId) return <NoClubs />;
  return (
    <div className="space-y-4">
      <ClubField
        clubs={clubs}
        value={clubId}
        onChange={(id) => {
          setClubId(id);
          setRecipient("");
        }}
      />
      <Field label="Recommend to">
        {(id) => (
          <Select id={id} value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            <option value="">The whole club</option>
            {members.data
              ?.filter((m) => m.id !== session?.user.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} (@{m.username})
                </option>
              ))}
          </Select>
        )}
      </Field>
      <Field label="Why you recommend it (optional)">{(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      {send.isError && <Alert tone="error">{errorMessage(send.error)}</Alert>}
      <Button icon={Sparkles} loading={send.isPending} onClick={() => send.mutate()}>
        Recommend
      </Button>
    </div>
  );
}

function AddToClubListForm({ editionId, onDone }: { editionId: string; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { clubs, clubId, setClubId, loading } = useClubChoice();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const add = useMutation({
    mutationFn: () => api(clubApi(clubId, "/books"), { body: { year: Number(year), editionId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["club-books", clubId] });
      void qc.invalidateQueries({ queryKey: ["club-dashboard", clubId] });
      toast(`Added to the ${year} list.`);
      onDone();
    },
  });
  if (loading) return <Spinner />;
  if (!clubId) return <NoClubs />;
  return (
    <div className="space-y-4">
      <ClubField clubs={clubs} value={clubId} onChange={setClubId} />
      <IntelligenceNotice clubId={clubId} editionId={editionId} />
      <Field label="Year">{(id) => <Input id={id} type="number" min={1900} max={2200} value={year} onChange={(e) => setYear(e.target.value)} />}</Field>
      {add.isError && <Alert tone="error">{errorMessage(add.error)}</Alert>}
      <Button icon={ListPlus} loading={add.isPending} onClick={() => add.mutate()}>
        Add to list
      </Button>
    </div>
  );
}

/** Genres belong to a club; tag this book with one club's genres at a time. */
function GenreEditor({ bookId, current, onDone }: { bookId: string; current: Genre[]; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { clubs, clubId, setClubId, loading } = useClubChoice();
  const genres = useQuery({ queryKey: ["genres", clubId, false], queryFn: () => api<Genre[]>(clubApi(clubId, "/genres")), enabled: !!clubId });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const chosen = selected ?? new Set(current.filter((g) => !g.clubId || g.clubId === clubId).map((g) => g.id));
  const save = useMutation({
    mutationFn: () => api(clubApi(clubId, `/works/${bookId}/genres`), { method: "PUT", body: { genreIds: Array.from(chosen) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["edition"] });
      void qc.invalidateQueries({ queryKey: ["genres", clubId] });
      toast("Genres updated.");
      onDone();
    },
  });
  if (loading) return <Spinner />;
  if (!clubId) return <NoClubs />;
  return (
    <div className="space-y-4">
      <ClubField
        clubs={clubs}
        value={clubId}
        onChange={(id) => {
          setClubId(id);
          setSelected(null);
        }}
      />
      {genres.isPending ? (
        <Spinner />
      ) : genres.data?.length ? (
        <div className="grid grid-cols-2 gap-2">
          {genres.data.map((g) => (
            <Checkbox
              key={g.id}
              label={g.name}
              checked={chosen.has(g.id)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(g.id);
                else next.delete(g.id);
                setSelected(next);
              }}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-muted">This club has no genres yet.</p>
      )}
      <p className="text-xs text-ink-muted">
        Manage the list on the club's <TextLink to={clubPath(clubId, "genres")}>Genres page</TextLink>. Genres apply to every edition of this book.
      </p>
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <Button loading={save.isPending} onClick={() => save.mutate()}>
        Save genres
      </Button>
    </div>
  );
}

export function BookDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [dialog, setDialog] = useState<null | "shelf" | "review" | "quote" | "recommend" | "club" | "genres" | "edit">(null);
  const edition = useQuery({
    queryKey: ["edition", id],
    queryFn: () => api<EditionResponse>(`/api/books/editions/${id}`),
    // A just-added catalogue book gets its description/details filled in the
    // background; poll briefly so they appear without a manual refresh.
    refetchInterval: (q) => {
      const e = q.state.data?.edition;
      if (!e || e.description || e.source === "manual" || e.source === "goodreads") return false;
      return Date.now() - new Date(e.createdAt).getTime() < 30_000 ? 3000 : false;
    },
  });
  const shelf = useQuery({ queryKey: ["library", "edition", id], queryFn: () => api<UserBook | null>(`/api/library/editions/${id}`) });
  const reviews = useQuery({ queryKey: ["reviews", "edition", id], queryFn: () => api<Review[]>(`/api/reviews?editionId=${id}`) });
  const quotes = useQuery({ queryKey: ["quotes", "edition", id], queryFn: () => api<Quote[]>(`/api/quotes?editionId=${id}`) });
  useDocumentTitle(edition.data?.edition.title ?? "Book");
  const removeFromShelf = useMutation({
    mutationFn: () => api(`/api/library/${shelf.data!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["library"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
      toast("Removed from your library.");
    },
  });

  useEffect(() => {
    if (location.hash && reviews.isSuccess && edition.isSuccess) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [reviews.isSuccess, edition.isSuccess]);

  if (edition.isPending) return <Spinner />;
  if (edition.isError) return <Alert tone="error">{errorMessage(edition.error)}</Alert>;
  const e = edition.data.edition;
  const myReview = reviews.data?.find((r) => r.isOwn);
  const stats = edition.data.clubStats ?? {};

  return (
    <div className="space-y-8">
      <Card className="flex flex-col gap-6 sm:flex-row">
        <BookCover url={e.coverUrlLarge ?? e.coverUrl} title={e.title} size="lg" className="self-center sm:self-start" />
        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <h1 className="book-title text-3xl leading-tight sm:text-4xl">{e.title}</h1>
            {e.subtitle && <p className="mt-1 text-lg text-ink-muted">{e.subtitle}</p>}
            <p className="mt-2">{authorsLine(e.authors)}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {e.isbn13 && (
              <div>
                <dt className="text-xs text-ink-muted">ISBN-13</dt>
                <dd>{e.isbn13}</dd>
              </div>
            )}
            {e.isbn10 && (
              <div>
                <dt className="text-xs text-ink-muted">ISBN-10</dt>
                <dd>{e.isbn10}</dd>
              </div>
            )}
            {e.publisher && (
              <div>
                <dt className="text-xs text-ink-muted">Publisher</dt>
                <dd>{e.publisher}</dd>
              </div>
            )}
            {(e.publishedDate || e.publishedYear) && (
              <div>
                <dt className="text-xs text-ink-muted">Published</dt>
                <dd>{e.publishedDate ?? e.publishedYear}</dd>
              </div>
            )}
            {e.pageCount && (
              <div>
                <dt className="text-xs text-ink-muted">Pages</dt>
                <dd>{e.pageCount}</dd>
              </div>
            )}
            {e.format !== "unknown" && (
              <div>
                <dt className="text-xs text-ink-muted">Format</dt>
                <dd className="capitalize">{e.format}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-wrap items-center gap-1.5">
            {e.genres.map((g) => (
              <Badge key={g.id} tone="info" className="gap-1">
                {g.name}
                {g.clubName && <span className="font-normal text-ink-muted">· {g.clubName}</span>}
              </Badge>
            ))}
            <button type="button" onClick={() => setDialog("genres")} className="inline-flex items-center gap-1 text-xs font-medium text-ink underline">
              <Tags className="size-3" aria-hidden /> Edit genres
            </button>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={() => setDialog("shelf")}>{shelf.data ? `On my shelf: ${READING_STATUS_LABELS[shelf.data.status]}` : "Add to my library"}</Button>
            <Button variant="secondary" icon={Star} onClick={() => setDialog("review")}>
              {myReview ? "Edit review" : "Write review"}
            </Button>
            <Button variant="secondary" icon={QuoteIcon} onClick={() => setDialog("quote")}>
              Save quote
            </Button>
            <Button variant="secondary" icon={Sparkles} onClick={() => setDialog("recommend")}>
              Recommend
            </Button>
            <Button variant="secondary" icon={ListPlus} onClick={() => setDialog("club")}>
              Club list
            </Button>
          </div>
          {shelf.data && (
            <p className="text-xs text-ink-muted">
              <button type="button" className="inline-flex items-center gap-1 underline" onClick={() => confirm("Remove this book from your library?") && removeFromShelf.mutate()}>
                <Trash2 className="size-3" aria-hidden /> Remove from my library
              </button>
            </p>
          )}
        </div>
      </Card>

      {(stats.reading || stats.finished || stats.tbr) && (
        <p className="text-sm text-ink-muted">
          In your clubs: {stats.reading ?? 0} reading · {stats.finished ?? 0} finished · {stats.tbr ?? 0} want to read
        </p>
      )}

      {e.description && (
        <Card>
          <SectionTitle>About this book</SectionTitle>
          <p className="max-w-prose whitespace-pre-wrap text-[15px] leading-relaxed">{e.description}</p>
        </Card>
      )}

      <section>
        <SectionTitle>Reviews</SectionTitle>
        {reviews.isPending && <Spinner />}
        {reviews.data?.length === 0 && (
          <EmptyState icon={Star} title="No reviews yet" action={<Button variant="secondary" onClick={() => setDialog("review")}>Write review</Button>} />
        )}
        <div className="space-y-3">
          {reviews.data?.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Quotes</SectionTitle>
        {quotes.data?.length === 0 && (
          <EmptyState icon={QuoteIcon} title="No quotes saved yet" action={<Button variant="secondary" onClick={() => setDialog("quote")}>Save quote</Button>} />
        )}
        <div className="space-y-3">
          {quotes.data?.map((q) => (
            <QuoteCard key={q.id} quote={q} showBook={false} />
          ))}
        </div>
      </section>

      <Card>
        <SectionTitle>Find this edition</SectionTitle>
        <ul className="flex flex-wrap gap-2">
          {e.retailerLinks.map((l) => (
            <li key={l.label}>
              <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
                {l.label} <ExternalLink className="size-3" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-muted">Plain search links. No tracking or affiliate codes.</p>
      </Card>

      <FeasibilityPanel editionId={e.id} />
      <MappingsPanel editionId={e.id} pageCount={e.pageCount} />
      <RoomsLinks editionId={e.id} clubs={me.data?.clubs ?? []} />

      {edition.data.otherEditions.length > 0 && (
        <section>
          <SectionTitle>Other editions</SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2">
            {edition.data.otherEditions.map((o) => (
              <li key={o.id}>
                <Card className="p-3 sm:p-4">
                  <BookRow edition={o} meta={o.isbn13 ? `ISBN ${o.isbn13}` : undefined} />
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-ink-muted">
        Details wrong?{" "}
        <button type="button" className="inline-flex items-center gap-1 font-medium text-ink underline" onClick={() => setDialog("edit")}>
          <Pencil className="size-3" aria-hidden /> Correct this edition
        </button>
      </p>

      <Dialog open={dialog === "shelf"} onClose={() => setDialog(null)} title="My shelf">
        {shelf.isSuccess && <ShelfForm editionId={e.id} entry={shelf.data} onDone={() => setDialog(null)} />}
      </Dialog>
      <Dialog open={dialog === "review"} onClose={() => setDialog(null)} title={myReview ? "Edit review" : "Write a review"} wide>
        <ReviewForm review={myReview} editionId={e.id} onDone={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === "quote"} onClose={() => setDialog(null)} title="Save a quote">
        <QuoteForm editionId={e.id} onDone={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === "recommend"} onClose={() => setDialog(null)} title="Recommend to a club">
        <RecommendForm editionId={e.id} onDone={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === "club"} onClose={() => setDialog(null)} title="Add to a club's reading list">
        <AddToClubListForm editionId={e.id} onDone={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === "genres"} onClose={() => setDialog(null)} title="Genres">
        <GenreEditor bookId={e.bookId} current={e.genres} onDone={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === "edit"} onClose={() => setDialog(null)} title="Correct edition details" wide>
        <EditionForm
          submitLabel="Save changes"
          defaultValues={{ ...e, isbn: e.isbn13 ?? e.isbn10 ?? "", pageCount: e.pageCount ?? undefined }}
          onSubmit={async (values) => {
            try {
              await api(`/api/books/editions/${e.id}`, { method: "PUT", body: { ...values, expectedVersion: e.version } });
              await qc.invalidateQueries({ queryKey: ["edition", id] });
              toast("Edition updated.");
              setDialog(null);
            } catch (err) {
              if (err instanceof ApiRequestError && err.status === 409) {
                await qc.invalidateQueries({ queryKey: ["edition", id] });
              }
              throw err;
            }
          }}
        />
      </Dialog>
    </div>
  );
}
