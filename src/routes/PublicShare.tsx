import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { APP_TAGLINE, READING_STATUS_LABELS, SENTIMENT_LABELS } from "@shared/constants";
import type { PublicEdition, PublicShare } from "@shared/types";
import { BookCover } from "@/components/BookCover";
import { Logo } from "@/components/Logo";
import { Alert, Badge, Button, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { authorsLine, formatDate } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { MARKETING_URL } from "./auth/AuthLayout";

function EditionLine({ edition }: { edition: PublicEdition }) {
  return (
    <div className="flex items-center gap-4">
      <BookCover url={edition.coverUrl} title={edition.title} size="md" />
      <div>
        <p className="book-title text-xl">{edition.title}</p>
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
            <Badge tone="success">{SENTIMENT_LABELS[share.sentiment]}</Badge>
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
          <blockquote className="border-l-2 border-accent pl-5 font-display text-2xl leading-relaxed">{share.text}</blockquote>
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
                  <p className="book-title text-[17px]">{item.edition.title}</p>
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
            {share.clubName} · {share.items.length} books{share.goal ? ` · goal ${share.goal}` : ""}
          </p>
          <ol className="space-y-3">
            {share.items.map((item, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="w-6 text-right text-sm text-ink-muted">{i + 1}.</span>
                <BookCover url={item.edition.coverUrl} title={item.edition.title} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="book-title text-[17px]">{item.edition.title}</p>
                  <p className="text-sm text-ink-muted">{authorsLine(item.edition.authors)}</p>
                </div>
                {item.status === "completed" && <Badge tone="success">Finished</Badge>}
                {item.status === "current" && <Badge tone="brass">Reading now</Badge>}
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
  const title = q.data ? (q.data.type === "review" ? `Review: ${q.data.edition.title}` : q.data.type === "quote" ? `Quote from ${q.data.edition.title}` : q.data.title) : "Shared from Chapterr";
  useDocumentTitle(title);
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-10">
      <header className="mb-6 flex justify-center">
        <Link to="/" aria-label="Chapterr">
          <Logo variant="horizontal" className="h-10" />
        </Link>
      </header>
      <main className="flex-1 rounded-large border border-line bg-surface p-6 sm:p-8">
        {q.isPending && <Spinner />}
        {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
        {q.data && (
          <>
            <h1 className="display-l mb-6 text-balance">{title}</h1>
            <Content share={q.data} />
          </>
        )}
      </main>
      <footer className="mt-6 text-center text-xs text-ink-muted">
        Shared from Chapterr. {APP_TAGLINE}.{" "}
        <a href={MARKETING_URL} className="underline hover:text-ink" rel="noopener">
          About Chapterr
        </a>
      </footer>
    </div>
  );
}
