import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Quote as QuoteIcon, Sparkles, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Page, Quote, Recommendation, Review } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { BookRow } from "@/components/books";
import { MemberLink, QuoteCard, ReviewCard } from "@/components/content";
import { clubApi } from "@/components/records";
import { Alert, Button, Card, EmptyState, IconButton, LinkButton, PageHeader, Spinner, Tabs } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { useClub } from "@/lib/club";
import { formatDate } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

/** Cursor-paginated list with a "Load more" button. */
export function usePaged<T>(key: unknown[], path: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => api<Page<T>>(`${path}${path.includes("?") ? "&" : "?"}${pageParam ? `cursor=${encodeURIComponent(pageParam)}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export function LoadMore({ q }: { q: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  if (!q.hasNextPage) return null;
  return (
    <div className="pt-2 text-center">
      <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
        Load more
      </Button>
    </div>
  );
}

export function ClubReviewsPage() {
  const club = useClub();
  useDocumentTitle(`Reviews · ${club.name}`);
  const [scope, setScope] = useState<"club" | "mine">("club");
  const clubQ = usePaged<Review>(["reviews", "club", club.id], clubApi(club.id, "/reviews"), scope === "club");
  const mine = useQuery({ queryKey: ["reviews", "mine"], queryFn: () => api<Review[]>("/api/reviews?scope=mine"), enabled: scope === "mine" });
  const items = scope === "club" ? (clubQ.data?.pages.flatMap((p) => p.items) ?? []) : (mine.data ?? []);
  const pending = scope === "club" ? clubQ.isPending : mine.isPending;
  const error = scope === "club" ? clubQ.error : mine.error;
  return (
    <div>
      <PageHeader eyebrow={club.name} title="Reviews" description="What members thought. Write a review from any book's page." />
      <Tabs label="Review filter" value={scope} onChange={setScope} tabs={[{ value: "club", label: "Club reviews" }, { value: "mine", label: "My reviews" }]} />
      {pending && <Spinner />}
      {error && <Alert tone="error">{errorMessage(error)}</Alert>}
      {!pending && items.length === 0 && <EmptyState icon={Star} title="No reviews yet" action={<LinkButton to="/library" variant="secondary">Open my library</LinkButton>} />}
      <div className="space-y-3">
        {items.map((r) => (
          <ReviewCard key={r.id} review={r} showBook />
        ))}
      </div>
      {scope === "club" && <LoadMore q={clubQ} />}
    </div>
  );
}

export function ClubQuotesPage() {
  const club = useClub();
  useDocumentTitle(`Quotes · ${club.name}`);
  const [scope, setScope] = useState<"club" | "mine">("club");
  const clubQ = usePaged<Quote>(["quotes", "club", club.id], clubApi(club.id, "/quotes"), scope === "club");
  const mine = useQuery({ queryKey: ["quotes", "mine"], queryFn: () => api<Quote[]>("/api/quotes?scope=mine"), enabled: scope === "mine" });
  const items = scope === "club" ? (clubQ.data?.pages.flatMap((p) => p.items) ?? []) : (mine.data ?? []);
  const pending = scope === "club" ? clubQ.isPending : mine.isPending;
  const error = scope === "club" ? clubQ.error : mine.error;
  return (
    <div>
      <PageHeader eyebrow={club.name} title="Quotes" description="Passages worth keeping. Save a quote from any book's page." />
      <Tabs label="Quote filter" value={scope} onChange={setScope} tabs={[{ value: "club", label: "Club quotes" }, { value: "mine", label: "My quotes" }]} />
      {pending && <Spinner />}
      {error && <Alert tone="error">{errorMessage(error)}</Alert>}
      {!pending && items.length === 0 && <EmptyState icon={QuoteIcon} title="No quotes yet" />}
      <div className="space-y-3">
        {items.map((x) => (
          <QuoteCard key={x.id} quote={x} />
        ))}
      </div>
      {scope === "club" && <LoadMore q={clubQ} />}
    </div>
  );
}

export function ClubRecommendationsPage() {
  const club = useClub();
  useDocumentTitle(`Recommendations · ${club.name}`);
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<"all" | "received" | "club" | "sent">("all");
  const q = useQuery({ queryKey: ["recommendations", club.id, scope], queryFn: () => api<Recommendation[]>(clubApi(club.id, `/recommendations?scope=${scope}`)) });
  const remove = useMutation({
    mutationFn: (id: string) => api(clubApi(club.id, `/recommendations/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recommendations"] });
      toast("Recommendation removed.");
    },
  });
  return (
    <div>
      <PageHeader eyebrow={club.name} title="Recommendations" description="Books members think you, or the whole club, should read next. Recommend one from its page." />
      <Tabs
        label="Recommendation filter"
        value={scope}
        onChange={setScope}
        tabs={[
          { value: "all", label: "All" },
          { value: "received", label: "For me" },
          { value: "club", label: "For the club" },
          { value: "sent", label: "Sent by me" },
        ]}
      />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data?.length === 0 && (
        <EmptyState icon={Sparkles} title="No recommendations yet" action={<LinkButton to="/books/add" variant="secondary">Find a book</LinkButton>} />
      )}
      <ul className="space-y-3">
        {q.data?.map((r) => (
          <li key={r.id}>
            <Card className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Avatar member={r.recommender} size="xs" />
                <span>
                  <MemberLink member={r.recommender} className="font-medium" /> recommended to {r.recipient ? (r.isOwn ? r.recipient.displayName : "you") : "the club"}
                </span>
                <span className="text-xs text-ink-muted">· {formatDate(r.createdAt)}</span>
                {r.isOwn && <IconButton icon={Trash2} label="Remove recommendation" className="ml-auto" onClick={() => remove.mutate(r.id)} />}
              </div>
              <BookRow edition={r.edition} />
              {r.note && <p className="whitespace-pre-wrap text-sm">“{r.note}”</p>}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
