import { useQuery } from "@tanstack/react-query";
import { BookPlus, CalendarDays, ClipboardList, Gauge, MessageCircle, Target, UserPlus, Vote, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ClubDashboard, EditionSummary, MeetingFull } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { BookCover } from "@/components/BookCover";
import { BookRow } from "@/components/books";
import { MemberLink } from "@/components/content";
import { InviteCreator } from "@/components/InviteCreator";
import { useClubTimezone, useMeetings, useRsvp } from "@/components/meetings/api";
import { rangesLine } from "@/components/meetings/EditionMappingForm";
import { paceSentence, rowsThisWeek } from "@/components/meetings/pace";
import { usePacePlan } from "@/components/meetings/PacePlanner";
import { RsvpChips, rsvpSummaryLine } from "@/components/meetings/RsvpChips";
import { usePolls } from "@/components/polls/api";
import { PollOptionRows } from "@/components/polls/PollOptionRows";
import { Alert, Badge, Card, EmptyState, IconButton, LinkButton, ProgressBar, SectionTitle, Spinner, TextLink } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDateKey, formatMeetingWhen } from "@/lib/calendar";
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

/** The soonest upcoming meeting with RSVP chips right on the card. */
function NextMeetingCard({ clubId, fallback }: { clubId: string; fallback: ClubDashboard["nextMeeting"] }) {
  const tz = useClubTimezone();
  const upcoming = useMeetings(clubId, "upcoming");
  const next: MeetingFull | null = upcoming.data?.find((m) => !m.archivedAt) ?? null;
  const rsvp = useRsvp(clubId, next?.id ?? "");
  const shown = next ?? fallback;
  return (
    <Card>
      <h2 className="heading-s flex items-center gap-2">
        <CalendarDays className="size-4 text-ink-muted" aria-hidden /> Next meeting
      </h2>
      {shown ? (
        <div className="mt-3 space-y-2">
          <p className="font-medium">
            <Link to={clubPath(clubId, `meetings/${shown.id}`)} className="hover:underline">
              {shown.title}
            </Link>
          </p>
          <p className="text-sm text-ink-muted">
            {next ? formatMeetingWhen(next.startsAt, next.endsAt, next.timezone ?? tz) : formatDateTime(shown.startsAt)}
            {shown.location ? ` · ${shown.location}` : ""}
          </p>
          {shown.edition && <BookRow edition={shown.edition} />}
          {next && (
            <>
              <RsvpChips size="sm" summary={next.rsvp} busy={rsvp.isPending} onChange={(status) => rsvp.mutate({ status, guests: status === "going" ? next.rsvp.myGuests : 0 })} label={`RSVP to ${next.title}`} />
              <p className="text-xs text-ink-muted">{rsvpSummaryLine(next.rsvp)}</p>
            </>
          )}
          <TextLink to={clubPath(clubId, "meetings")} className="text-sm">
            All meetings
          </TextLink>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">
          Nothing scheduled. <TextLink to={clubPath(clubId, "meetings")}>Plan one</TextLink>
        </p>
      )}
    </Card>
  );
}

/** Open polls, with the leading options and a link to vote. */
function OpenPollsCard({ clubId }: { clubId: string }) {
  const tz = useClubTimezone();
  const polls = usePolls(clubId, "open");
  return (
    <Card>
      <h2 className="heading-s flex items-center gap-2">
        <Vote className="size-4 text-ink-muted" aria-hidden /> Open polls
      </h2>
      {polls.isPending && <Spinner />}
      {polls.data && polls.data.length === 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          No open polls. <TextLink to={clubPath(clubId, "polls")}>Start one</TextLink>
        </p>
      )}
      {polls.data && polls.data.length > 0 && (
        <ul className="mt-3 space-y-4">
          {polls.data.slice(0, 2).map((p) => {
            const voted = p.options.some((o) => o.mine);
            return (
              <li key={p.id} className="space-y-1.5">
                <p className="flex items-center justify-between gap-2 text-sm">
                  <Link to={clubPath(clubId, `polls/${p.id}`)} className="font-medium hover:underline">
                    {p.title}
                  </Link>
                  <Badge tone={voted ? "success" : "brass"}>{voted ? "Voted" : "Vote"}</Badge>
                </p>
                <PollOptionRows poll={{ ...p, options: [...p.options].sort((a, b) => b.votes - a.votes).slice(0, 3) }} tz={tz} compact />
                <p className="text-xs text-ink-muted">
                  {p.totalVoters} {p.totalVoters === 1 ? "member has" : "members have"} voted
                </p>
              </li>
            );
          })}
          {polls.data.length > 2 && (
            <li>
              <TextLink to={clubPath(clubId, "polls")} className="text-sm">
                {polls.data.length - 2} more
              </TextLink>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

/** This week's chunk of the current book and the viewer's own pace. */
function PaceThisWeekCard({ clubId, edition }: { clubId: string; edition: EditionSummary }) {
  const plan = usePacePlan(clubId, edition.id);
  if (plan.isPending) return null;
  if (!plan.data) return null;
  const rows = rowsThisWeek(plan.data);
  const next = plan.data.schedule.find((r) => r.dueDate >= todayIso());
  return (
    <Card>
      <h2 className="heading-s flex items-center gap-2">
        <Gauge className="size-4 text-ink-muted" aria-hidden /> This week's pages
      </h2>
      <p className="mt-2">
        <span className="book-title text-lg">{edition.title}</span>
      </p>
      {rows.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.dueDate} className="flex justify-between gap-3">
              <span className="tabular-nums">{rangesLine({ pages: { from: r.fromPage, to: r.toPage }, kindle: null, audio: null })}</span>
              <span className="text-ink-muted">by {formatDateKey(r.dueDate)}</span>
            </li>
          ))}
        </ul>
      ) : next ? (
        <p className="mt-2 text-sm text-ink-muted">
          Nothing due this week. Next: pages {next.fromPage} to {next.toPage} by {formatDateKey(next.dueDate)}.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">The plan has ended.</p>
      )}
      <p className="mt-3 text-sm font-medium">{paceSentence(plan.data.personal)}</p>
      <TextLink to={clubPath(clubId, "list")} className="mt-1 inline-block text-sm">
        Full schedule
      </TextLink>
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
        <NextMeetingCard clubId={club.id} fallback={d.nextMeeting} />
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

      <div className="grid gap-4 lg:grid-cols-2">
        <OpenPollsCard clubId={club.id} />
        {d.currentBooks[0] && <PaceThisWeekCard clubId={club.id} edition={d.currentBooks[0].edition} />}
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
