import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, MessageCircle, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { READING_STATUSES, READING_STATUS_LABELS, type ReadingStatus } from "@shared/constants";
import type { AppNotification, MemberProfile, MemberSummary, Quote, Review, UserBook } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { BookRow } from "@/components/books";
import { QuoteCard, ReviewCard } from "@/components/content";
import { Alert, Button, Card, cx, EmptyState, Input, PageHeader, ProgressBar, Spinner, Tabs } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { formatDate, relativeTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { NAV } from "@/components/AppShell";
import { InstallAppButton } from "@/components/InstallApp";

export function MembersPage() {
  useDocumentTitle("Members");
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: ["members"], queryFn: () => api<MemberSummary[]>("/api/members") });
  const list = (q.data ?? []).filter((m) => `${m.displayName} ${m.username}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div>
      <PageHeader title="Members" description={q.data ? `${q.data.length} members` : undefined} />
      <Input type="search" aria-label="Find a member" placeholder="Find a member" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-4 max-w-sm" />
      {q.isPending && <Spinner />}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((m) => (
          <li key={m.id}>
            <Link to={`/members/${m.username}`} className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface p-3 hover:bg-surface-2">
              <Avatar member={m} size="md" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{m.displayName}</span>
                <span className="block truncate text-sm text-ink-muted">@{m.username}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MemberProfilePage() {
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
    mutationFn: () => api<{ id: string }>("/api/conversations/direct", { body: { userId: profile.data!.id } }),
    onSuccess: ({ id }) => navigate(`/messages/${id}`),
  });
  useDocumentTitle(profile.data?.displayName ?? "Member");
  if (profile.isPending) return <Spinner />;
  if (profile.isError) return <Alert tone="error">{errorMessage(profile.error)}</Alert>;
  const p = profile.data;
  const isMe = p.id === session?.user.id;
  const shelf = (books.data ?? []).filter((b) => b.status === tab);
  return (
    <div className="space-y-6">
      <Card className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <Avatar member={p} size="lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-3xl">{p.displayName}</h1>
          <p className="text-sm text-ink-muted">
            @{p.username}
            {p.profile.pronouns ? ` · ${p.profile.pronouns}` : ""}
            {p.profile.location ? ` · ${p.profile.location}` : ""} · joined {formatDate(p.joinedAt)}
          </p>
          {p.profile.bio && <p className="whitespace-pre-wrap text-sm">{p.profile.bio}</p>}
          {p.profile.favoriteGenres && <p className="text-sm text-ink-muted">Favourite genres: {p.profile.favoriteGenres}</p>}
        </div>
        {isMe ? (
          <Link to="/settings" className="text-sm text-accent underline">
            Edit profile
          </Link>
        ) : (
          <Button icon={MessageCircle} loading={message.isPending} onClick={() => message.mutate()}>
            Message
          </Button>
        )}
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: `Finished in ${p.goal.year}`, value: p.stats.finishedThisYear },
          { label: "Reading now", value: p.stats.reading },
          { label: "Reviews", value: p.stats.reviews },
          { label: "Quotes", value: p.stats.quotes },
        ].map((s) => (
          <Card key={s.label} className="p-3 text-center">
            <p className="font-serif text-3xl">{s.value}</p>
            <p className="text-xs text-ink-muted">{s.label}</p>
          </Card>
        ))}
      </div>
      {p.goal.target && (
        <Card>
          <p className="mb-2 text-sm font-medium">
            {p.goal.year} goal: {p.goal.completed} / {p.goal.target}
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
                  <Card className="p-3">
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

export function NotificationsPage() {
  useDocumentTitle("Notifications");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["notifications", "list"], queryFn: () => api<AppNotification[]>("/api/notifications") });
  const readAll = useMutation({
    mutationFn: () => api("/api/notifications/read-all", { body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      await api(`/api/notifications/${n.id}/read`, { body: {} }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    }
    if (n.link?.startsWith("/")) navigate(n.link);
  };
  return (
    <div>
      <PageHeader
        title="Notifications"
        actions={
          <Button variant="secondary" icon={CheckCheck} loading={readAll.isPending} onClick={() => readAll.mutate()}>
            Mark all read
          </Button>
        }
      />
      {q.isPending && <Spinner />}
      {q.data?.length === 0 && (
        <EmptyState icon={Bell} title="You're all caught up">
          Choose what you are notified about in <Link to="/settings?tab=notifications" className="text-accent underline">Settings</Link>.
        </EmptyState>
      )}
      <ul className="space-y-2">
        {q.data?.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => void open(n)}
              className={cx("flex w-full items-start gap-3 rounded-[var(--radius)] border border-line p-3 text-left hover:bg-surface-2", n.readAt ? "bg-surface" : "bg-accent-soft")}
            >
              <Avatar member={n.actor} />
              <span className="min-w-0 flex-1">
                <span className={cx("block text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
                {n.body && <span className="block truncate text-sm text-ink-muted">{n.body}</span>}
                <span className="block text-xs text-ink-muted">{relativeTime(n.createdAt)}</span>
              </span>
              {!n.readAt && <span className="mt-1.5 size-2 rounded-full bg-highlight" aria-label="Unread" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MorePage() {
  useDocumentTitle("More");
  return (
    <div>
      <PageHeader title="More" />
      <ul className="grid gap-2 sm:grid-cols-2">
        {NAV.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface p-4 hover:bg-surface-2">
              <item.icon className="size-5 text-accent" aria-hidden />
              <span className="font-medium">{item.label}</span>
            </Link>
          </li>
        ))}
        <li>
          <Link to="/club/meetings" className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface p-4 hover:bg-surface-2">
            <Users className="size-5 text-accent" aria-hidden />
            <span className="font-medium">Meetings</span>
          </Link>
        </li>
        <li className="mt-2 sm:col-span-2">
          <InstallAppButton className="w-full" label="Install the app on this device" />
        </li>
      </ul>
    </div>
  );
}

export function NotFoundPage() {
  useDocumentTitle("Not found");
  return (
    <EmptyState title="Page not found" action={<Link to="/" className="text-sm text-accent underline">Go home</Link>}>
      That page does not exist or you do not have access to it.
    </EmptyState>
  );
}
