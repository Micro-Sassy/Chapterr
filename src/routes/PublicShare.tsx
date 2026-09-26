import { useQuery } from "@tanstack/react-query";
import { BookMarked, Quote as QuoteIcon } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { READING_STATUS_LABELS, SENTIMENT_LABELS } from "@shared/constants";
import type { PublicEdition, PublicShare } from "@shared/types";
import { BookCover } from "@/components/BookCover";
import { Alert, Badge, Button, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { authorsLine, formatDate } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

function EditionLine({ edition }: { edition: PublicEdition }) {
  return (
    <div className="flex items-center gap-3">
      <BookCover url={edition.coverUrl} title={edition.title} size="md" />
      <div>
        <p className="font-serif text-lg font-semibold">{edition.title}</p>
        {edition.subtitle && <p className="text-sm text-ink-muted">{edition.subtitle}</p>}
        <p className="text-sm text-ink-muted">{authorsLine(edition.authors)}</p>
        {edition.isbn13 && <p className="text-xs text-ink-muted">ISBN {edition.isbn13}</p>}
      </div>
    </div>
  );
}

function Content({ share }: { share: PublicShare }) {
  const [showSpoilers, setShowSpoilers] = useState(false);
  switch (share.type) {
    case "review":
      return (
        <article className="space-y-4">
          <EditionLine edition={share.edition} />
          <div className="flex items-center gap-2">
            <Badge tone="accent">{SENTIMENT_LABELS[share.sentiment]}</Badge>
            <span className="text-sm text-ink-muted">
              Review by {share.author} · {formatDate(share.createdAt)}
            </span>
          </div>
          {share.containsSpoilers && !showSpoilers ? (
            <Alert tone="warning" title="This review contains spoilers">
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => setShowSpoilers(true)}>
                Show review
              </Button>
            </Alert>
          ) : (
            <p className="whitespace-pre-wrap leading-relaxed">{share.body || "(No written review)"}</p>
          )}
        </article>
      );
    case "quote":
      return (
        <article className="space-y-4">
          <blockquote className="relative border-l-4 border-accent pl-4 font-serif text-xl leading-relaxed">
            <QuoteIcon className="absolute -left-1 -top-6 size-5 text-accent" aria-hidden />
            {share.text}
          </blockquote>
          <p className="text-sm text-ink-muted">
            Saved by {share.author}
            {share.location ? ` · ${share.location}` : ""}
          </p>
          <EditionLine edition={share.edition} />
        </article>
      );
    case "reading_list":
      return (
        <div>
          <p className="mb-4 text-sm text-ink-muted">
            {share.owner}'s list · {share.items.length} books
          </p>
          <ul className="space-y-3">
            {share.items.map((item, i) => (
              <li key={i} className="flex items-center gap-3">
                <BookCover url={item.edition.coverUrl} title={item.edition.title} size="sm" />
                <div>
                  <p className="font-medium">{item.edition.title}</p>
                  <p className="text-sm text-ink-muted">{authorsLine(item.edition.authors)}</p>
                  <p className="text-xs text-ink-muted">
                    {READING_STATUS_LABELS[item.status]}
                    {item.finishedAt ? ` · ${formatDate(item.finishedAt)}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      );
    case "club_list":
      return (
        <div>
          <p className="mb-4 text-sm text-ink-muted">
            {share.items.length} books{share.goal ? ` · goal: ${share.goal}` : ""}
          </p>
          <ol className="space-y-3">
            {share.items.map((item, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="w-6 text-right text-sm text-ink-muted">{i + 1}.</span>
                <BookCover url={item.edition.coverUrl} title={item.edition.title} size="sm" />
                <div>
                  <p className="font-medium">{item.edition.title}</p>
                  <p className="text-sm text-ink-muted">{authorsLine(item.edition.authors)}</p>
                </div>
                {item.status === "completed" && <Badge tone="accent">Read</Badge>}
                {item.status === "current" && <Badge tone="highlight">Reading now</Badge>}
              </li>
            ))}
          </ol>
        </div>
      );
  }
}

/** Intentionally public page: renders only what a share link exposes. No chat content is ever reachable here. */
export function PublicSharePage() {
  const { token = "" } = useParams();
  const q = useQuery({ queryKey: ["public-share", token], queryFn: () => api<PublicShare>(`/api/public/shares/${encodeURIComponent(token)}`), retry: false });
  const title = q.data ? (q.data.type === "review" ? `Review: ${q.data.edition.title}` : q.data.type === "quote" ? `Quote from ${q.data.edition.title}` : q.data.title) : "Shared from Teel Ridge";
  useDocumentTitle(title);
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-10">
      <header className="mb-6 flex items-center gap-2">
        <BookMarked className="size-6 text-accent" aria-hidden />
        <span className="font-serif text-lg font-semibold">Teel Ridge Book Club</span>
      </header>
      <main className="flex-1 rounded-2xl border border-line bg-surface p-6">
        {q.isPending && <Spinner />}
        {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
        {q.data && (
          <>
            <h1 className="mb-5 text-2xl font-semibold">{title}</h1>
            <Content share={q.data} />
          </>
        )}
      </main>
      <footer className="mt-6 text-center text-xs text-ink-muted">Shared by a member of a private book club.</footer>
    </div>
  );
}
