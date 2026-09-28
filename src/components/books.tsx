import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { BOOK_FORMATS } from "@shared/constants";
import { manualEditionSchema, type ManualEditionInput } from "@shared/schemas";
import type { BookSearchResponse, CatalogResult, EditionDetail, EditionSummary } from "@shared/types";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { authorsLine } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { BookCover } from "./BookCover";
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from "./ui";
import { Dialog } from "./ui/Dialog";
import { useToast } from "./ui/Toast";

export function BookRow({ edition, meta, action, link = true }: { edition: EditionSummary; meta?: ReactNode; action?: ReactNode; link?: boolean }) {
  const title = (
    <>
      <span className="font-medium">{edition.title}</span>
      {edition.subtitle && <span className="text-ink-muted">: {edition.subtitle}</span>}
    </>
  );
  return (
    <div className="flex items-center gap-3">
      <BookCover url={edition.coverUrl} title={edition.title} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm">
          {link ? (
            <Link to={`/books/${edition.id}`} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </p>
        <p className="truncate text-xs text-ink-muted">
          {authorsLine(edition.authors)}
          {edition.publishedYear ? ` · ${edition.publishedYear}` : ""}
          {edition.format !== "unknown" ? ` · ${edition.format}` : ""}
        </p>
        {meta && <div className="mt-1 text-xs text-ink-muted">{meta}</div>}
      </div>
      {action}
    </div>
  );
}

const formatLabels: Record<(typeof BOOK_FORMATS)[number], string> = {
  hardcover: "Hardcover",
  paperback: "Paperback",
  ebook: "Ebook",
  audiobook: "Audiobook",
  other: "Other",
  unknown: "Unknown",
};

export function EditionForm({
  defaultValues,
  onSubmit,
  submitLabel,
}: {
  defaultValues?: Partial<ManualEditionInput>;
  onSubmit: (values: ManualEditionInput) => Promise<void>;
  submitLabel: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ title: string; subtitle: string; authors: string; isbn: string; publisher: string; publishedDate: string; pageCount: string; format: string; language: string; description: string; coverUrl: string }>({
    defaultValues: {
      title: defaultValues?.title ?? "",
      subtitle: (defaultValues?.subtitle as string) ?? "",
      authors: (defaultValues?.authors ?? []).join(", "),
      isbn: (defaultValues?.isbn as string) ?? "",
      publisher: (defaultValues?.publisher as string) ?? "",
      publishedDate: (defaultValues?.publishedDate as string) ?? "",
      pageCount: defaultValues?.pageCount ? String(defaultValues.pageCount) : "",
      format: defaultValues?.format ?? "unknown",
      language: (defaultValues?.language as string) ?? "",
      description: (defaultValues?.description as string) ?? "",
      coverUrl: (defaultValues?.coverUrl as string) ?? "",
    },
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = form.handleSubmit(async (raw) => {
    setError(null);
    const candidate = { ...raw, authors: raw.authors.split(",").map((a) => a.trim()).filter(Boolean) };
    const parsed = manualEditionSchema.safeParse(candidate);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    try {
      await onSubmit(candidate as ManualEditionInput);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Field label="Title" error={fieldErrors.title}>
        {(id) => <Input id={id} {...form.register("title")} />}
      </Field>
      <Field label="Subtitle" error={fieldErrors.subtitle}>
        {(id) => <Input id={id} {...form.register("subtitle")} />}
      </Field>
      <Field label="Authors" hint="Separate multiple authors with commas." error={fieldErrors.authors}>
        {(id, d) => <Input id={id} aria-describedby={d} {...form.register("authors")} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ISBN (13 or 10)" error={fieldErrors.isbn}>
          {(id) => <Input id={id} inputMode="numeric" {...form.register("isbn")} />}
        </Field>
        <Field label="Format" error={fieldErrors.format}>
          {(id) => (
            <Select id={id} {...form.register("format")}>
              {BOOK_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {formatLabels[f]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Publisher" error={fieldErrors.publisher}>
          {(id) => <Input id={id} {...form.register("publisher")} />}
        </Field>
        <Field label="Published" hint="Year or date" error={fieldErrors.publishedDate}>
          {(id, d) => <Input id={id} aria-describedby={d} {...form.register("publishedDate")} />}
        </Field>
        <Field label="Pages" error={fieldErrors.pageCount}>
          {(id) => <Input id={id} inputMode="numeric" {...form.register("pageCount")} />}
        </Field>
        <Field label="Language" error={fieldErrors.language}>
          {(id) => <Input id={id} placeholder="en" {...form.register("language")} />}
        </Field>
      </div>
      <Field label="Cover image URL" hint="Optional https:// link to a cover image." error={fieldErrors.coverUrl}>
        {(id, d) => <Input id={id} aria-describedby={d} {...form.register("coverUrl")} />}
      </Field>
      <Field label="Description" error={fieldErrors.description}>
        {(id) => <Textarea id={id} {...form.register("description")} />}
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={form.formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}

/**
 * Search the club catalogue and the free book catalogues (Open Library /
 * Google Books), then return the chosen edition, creating it if needed.
 */
export function BookPicker({ onPick, pickLabel = "Choose" }: { onPick: (edition: EditionSummary) => void; pickLabel?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [manual, setManual] = useState(false);
  const debounced = useDebounced(q.trim(), 450);
  const search = useQuery({
    queryKey: ["book-search", debounced],
    queryFn: ({ signal }) => api<BookSearchResponse>(`/api/books/search?q=${encodeURIComponent(debounced)}`, { signal }),
    enabled: debounced.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
  const add = useMutation({
    mutationFn: (hit: CatalogResult) =>
      api<EditionDetail>("/api/books/editions/provider", {
        body: {
          provider: hit.provider,
          providerId: hit.providerId,
          // Lets the server save the book instantly; it fills in the rest in the background.
          hint: {
            title: hit.title,
            subtitle: hit.subtitle,
            authors: hit.authors,
            isbn13: hit.isbn13,
            isbn10: hit.isbn10,
            publisher: hit.publisher,
            publishedYear: hit.publishedYear,
            pageCount: hit.pageCount,
            coverUrl: hit.coverUrl,
            format: hit.format,
          },
        },
      }),
    onSuccess: (edition) => {
      void qc.invalidateQueries({ queryKey: ["book-search"] });
      onPick(edition);
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  const local = search.data?.local ?? [];
  const localIds = new Set(local.map((l) => l.id));
  const catalog = (search.data?.catalog ?? []).filter((c) => !c.existingEditionId || !localIds.has(c.existingEditionId));

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
        <Input
          type="search"
          aria-label="Search by title, author or ISBN"
          placeholder="Title, author or ISBN"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
          autoFocus
        />
      </div>
      {search.isFetching && <Spinner label="Searching" />}
      {search.data?.providerError && <Alert tone="warning">{search.data.providerError}</Alert>}
      {local.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Already in the club catalogue</h3>
          <ul className="space-y-2">
            {local.map((e) => (
              <li key={e.id}>
                <BookRow edition={e} link={false} action={<Button size="sm" variant="secondary" icon={Check} onClick={() => onPick(e)}>{pickLabel}</Button>} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {catalog.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            From {search.data?.provider === "google_books" ? "Google Books" : "Open Library"}
          </h3>
          <ul className="space-y-2">
            {catalog.map((hit) => (
              <li key={`${hit.provider}-${hit.providerId}`}>
                <BookRow
                  link={false}
                  edition={{
                    id: hit.providerId,
                    bookId: "",
                    title: hit.title,
                    subtitle: hit.subtitle,
                    authors: hit.authors,
                    coverUrl: hit.coverUrl,
                    isbn13: hit.isbn13,
                    publishedYear: hit.publishedYear,
                    format: hit.format,
                    pageCount: hit.pageCount,
                  }}
                  meta={hit.isbn13 ? `ISBN ${hit.isbn13}${hit.publisher ? ` · ${hit.publisher}` : ""}` : hit.publisher}
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={Plus}
                      loading={add.isPending && add.variables?.providerId === hit.providerId}
                      onClick={() => add.mutate(hit)}
                    >
                      {pickLabel}
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {debounced.length >= 2 && search.isSuccess && local.length === 0 && catalog.length === 0 && !search.data.providerError && (
        <p className="text-sm text-ink-muted">No matches found.</p>
      )}
      <div className="border-t border-line pt-3">
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => setManual(true)}>
          Can't find it? Add a book manually
        </Button>
      </div>
      <Dialog open={manual} onClose={() => setManual(false)} title="Add a book manually" wide>
        <EditionForm
          submitLabel="Add book"
          defaultValues={{ title: q }}
          onSubmit={async (values) => {
            try {
              const edition = await api<EditionDetail>("/api/books/editions", { body: values });
              setManual(false);
              onPick(edition);
            } catch (err) {
              if (err instanceof ApiRequestError && err.code === "duplicate_isbn" && err.current && typeof err.current === "object") {
                const existing = await api<{ edition: EditionDetail }>(`/api/books/editions/${(err.current as { id: string }).id}`);
                setManual(false);
                toast("That ISBN is already in the catalogue — using the existing edition.");
                onPick(existing.edition);
                return;
              }
              throw err;
            }
          }}
        />
      </Dialog>
    </div>
  );
}
