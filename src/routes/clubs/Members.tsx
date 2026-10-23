import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageCircle, Settings, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { READING_STATUSES, READING_STATUS_LABELS, type ReadingStatus } from "@shared/constants";
import type { ClubMember, MemberProfile, Quote, Review, UserBook } from "@shared/types";
import { RoleChip } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { BookRow } from "@/components/books";
import { QuoteCard, ReviewCard } from "@/components/content";
import { clubApi } from "@/components/records";
import { Alert, Badge, Button, Card, EmptyState, Input, LinkButton, PageHeader, ProgressBar, Spinner, Stat, Tabs, TextLink } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { clubPath, isAdmin, useClub } from "@/lib/club";
import { formatDate } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

export function ClubMembersPage() {
  const club = useClub();
  useDocumentTitle(`Members · ${club.name}`);
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: ["club-members", club.id], queryFn: () => api<ClubMember[]>(clubApi(club.id, "/members")) });
  const list = (q.data ?? []).filter((m) => `${m.displayName} ${m.username}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div>
      <PageHeader
        eyebrow={club.name}
        title="Members"
        description={q.data ? `${q.data.length} ${q.data.length === 1 ? "member" : "members"}` : undefined}
        actions={
          isAdmin(club) ? (
            <LinkButton to={`${clubPath(club.id, "settings")}?tab=invites`} variant="secondary" icon={UserPlus}>
              Invite members
            </LinkButton>
          ) : undefined
        }
      />
      <Input type="search" aria-label="Find a member" placeholder="Find a member" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-4 max-w-sm" />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((m) => (
          <li key={m.id}>
            <Link to={clubPath(club.id, `members/${encodeURIComponent(m.username)}`)} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 hover:bg-surface-2">
              <Avatar member={m} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.displayName}</span>
                <span className="block truncate text-sm text-ink-muted">@{m.username}</span>
              </span>
              <RoleChip role={m.role} />
            </Link>
          </li>
        ))}
      </ul>
      {isAdmin(club) && (
        <p className="mt-6 text-sm text-ink-muted">
          Roles and removals live in{" "}
          <TextLink to={`${clubPath(club.id, "settings")}?tab=members`}>
            <Settings className="mr-1 inline size-3.5" aria-hidden />
            club settings
          </TextLink>
          .
        </p>
      )}
    </div>
  );
}

export function MemberProfilePage() {
  const club = useClub();
  const { username = "" } = useParams();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [tab, setTab] = useState<ReadingStatus | "reviews" | "quotes">("reading");
  const profile = useQuery({ queryKey: ["member", username], queryFn: () => api<MemberProfile>(`/api/members/${encodeURIComponent(username)}`) });
  const books = useQuery({
    queryKey: ["member", username, "books"],
    queryFn: () => api<UserBook[]>(`/api/members/${encodeURIComponent(username)}/books`),
    enabled: profile.isSuccess,
  });
  const reviews = useQuery({
    queryKey: ["reviews", "member", username],
    queryFn: () => api<Review[]>(`/api/members/${encodeURIComponent(username)}/reviews`),
    enabled: profile.isSuccess && tab === "reviews",
  });
  const quotes = useQuery({
    queryKey: ["quotes", "member", username],
    queryFn: () => api<Quote[]>(`/api/members/${encodeURIComponent(username)}/quotes`),
    enabled: profile.isSuccess && tab === "quotes",
  });
  const message = useMutation({
    mutationFn: () => api<{ id: string }>(clubApi(club.id, "/conversations/direct"), { body: { userId: profile.data!.id } }),
    onSuccess: ({ id }) => navigate(clubPath(club.id, `messages/${id}`)),
  });
  useDocumentTitle(profile.data?.displayName ?? "Member");
  if (profile.isPending) return <Spinner />;
  if (profile.isError) return <Alert tone="error">{errorMessage(profile.error)}</Alert>;
  const p = profile.data;
  const isMe = p.id === session?.user.id;
  const shelf = (books.data ?? []).filter((b) => b.status === tab);
  const inThisClub = p.sharedClubs.find((c) => c.id === club.id);
  return (
    <div className="space-y-6">
      <Card className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <Avatar member={p} size="lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="display-l">{p.displayName}</h1>
          <p className="text-sm text-ink-muted">
            @{p.username}
            {p.profile.pronouns ? ` · ${p.profile.pronouns}` : ""}
            {p.profile.location ? ` · ${p.profile.location}` : ""} · joined Chapterr {formatDate(p.joinedAt)}
          </p>
          <div className="flex flex-wrap justify-center gap-1.5 sm:justify-start">
            {inThisClub && <RoleChip role={inThisClub.role} />}
            {p.sharedClubs.filter((c) => c.id !== club.id).map((c) => (
              <Badge key={c.id}>{c.name}</Badge>
            ))}
          </div>
          {p.profile.bio && <p className="whitespace-pre-wrap pt-1 text-sm">{p.profile.bio}</p>}
          {p.profile.favoriteGenres && <p className="text-sm text-ink-muted">Favourite genres: {p.profile.favoriteGenres}</p>}
        </div>
        {isMe ? (
          <LinkButton to="/settings" variant="secondary">
            Edit profile
          </LinkButton>
        ) : (
          <Button icon={MessageCircle} loading={message.isPending} onClick={() => message.mutate()}>
            Message
          </Button>
        )}
      </Card>
      <Card className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat value={p.stats.finishedThisYear} label={`Finished in ${p.goal.year}`} />
        <Stat value={p.stats.reading} label="Reading now" />
        <Stat value={p.stats.reviews} label="Reviews" />
        <Stat value={p.stats.quotes} label="Quotes" />
      </Card>
      {p.goal.target && (
        <Card>
          <p className="mb-3 text-sm font-medium">
            {p.goal.year} goal: {p.goal.completed} of {p.goal.target}
          </p>
          <ProgressBar value={p.goal.completed} max={p.goal.target} label={`${p.displayName}'s goal progress`} />
        </Card>
      )}
      <div>
        <Tabs
          label="Profile sections"
          value={tab}
          onChange={setTab}
          tabs={[
            ...READING_STATUSES.map((s) => ({ value: s as ReadingStatus | "reviews" | "quotes", label: READING_STATUS_LABELS[s], count: (books.data ?? []).filter((b) => b.status === s).length })),
            { value: "reviews", label: "Reviews" },
            { value: "quotes", label: "Quotes" },
          ]}
        />
        {tab === "reviews" ? (
          <div className="space-y-3">
            {reviews.isPending && <Spinner />}
            {reviews.data?.length === 0 && <EmptyState title="No reviews to show" />}
            {reviews.data?.map((r) => <ReviewCard key={r.id} review={r} showBook />)}
          </div>
        ) : tab === "quotes" ? (
          <div className="space-y-3">
            {quotes.isPending && <Spinner />}
            {quotes.data?.length === 0 && <EmptyState title="No quotes to show" />}
            {quotes.data?.map((q) => <QuoteCard key={q.id} quote={q} />)}
          </div>
        ) : (
          <>
            {books.isPending && <Spinner />}
            {books.isSuccess && shelf.length === 0 && <EmptyState title="Nothing to show here" />}
            <ul className="grid gap-3 md:grid-cols-2">
              {shelf.map((b) => (
                <li key={b.id}>
                  <Card className="p-3 sm:p-4">
                    <BookRow edition={b.edition} meta={b.finishedAt ? `Finished ${formatDate(b.finishedAt)}` : undefined} />
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
