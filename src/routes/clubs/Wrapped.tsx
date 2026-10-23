import { useQuery } from "@tanstack/react-query";
import { Download, Gift, Share2 } from "lucide-react";
import { useState } from "react";
import type { ClubBranding, ClubWrapped, MonthlyRecap } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { BookCover } from "@/components/BookCover";
import { BookRow } from "@/components/books";
import { clubApi } from "@/components/records";
import { canShareFiles, downloadBlob, drawClubWrapped, loadImage, monthLabel, renderToBlob, shareBlob, SQUARE, STORY } from "@/components/recap/canvas";
import { RecapCard } from "@/components/recap/RecapCard";
import { Alert, Button, Card, EmptyState, Field, PageHeader, SectionTitle, Select, Spinner } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { useClub } from "@/lib/club";
import { coverSrc } from "@/lib/covers";
import { useDocumentTitle } from "@/lib/hooks";

function BigNumber({ value, label }: { value: string | number; label: string }) {
  return (
    <Card className="p-5">
      <p className="font-display text-5xl font-semibold leading-none">{value}</p>
      <p className="mt-2 text-sm text-ink-muted">{label}</p>
    </Card>
  );
}

export function WrappedPage() {
  const club = useClub();
  useDocumentTitle(`Club Wrapped · ${club.name}`);
  const toast = useToast();
  const branding = (club as typeof club & { branding?: ClubBranding }).branding;
  const thisYear = new Date().getFullYear();
  const firstYear = new Date(club.createdAt).getFullYear();
  const years = Array.from({ length: Math.max(1, thisYear - firstYear + 1) }, (_, i) => thisYear - i);
  const [year, setYear] = useState(thisYear);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapped = useQuery({ queryKey: ["wrapped", club.id, year], queryFn: () => api<ClubWrapped>(clubApi(club.id, `/recaps/wrapped?year=${year}`)) });
  const month = new Date().toISOString().slice(0, 7);
  const [recapMonth, setRecapMonth] = useState(month);
  const recap = useQuery({ queryKey: ["recap", "club", club.id, recapMonth], queryFn: () => api<MonthlyRecap>(clubApi(club.id, `/recaps/monthly?month=${recapMonth}`)) });

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const build = async (size: typeof STORY | typeof SQUARE) => {
    const w = wrapped.data!;
    const cover = await loadImage(coverSrc(w.mostLovedBook?.edition.coverUrl ?? w.booksRead[0]?.coverUrl));
    return renderToBlob(size, (ctx) => drawClubWrapped(ctx, w, { accent: branding?.accentColor, cover }, size));
  };
  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the image.");
    } finally {
      setBusy(null);
    }
  };
  const w = wrapped.data;
  const empty = w && w.booksRead.length === 0 && w.meetings === 0 && w.pagesRead === 0;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={club.name}
        title={`Club Wrapped ${year}`}
        description="The year on one shelf: what we read, who showed up, what we argued about."
        actions={
          <Field label="Year" className="w-32">
            {(id) => (
              <Select id={id} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        }
      />
      {wrapped.isPending && <Spinner label="Gathering the year" />}
      {wrapped.isError && <Alert tone="error">{errorMessage(wrapped.error)}</Alert>}
      {w && empty && (
        <EmptyState icon={Gift} title={`Nothing to wrap for ${year} yet`}>
          Finish a book together or hold a meeting and this page fills in.
        </EmptyState>
      )}
      {w && !empty && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button icon={Download} loading={busy === "story"} onClick={() => act("story", async () => downloadBlob(await build(STORY), `chapterr-wrapped-${year}-story.png`))}>
              Download story
            </Button>
            <Button variant="secondary" icon={Download} loading={busy === "square"} onClick={() => act("square", async () => downloadBlob(await build(SQUARE), `chapterr-wrapped-${year}.png`))}>
              Download square
            </Button>
            {canShareFiles() && (
              <Button
                variant="secondary"
                icon={Share2}
                loading={busy === "share"}
                onClick={() =>
                  act("share", async () => {
                    const ok = await shareBlob(await build(STORY), `chapterr-wrapped-${year}.png`, `${club.name}: Club Wrapped ${year}`);
                    if (!ok) toast("Sharing is not available here. Download the image instead.", "error");
                  })
                }
              >
                Share
              </Button>
            )}
          </div>
          {error && <Alert tone="error">{error}</Alert>}

          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <BigNumber value={w.booksRead.length} label={w.booksRead.length === 1 ? "book read together" : "books read together"} />
            <BigNumber value={w.pagesRead.toLocaleString()} label="pages between us" />
            <BigNumber value={w.meetings} label={w.meetings === 1 ? "meeting" : "meetings"} />
            <BigNumber value={w.attendanceRate == null ? "–" : `${Math.round(w.attendanceRate * 100)}%`} label="attendance" />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            {w.mostLovedBook && (
              <Card className="flex gap-4">
                <BookCover url={w.mostLovedBook.edition.coverUrl} title={w.mostLovedBook.edition.title} size="md" />
                <div>
                  <p className="label text-ink-muted">Most loved</p>
                  <p className="book-title mt-1 text-2xl">{w.mostLovedBook.edition.title}</p>
                  <p className="text-sm text-ink-muted">{w.mostLovedBook.edition.authors.join(", ")}</p>
                  <p className="mt-2 text-sm">
                    {w.mostLovedBook.loved} {w.mostLovedBook.loved === 1 ? "member" : "members"} loved it.
                  </p>
                </div>
              </Card>
            )}
            {w.topReviewer && (
              <Card className="flex items-center gap-4">
                <Avatar member={w.topReviewer.member} size="lg" />
                <div>
                  <p className="label text-ink-muted">Top reviewer</p>
                  <p className="heading-m mt-1">{w.topReviewer.member.displayName}</p>
                  <p className="text-sm text-ink-muted">
                    {w.topReviewer.reviews} {w.topReviewer.reviews === 1 ? "review" : "reviews"} this year
                  </p>
                </div>
              </Card>
            )}
            {w.longestStreak && (
              <Card className="flex items-center gap-4">
                <Avatar member={w.longestStreak.member} size="lg" />
                <div>
                  <p className="label text-ink-muted">Longest streak</p>
                  <p className="heading-m mt-1">{w.longestStreak.member.displayName}</p>
                  <p className="text-sm text-ink-muted">
                    {w.longestStreak.days} {w.longestStreak.days === 1 ? "day" : "days"} in a row
                  </p>
                </div>
              </Card>
            )}
            {w.busiestMonth && (
              <Card>
                <p className="label text-ink-muted">Busiest month</p>
                <p className="heading-m mt-1">{monthLabel(w.busiestMonth.month)}</p>
                <p className="text-sm text-ink-muted">{w.busiestMonth.messages.toLocaleString()} messages in the club chat</p>
              </Card>
            )}
            {w.mostReacted && (
              <Card className="md:col-span-2">
                <p className="label text-ink-muted">Most reacted message</p>
                <blockquote className="mt-2 border-l-2 border-accent pl-4 font-display text-xl leading-relaxed">{w.mostReacted.excerpt}</blockquote>
                <p className="mt-2 text-sm text-ink-muted">
                  {w.mostReacted.author?.displayName ?? "A former member"} · {w.mostReacted.reactions} reactions
                </p>
              </Card>
            )}
            <Card>
              <p className="label text-ink-muted">Polls</p>
              <p className="heading-m mt-1">
                {w.polls.held} {w.polls.held === 1 ? "poll" : "polls"}
              </p>
              <p className="text-sm text-ink-muted">{w.polls.votesCast.toLocaleString()} votes cast</p>
            </Card>
            <Card>
              <p className="label text-ink-muted">Members</p>
              <p className="heading-m mt-1">{w.members}</p>
              <p className="text-sm text-ink-muted">on the shelf at year end</p>
            </Card>
          </section>

          {w.booksRead.length > 0 && (
            <section>
              <SectionTitle as="h2">The shelf</SectionTitle>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {w.booksRead.map((b) => (
                  <li key={b.id}>
                    <Card className="p-3 sm:p-4">
                      <BookRow edition={b} />
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="space-y-4">
        <SectionTitle
          as="h2"
          action={
            <Select aria-label="Recap month" className="h-9 w-auto text-sm" value={recapMonth} onChange={(e) => setRecapMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </Select>
          }
        >
          Monthly recap
        </SectionTitle>
        {recap.isPending && <Spinner />}
        {recap.isError && <Alert tone="error">{errorMessage(recap.error)}</Alert>}
        {recap.data && <RecapCard recap={recap.data} subject={club.name} accent={branding?.accentColor} title="Club recap" />}
      </section>
    </div>
  );
}
