import { useQuery } from "@tanstack/react-query";
import { Plus, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { READING_STATUSES, READING_STATUS_LABELS, type ReadingStatus } from "@shared/constants";
import type { UserBook } from "@shared/types";
import { BookRow } from "@/components/books";
import { ShareDialog, VisibilityBadge } from "@/components/content";
import { Alert, Button, Card, EmptyState, Input, PageHeader, ProgressBar, Spinner, Tabs } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

export function LibraryPage() {
  useDocumentTitle("My library");
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as ReadingStatus | null) ?? "reading";
  const [filter, setFilter] = useState("");
  const [sharing, setSharing] = useState(false);
  const q = useQuery({ queryKey: ["library"], queryFn: () => api<UserBook[]>("/api/library") });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of q.data ?? []) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [q.data]);

  const items = (q.data ?? [])
    .filter((b) => b.status === status)
    .filter((b) => !filter || `${b.edition.title} ${b.edition.authors.join(" ")}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) =>
      status === "finished" ? (b.finishedAt ?? "").localeCompare(a.finishedAt ?? "") : b.updatedAt.localeCompare(a.updatedAt),
    );

  return (
    <div>
      <PageHeader
        title="My library"
        description="Your TBR, current reads and finished books."
        actions={
          <>
            <Button variant="secondary" icon={Share2} onClick={() => setSharing(true)}>
              Share list
            </Button>
            <Link to="/books/add" className="inline-flex h-10 items-center gap-2 rounded-[var(--radius)] bg-accent px-4 text-sm font-medium text-on-accent">
              <Plus className="size-4" aria-hidden /> Add book
            </Link>
          </>
        }
      />
      <Tabs
        label="Reading status"
        value={status}
        onChange={(s) => setParams({ status: s })}
        tabs={READING_STATUSES.map((s) => ({ value: s, label: READING_STATUS_LABELS[s], count: counts[s] ?? 0 }))}
      />
      <Input type="search" placeholder="Filter by title or author" aria-label="Filter library" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-4 max-w-sm" />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.isSuccess && items.length === 0 && (
        <EmptyState title={`Nothing in “${READING_STATUS_LABELS[status]}”`} action={<Link to="/books/add" className="text-sm text-accent underline">Find a book</Link>}>
          You can also import your Goodreads library from Settings.
        </EmptyState>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((b) => (
          <li key={b.id}>
            <Card className="p-3">
              <BookRow
                edition={b.edition}
                meta={
                  <span className="flex flex-wrap items-center gap-2">
                    {b.status === "finished" && b.finishedAt && <span>Finished {formatDate(b.finishedAt)}</span>}
                    {b.status === "reading" && b.startedAt && <span>Started {formatDate(b.startedAt)}</span>}
                    <VisibilityBadge visibility={b.visibility} />
                  </span>
                }
              />
              {b.status === "reading" && b.progressPercent != null && (
                <div className="mt-2">
                  <ProgressBar value={b.progressPercent} max={100} label={`Progress in ${b.edition.title}`} />
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <ShareDialog
        open={sharing}
        onClose={() => setSharing(false)}
        input={{ resourceType: "reading_list", status }}
        label={`your “${READING_STATUS_LABELS[status]}” list (club-visible books only)`}
      />
    </div>
  );
}
