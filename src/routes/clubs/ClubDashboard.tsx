import { useQuery } from "@tanstack/react-query";
import { BookPlus, CalendarDays, ClipboardList, MessageCircle, Target, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ClubDashboard } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { BookCover } from "@/components/BookCover";
import { BookRow } from "@/components/books";
import { MemberLink } from "@/components/content";
import { InviteCreator } from "@/components/InviteCreator";
import { Alert, Badge, Card, EmptyState, IconButton, LinkButton, ProgressBar, SectionTitle, Spinner, TextLink } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { clubPath, isAdmin, useClub } from "@/lib/club";
import { formatDate, formatDateTime, relativeTime, todayIso } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

const ONBOARDED_KEY = (id: string) => `chapterr:onboarded:${id}`;

/** Three next steps for a brand-new club. */
function OnboardingCard({ d, onDismiss }: { d: ClubDashboard; onDismiss: () => void }) {
  const club = d.club;
  const steps = [
    { done: d.memberCount > 1, icon: UserPlus, title: "Invite your members", body: "Create a join link and send it to the people you read with." },
    { done: d.currentBooks.length > 0, icon: BookPlus, title: "Add this year's first book", body: "Start the club's reading list.", to: clubPath(club.id, "list") },
    { done: !!d.nextMeeting, icon: CalendarDays, title: "Plan a meeting", body: "Pick a date, a place and a book to talk about.", to: clubPath(club.id, "meetings") },
  ];
  return (
    <Card className="relative">
      <IconButton icon={X} label="Dismiss" className="absolute right-3 top-3" onClick={onDismiss} />
      <p className="label text-ink-muted">Getting started</p>
      <h2 className="heading-m mt-1">Welcome to {club.name}</h2>
      <ol className="mt-5 grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.title} className="flex flex-col gap-2 rounded-control border border-line p-4">
            <div className="flex items-center gap-2">
              <s.icon className="size-5 text-ink-muted" aria-hidden strokeWidth={1.75} />
              <h3 className="heading-s">{s.title}</h3>
              {s.done && <Badge tone="success">Done</Badge>}
            </div>
            <p className="text-sm text-ink-muted">{s.body}</p>
            {s.to ? (
              <LinkButton to={s.to} variant="secondary" size="sm" className="mt-auto self-start">
                {s.done ? "Open" : "Start"}
              </LinkButton>
            ) : (
              !s.done && <div className="mt-1">{isAdmin(club) ? <InviteCreator clubId={club.id} clubName={club.name} compact /> : <p className="text-sm text-ink-muted">An admin can create a join link.</p>}</div>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function ClubDashboardPage() {
  const club = useClub();
  useDocumentTitle(club.name);
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["club-dashboard", club.id], queryFn: () => api<ClubDashboard>(`/api/clubs/${club.id}/dashboard?today=${todayIso()}`) });
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDED_KEY(club.id)) === "1";
    } catch {
      return false;
    }
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const d = q.data;
  const year = new Date().getFullYear();
  const brandNew = d.memberCount <= 1 && d.currentBooks.length === 0 && !d.nextMeeting;
  const showOnboarding = !dismissed && (params.get("welcome") === "1" || brandNew);
  const dismiss = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY(club.id), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
    if (params.has("welcome")) setParams({}, { replace: true });
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="label text-ink-muted">Club</p>
          <h1 className="display-l mt-1 text-balance">{club.name}</h1>
          {club.description && <p className="mt-2 max-w-prose text-ink-muted">{club.description}</p>}
          <p className="mt-2 text-sm text-ink-muted">
            <Link to={clubPath(club.id, "members")} className="hover:underline">
              {d.memberCount} {d.memberCount === 1 ? "member" : "members"}
            </Link>
          </p>
        </div>
        {d.unreadMessages > 0 && (
          <LinkButton to={clubPath(club.id, "messages")} variant="secondary" icon={MessageCircle}>
            {d.unreadMessages} unread
          </LinkButton>
        )}
      </header>

      {showOnboarding && <OnboardingCard d={d} onDismiss={dismiss} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="heading-s flex items-center gap-2">
              <Target className="size-4 text-ink-muted" aria-hidden /> {year} club goal
            </h2>
            <TextLink to={clubPath(club.id, "list")} className="text-sm">
              {d.clubGoal ? "Edit" : "Set goal"}
            </TextLink>
          </div>
          {d.clubGoal ? (
            <>
              <p className="mt-3 font-display text-4xl font-medium">
                {d.clubCompleted}
                <span className="text-lg text-ink-muted"> of {d.clubGoal.target}</span>
              </p>
              <div className="mt-4">
                <ProgressBar value={d.clubCompleted} max={d.clubGoal.target} label="Club goal progress" />
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">{d.clubCompleted} finished together so far.</p>
          )}
        </Card>
        <Card>
          <h2 className="heading-s flex items-center gap-2">
            <CalendarDays className="size-4 text-ink-muted" aria-hidden /> Next meeting
          </h2>
          {d.nextMeeting ? (
            <div className="mt-3 space-y-2">
              <p className="font-medium">{d.nextMeeting.title}</p>
              <p className="text-sm text-ink-muted">
                {formatDateTime(d.nextMeeting.startsAt)}
                {d.nextMeeting.location ? ` · ${d.nextMeeting.location}` : ""}
              </p>
              {d.nextMeeting.edition && <BookRow edition={d.nextMeeting.edition} />}
              <TextLink to={clubPath(club.id, "meetings")} className="text-sm">
                All meetings
              </TextLink>
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              Nothing scheduled. <TextLink to={clubPath(club.id, "meetings")}>Plan one</TextLink>
            </p>
          )}
        </Card>
        <Card>
          <h2 className="heading-s flex items-center gap-2">
            <ClipboardList className="size-4 text-ink-muted" aria-hidden /> Reading now
          </h2>
          {d.currentAssignments.length ? (
            <ul className="mt-3 space-y-3">
              {d.currentAssignments.map((a) => (
                <li key={a.id}>
                  <BookRow edition={a.edition} meta={`${a.readingScope ? `${a.readingScope} · ` : ""}due ${formatDate(a.dueDate)}`} />
                </li>
              ))}
            </ul>
          ) : d.currentBooks.length ? (
            <ul className="mt-3 space-y-3">
              {d.currentBooks.map((b) => (
                <li key={b.id}>
                  <BookRow edition={b.edition} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              No current book. <TextLink to={clubPath(club.id, "list")}>Add one</TextLink>
            </p>
          )}
        </Card>
      </div>

      <section>
        <SectionTitle>Recent activity</SectionTitle>
        {d.activity.length ? (
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {d.activity.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar member={a.actor} />
                  <p className="min-w-0 flex-1 text-sm">
                    <MemberLink member={a.actor} className="font-medium" /> {a.summary}{" "}
                    {a.edition && (
                      <Link to={a.link} className="book-title hover:underline">
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
          <EmptyState title="Quiet so far">Books, reviews and quotes from members show up here.</EmptyState>
        )}
      </section>
    </div>
  );
}
