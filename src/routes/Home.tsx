import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardList, Clock, Flame, KeyRound, MessageCircle, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Link, Navigate } from "react-router";
import type { ClubCard as ClubCardData, HomeData, MyJoinRequest, Streak } from "@shared/types";
import { RoleChip } from "@/components/AppShell";
import { BookCover } from "@/components/BookCover";
import { BookRow } from "@/components/books";
import { streakChipText } from "@/components/growth/streak";
import { JoinCodeDialog } from "@/components/JoinCodeDialog";
import { Alert, Badge, Button, Card, cx, EmptyState, LinkButton, ProgressBar, SectionTitle, Spinner, TextLink } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { clubPath, takePendingJoin } from "@/lib/club";
import { formatDate, formatDateTime, todayIso } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

function ClubCard({ club }: { club: ClubCardData }) {
  const book = club.currentBook ?? club.currentAssignment?.edition ?? null;
  return (
    <Card as="li" className="flex gap-4 p-4 sm:p-5">
      {book && <BookCover url={book.coverUrl} title={book.title} size="md" className="hidden sm:block" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="heading-s min-w-0 truncate">
            <Link to={clubPath(club.id)} className="hover:underline">
              {club.name}
            </Link>
          </h3>
          <RoleChip role={club.role} />
        </div>
        <p className="mt-0.5 text-sm text-ink-muted">
          {club.memberCount} {club.memberCount === 1 ? "member" : "members"}
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {book && (
            <li className="truncate">
              Reading <span className="book-title">{book.title}</span>
              {club.currentAssignment ? <span className="text-ink-muted"> · due {formatDate(club.currentAssignment.dueDate)}</span> : null}
            </li>
          )}
          {club.nextMeeting && (
            <li className="flex items-center gap-1.5 text-ink-muted">
              <CalendarDays className="size-4" aria-hidden /> {club.nextMeeting.title} · {formatDateTime(club.nextMeeting.startsAt)}
            </li>
          )}
          {!book && !club.nextMeeting && <li className="text-ink-muted">Nothing scheduled yet.</li>}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <TextLink to={clubPath(club.id)}>Open club</TextLink>
          {club.unreadMessages > 0 && (
            <Link to={clubPath(club.id, "messages")} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink">
              <MessageCircle className="size-4" aria-hidden /> {club.unreadMessages} unread
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}

/** "3-day streak, log today": one chip linking to the reading log. */
function StreakChip() {
  const q = useQuery({ queryKey: ["streak"], queryFn: () => api<Streak>("/api/reading-log/streak"), retry: false });
  if (!q.data) return null;
  const s = q.data;
  return (
    <Link
      to="/reading"
      className={cx(
        "inline-flex items-center gap-1.5 rounded-chip border px-2.5 py-1 text-xs font-semibold",
        s.today ? "border-accent/40 bg-accent-soft text-ink" : "border-line bg-surface text-ink hover:bg-surface-2",
      )}
      aria-label={`${streakChipText(s)}. Open the reading log`}
    >
      <Flame className="size-3.5" aria-hidden strokeWidth={1.75} />
      {streakChipText(s)}
    </Link>
  );
}

/** Clubs the member has asked to join and is still waiting on. */
function PendingRequests() {
  const q = useQuery({ queryKey: ["join-requests", "mine"], queryFn: () => api<MyJoinRequest[] | { items: MyJoinRequest[] }>("/api/clubs/requests").then((r) => (Array.isArray(r) ? r : r.items)), retry: false, staleTime: 60_000 });
  const pending = q.data?.filter((r) => r.status === "pending") ?? [];
  if (pending.length === 0) return null;
  return (
    <Alert tone="info">
      <div className="flex flex-wrap items-center gap-2">
        <Clock className="size-4 shrink-0 text-ink-muted" aria-hidden strokeWidth={1.75} />
        <span>
          {pending.length === 1 ? (
            <>
              Your request to join <strong>{pending[0]!.club.name}</strong> is waiting for an admin.
            </>
          ) : (
            <>
              {pending.length} join requests are waiting for an admin: {pending.map((r) => r.club.name).join(", ")}.
            </>
          )}
        </span>
        <Badge tone="brass" className="ml-auto">
          Pending
        </Badge>
      </div>
    </Alert>
  );
}

export function HomePage() {
  useDocumentTitle("Home");
  const { data: session } = useSession();
  const [joining, setJoining] = useState(false);
  const [pendingJoin] = useState(takePendingJoin);
  const q = useQuery({ queryKey: ["home"], queryFn: () => api<HomeData>(`/api/home?today=${todayIso()}`) });
  const year = new Date().getFullYear();

  // A join link opened while signed out resumes here.
  if (pendingJoin) return <Navigate to={`/join/${encodeURIComponent(pendingJoin)}`} replace />;

  if (q.isPending) return <Spinner label="Opening your shelf" />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const d = q.data;
  const firstName = session?.user.name?.split(" ")[0];

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label text-ink-muted">Home</p>
          <h1 className="display-l mt-1">{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</h1>
          <div className="mt-3">
            <StreakChip />
          </div>
        </div>
        {d.clubs.length > 0 && (
          <div className="flex gap-2">
            <Button variant="secondary" icon={KeyRound} onClick={() => setJoining(true)}>
              Join with a code
            </Button>
            <LinkButton to="/clubs/new" icon={Plus}>
              Create a club
            </LinkButton>
          </div>
        )}
      </header>

      <PendingRequests />

      <section>
        <SectionTitle>Your clubs</SectionTitle>
        {d.clubs.length ? (
          <ul className="grid gap-4 lg:grid-cols-2">
            {d.clubs.map((c) => (
              <ClubCard key={c.id} club={c} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={Users} title="You're not in a club yet">
            <p>Start one for the people you read with, or join one with the code an admin sent you.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <LinkButton to="/clubs/new" icon={Plus}>
                Create a club
              </LinkButton>
              <Button variant="secondary" icon={KeyRound} onClick={() => setJoining(true)}>
                Join with a code
              </Button>
            </div>
          </EmptyState>
        )}
      </section>

      <section>
        <SectionTitle>Your reading</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Card>
            <div className="flex items-center justify-between">
              <h3 className="heading-s">{year} goal</h3>
              <TextLink to="/goals" className="text-sm">
                {d.personalGoal.target ? "Edit" : "Set goal"}
              </TextLink>
            </div>
            {d.personalGoal.target ? (
              <>
                <p className="mt-3 font-display text-4xl font-medium">
                  {d.personalGoal.completed}
                  <span className="text-lg text-ink-muted"> of {d.personalGoal.target} books</span>
                </p>
                <div className="mt-4">
                  <ProgressBar value={d.personalGoal.completed} max={d.personalGoal.target} label={`${year} reading goal`} />
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">{d.personalGoal.completed} finished so far this year.</p>
            )}
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <h3 className="heading-s">Currently reading</h3>
              <TextLink to="/books/add" className="text-sm">
                Find a book
              </TextLink>
            </div>
            {d.currentlyReading.length ? (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {d.currentlyReading.map((ub) => (
                  <li key={ub.id}>
                    <BookRow
                      edition={ub.edition}
                      meta={
                        ub.progressPercent != null || ub.currentPage != null ? (
                          <span>
                            {ub.progressPercent != null ? `${ub.progressPercent}%` : `page ${ub.currentPage}`}
                            {ub.edition.pageCount && ub.currentPage ? ` of ${ub.edition.pageCount}` : ""}
                          </span>
                        ) : (
                          "Just started"
                        )
                      }
                    />
                    {ub.progressPercent != null && (
                      <div className="mt-2">
                        <ProgressBar value={ub.progressPercent} max={100} label={`Progress in ${ub.edition.title}`} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">
                Nothing on the go. <TextLink to="/library?status=tbr">Pick something from your to-read shelf</TextLink>.
              </p>
            )}
          </Card>
        </div>
      </section>

      {d.clubs.some((c) => c.currentAssignment) && (
        <section>
          <SectionTitle>Due soon</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {d.clubs
                .filter((c) => c.currentAssignment)
                .map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                    <ClipboardList className="size-4 shrink-0 text-ink-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <BookRow edition={c.currentAssignment!.edition} meta={`${c.name} · due ${formatDate(c.currentAssignment!.dueDate)}`} />
                    </div>
                  </li>
                ))}
            </ul>
          </Card>
        </section>
      )}

      <JoinCodeDialog open={joining} onClose={() => setJoining(false)} />
    </div>
  );
}
