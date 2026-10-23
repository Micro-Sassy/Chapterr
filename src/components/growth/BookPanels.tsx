import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, ExternalLink, Headphones, Library, MessageSquare, Plus, Tablet } from "lucide-react";
import { useState } from "react";
import type { MappingKind } from "@shared/constants";
import type { ClubIntelligence, ClubSummary, EditionMappings, Feasibility } from "@shared/types";
import { BookRow } from "@/components/books";
import { clubApi } from "@/components/records";
import { Alert, Badge, Button, Card, Field, Input, SectionTitle, Select, Spinner, TextLink } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { clubPath } from "@/lib/club";

// --- Feasibility -------------------------------------------------------------------------------

function ExtLink({ href, children }: { href: string | null | undefined; children: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
      {children} <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

/** "Can everyone get it?": library lending, ebook price, audio, estimated hours. Best effort, so say so. */
export function FeasibilityPanel({ editionId }: { editionId: string }) {
  const q = useQuery({ queryKey: ["feasibility", editionId], queryFn: () => api<Feasibility>(`/api/books/editions/${editionId}/feasibility`), staleTime: 60 * 60_000, retry: false });
  return (
    <Card>
      <SectionTitle>Can everyone get it?</SectionTitle>
      {q.isPending && <Spinner label="Checking libraries and shops" />}
      {q.isError && <Alert tone="info">We could not check availability right now. The links below still work.</Alert>}
      {q.data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-control border border-line bg-ground p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <Library className="size-3.5" aria-hidden /> Library
              </p>
              <p className="mt-1 text-sm">
                {q.data.library.openLibraryLendable === true ? "Lendable on Open Library" : q.data.library.openLibraryLendable === false ? "Not lendable on Open Library" : "Open Library: unknown"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <ExtLink href={q.data.library.archiveOrgUrl}>Borrow</ExtLink>
                <ExtLink href={q.data.library.worldcatUrl}>Find nearby</ExtLink>
              </div>
            </div>
            <div className="rounded-control border border-line bg-ground p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <Tablet className="size-3.5" aria-hidden /> Ebook
              </p>
              <p className="mt-1 text-sm">{q.data.ebook.googleBooksPrice ? `${q.data.ebook.googleBooksPrice} on Google Books` : "Price not listed"}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <ExtLink href={q.data.ebook.googleBooksUrl}>Google Books</ExtLink>
                <ExtLink href={q.data.ebook.kindleSearchUrl}>Kindle</ExtLink>
              </div>
            </div>
            <div className="rounded-control border border-line bg-ground p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <Headphones className="size-3.5" aria-hidden /> Audio
              </p>
              <p className="mt-1 text-sm">Search the two main shops</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <ExtLink href={q.data.audio.libroFmUrl}>Libro.fm</ExtLink>
                <ExtLink href={q.data.audio.audibleSearchUrl}>Audible</ExtLink>
              </div>
            </div>
          </div>
          <p className="text-sm">
            {q.data.pageCount ? `${q.data.pageCount} pages` : "Page count unknown"}
            {q.data.estimatedHours ? `, about ${q.data.estimatedHours} ${q.data.estimatedHours === 1 ? "hour" : "hours"} of reading at a steady pace` : ""}.
          </p>
          <p className="text-xs text-ink-muted">Best effort: lending and prices come from Open Library and Google Books and can be out of date. Shop links are plain searches with no tracking.</p>
        </div>
      )}
    </Card>
  );
}

// --- Mappings ----------------------------------------------------------------------------------

const MAPPING_LABELS: Record<MappingKind, { title: string; unit: string; hint: string }> = {
  kindle: { title: "Kindle", unit: "locations", hint: "The last location number in the Kindle edition." },
  audio: { title: "Audiobook", unit: "minutes", hint: "Total running time in minutes." },
};

/** Kindle locations and audio minutes for this edition, so reading assignments can show ranges in every format. */
export function MappingsPanel({ editionId, pageCount }: { editionId: string; pageCount: number | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["mappings", editionId], queryFn: () => api<EditionMappings>(`/api/books/editions/${editionId}/mappings`), retry: false });
  const [adding, setAdding] = useState<MappingKind | null>(null);
  const [total, setTotal] = useState("");
  const [label, setLabel] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/api/books/editions/${editionId}/mappings`, { method: "PUT", body: { kind: adding, total: Number(total), label: label || null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mappings", editionId] });
      toast("Edition mapping saved.");
      setAdding(null);
      setTotal("");
      setLabel("");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const mappings = q.data?.mappings ?? [];
  const kinds: MappingKind[] = ["kindle", "audio"];
  return (
    <Card>
      <SectionTitle
        action={
          !adding && (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(kinds.find((k) => !mappings.some((m) => m.kind === k)) ?? "kindle")}>
              Add mapping
            </Button>
          )
        }
      >
        Editions and formats
      </SectionTitle>
      <p className="mb-3 text-sm text-ink-muted">Reading assignments are set in pages. With these totals, members on Kindle or audio see their own range too.</p>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-control border border-line bg-ground p-3">
          <dt className="text-xs text-ink-muted">Print</dt>
          <dd className="font-display text-xl">{pageCount ? `${pageCount.toLocaleString()} pages` : "Pages unknown"}</dd>
        </div>
        {kinds.map((k) => {
          const m = mappings.find((x) => x.kind === k);
          return (
            <div key={k} className="rounded-control border border-line bg-ground p-3">
              <dt className="text-xs text-ink-muted">{MAPPING_LABELS[k].title}</dt>
              <dd className="font-display text-xl">{m ? `${m.total.toLocaleString()} ${MAPPING_LABELS[k].unit}` : <span className="text-base text-ink-muted">Not set</span>}</dd>
              {m?.label && <dd className="text-xs text-ink-muted">{m.label}</dd>}
            </div>
          );
        })}
      </dl>
      {q.isError && <p className="mt-2 text-xs text-ink-muted">Mappings could not be loaded right now.</p>}
      {adding && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(total) > 0) save.mutate();
          }}
        >
          <Field label="Format">
            {(id) => (
              <Select id={id} value={adding} onChange={(e) => setAdding(e.target.value as MappingKind)}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {MAPPING_LABELS[k].title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={`Total ${MAPPING_LABELS[adding].unit}`} hint={MAPPING_LABELS[adding].hint}>
            {(id, d) => <Input id={id} aria-describedby={d} type="number" inputMode="numeric" min={1} value={total} onChange={(e) => setTotal(e.target.value)} />}
          </Field>
          <Field label="Label" hint="Optional, such as the narrator or edition.">
            {(id, d) => <Input id={id} aria-describedby={d} maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />}
          </Field>
          <div className="flex gap-2 pb-6 sm:pb-0">
            <Button type="submit" loading={save.isPending} disabled={!(Number(total) > 0)}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setAdding(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

// --- Discussion rooms -------------------------------------------------------------------------------

export function RoomsLinks({ editionId, clubs }: { editionId: string; clubs: ClubSummary[] }) {
  if (clubs.length === 0) return null;
  return (
    <Card>
      <SectionTitle>Discussion rooms</SectionTitle>
      <p className="mb-3 text-sm text-ink-muted">Chapter-by-chapter rooms that open as you read, so nobody is spoiled.</p>
      <ul className="flex flex-wrap gap-2">
        {clubs.map((c) => (
          <li key={c.id}>
            <TextLink to={clubPath(c.id, `rooms/${editionId}`)} className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-sm no-underline hover:bg-surface-2">
              <MessageSquare className="size-4" aria-hidden strokeWidth={1.75} /> {c.name}
            </TextLink>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --- Cross-club intelligence -----------------------------------------------------------------------------

/** Before adding a book to a club list: have your other clubs already picked it, and what else fits? */
export function IntelligenceNotice({ clubId, editionId }: { clubId: string; editionId: string }) {
  const q = useQuery({
    queryKey: ["intelligence", clubId, editionId],
    queryFn: () => api<ClubIntelligence>(clubApi(clubId, `/intelligence?editionId=${encodeURIComponent(editionId)}`)),
    enabled: !!clubId,
    retry: false,
    staleTime: 5 * 60_000,
  });
  if (q.isPending) return <p className="text-xs text-ink-muted">Checking your other clubs…</p>;
  if (!q.data) return null;
  const { duplicatePicks, suggestions } = q.data;
  if (duplicatePicks.length === 0 && suggestions.length === 0) return null;
  return (
    <div className="space-y-2">
      {duplicatePicks.length > 0 && (
        <Alert tone="info" title={duplicatePicks.length === 1 ? "Another of your clubs has this one" : "Other clubs of yours have this one"}>
          <ul className="mt-1 space-y-0.5">
            {duplicatePicks.map((d, i) => (
              <li key={i} className="flex items-center gap-2">
                <BookOpenCheck className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
                <span>
                  {d.clubName}, {d.year}
                </span>
                <Badge>{d.status}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-muted">Only titles are shared between your clubs, never who is in them.</p>
        </Alert>
      )}
      {suggestions.length > 0 && (
        <details className="rounded-control border border-line bg-ground p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {suggestions.length} {suggestions.length === 1 ? "suggestion" : "suggestions"} from your other shelves
          </summary>
          <ul className="mt-3 space-y-3">
            {suggestions.slice(0, 5).map((s) => (
              <li key={s.edition.id}>
                <BookRow edition={s.edition} meta={s.reason} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
