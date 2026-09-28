import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardList, MessageCircle, Plus, Target } from "lucide-react";
import { Link } from "react-router";
import type { DashboardData } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { BookCover } from "@/components/BookCover";
import { BookRow } from "@/components/books";
import { Alert, Card, EmptyState, ProgressBar, SectionTitle, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { formatDate, formatDateTime, relativeTime, todayIso } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

function GoalCard({ title, done, target, link }: { title: string; done: number; target: number | null; link: string }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Target className="size-4 text-accent" aria-hidden />
          {title}
        </h2>
        <Link to={link} className="text-xs text-accent underline">
          {target ? "Edit" : "Set goal"}
        </Link>
      </div>
      {target ? (
        <>
          <p className="mt-3 font-serif text-3xl font-semibold">
            {done}
            <span className="text-lg text-ink-muted"> / {target} books</span>
          </p>
          <div className="mt-3">
            <ProgressBar value={done} max={target} label={title} />
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">{done} finished so far. No goal set yet.</p>
      )}
    </Card>
  );
}

export function DashboardPage() {
  useDocumentTitle("Home");
  const { data: session } = useSession();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardData>(`/api/dashboard?today=${todayIso()}`) });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const d = q.data;
  const year = new Date().getFullYear();
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-ink-muted">Welcome back,</p>
        <h1 className="text-3xl font-semibold">{session?.user.name}</h1>
      </header>

      {d.unreadMessages > 0 && (
        <Link to="/messages" className="flex items-center gap-2 rounded-[var(--radius)] border border-highlight/40 bg-highlight-soft px-4 py-3 text-sm">
          <MessageCircle className="size-4 text-highlight" aria-hidden />
          You have {d.unreadMessages} unread message{d.unreadMessages === 1 ? "" : "s"}.
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <GoalCard title={`My ${year} goal`} done={d.personalGoal.completed} target={d.personalGoal.target} link="/goals" />
        <GoalCard title={`Club ${year} goal`} done={d.clubCompleted} target={d.clubGoal?.target ?? null} link="/club" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>
            <span className="flex items-center gap-2">
              <CalendarDays className="size-4 text-accent" aria-hidden /> Next meeting
            </span>
          </SectionTitle>
          {d.nextMeeting ? (
            <div className="space-y-2">
              <p className="font-medium">{d.nextMeeting.title}</p>
              <p className="text-sm text-ink-muted">
                {formatDateTime(d.nextMeeting.startsAt)}
                {d.nextMeeting.location ? ` · ${d.nextMeeting.location}` : ""}
              </p>
              {d.nextMeeting.edition && <BookRow edition={d.nextMeeting.edition} />}
              <Link to="/club/meetings" className="text-sm text-accent underline">
                All meetings
              </Link>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Nothing scheduled. <Link to="/club/meetings" className="text-accent underline">Plan one</Link>
            </p>
          )}
        </Card>
        <Card>
          <SectionTitle>
            <span className="flex items-center gap-2">
              <ClipboardList className="size-4 text-accent" aria-hidden /> Current assignments
            </span>
          </SectionTitle>
          {d.currentAssignments.length ? (
            <ul className="space-y-3">
              {d.currentAssignments.map((a) => (
                <li key={a.id}>
                  <BookRow edition={a.edition} meta={`${a.readingScope ? `${a.readingScope} · ` : ""}due ${formatDate(a.dueDate)}`} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">
              No open assignments. <Link to="/club" className="text-accent underline">Add one</Link>
            </p>
          )}
        </Card>
      </div>

      <section>
        <SectionTitle
          action={
            <Link to="/books/add" className="inline-flex items-center gap-1 text-sm text-accent underline">
              <Plus className="size-4" aria-hidden /> Add a book
            </Link>
          }
        >
          Currently reading
        </SectionTitle>
        {d.currentlyReading.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {d.currentlyReading.map((ub) => (
              <li key={ub.id}>
                <Card className="p-3">
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
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Not reading anything right now" action={<Link to="/library" className="text-sm text-accent underline">Pick something from your TBR</Link>} />
        )}
      </section>

      <section>
        <SectionTitle>Club activity</SectionTitle>
        {d.activity.length ? (
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {d.activity.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar member={a.actor} />
                  <p className="min-w-0 flex-1 text-sm">
                    <Link to={`/members/${a.actor.username}`} className="font-medium hover:underline">
                      {a.actor.displayName}
                    </Link>{" "}
                    {a.summary}{" "}
                    {a.edition && (
                      <Link to={a.link} className="font-medium italic hover:underline">
                        {a.edition.title}
                      </Link>
                    )}
                    <span className="block text-xs text-ink-muted">{relativeTime(a.createdAt)}</span>
                  </p>
                  {a.edition && <BookCover url={a.edition.coverUrl} title={a.edition.title} size="xs" />}
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title="It's quiet here">Add books, reviews and quotes and they will show up for the club.</EmptyState>
        )}
      </section>
    </div>
  );
}
