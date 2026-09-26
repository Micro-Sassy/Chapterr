import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Quote as QuoteIcon, Sparkles, Star, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { GoalProgress, Quote, Recommendation, Review } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { BookRow } from "@/components/books";
import { QuoteCard, ReviewCard } from "@/components/content";
import { Alert, Button, Card, EmptyState, Field, IconButton, Input, PageHeader, ProgressBar, SectionTitle, Spinner, Tabs } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

export function RecommendationsPage() {
  useDocumentTitle("Recommendations");
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<"all" | "received" | "club" | "sent">("all");
  const q = useQuery({ queryKey: ["recommendations", scope], queryFn: () => api<Recommendation[]>(`/api/recommendations?scope=${scope}`) });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/recommendations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recommendations"] });
      toast("Recommendation removed");
    },
  });
  return (
    <div>
      <PageHeader title="Recommendations" description="Books members think you (or the whole club) should read. Recommend a book from its page." />
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
      {q.data?.length === 0 && <EmptyState icon={Sparkles} title="No recommendations yet" action={<Link to="/books/add" className="text-sm text-accent underline">Find a book to recommend</Link>} />}
      <ul className="space-y-3">
        {q.data?.map((r) => (
          <li key={r.id}>
            <Card className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Avatar member={r.recommender} size="xs" />
                <span>
                  <Link to={`/members/${r.recommender.username}`} className="font-medium hover:underline">
                    {r.recommender.displayName}
                  </Link>{" "}
                  recommended to {r.recipient ? (r.isOwn ? r.recipient.displayName : "you") : "the club"}
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

export function ReviewsPage() {
  useDocumentTitle("Reviews");
  const [scope, setScope] = useState<"club" | "mine">("club");
  const q = useQuery({ queryKey: ["reviews", scope], queryFn: () => api<Review[]>(`/api/reviews?scope=${scope}`) });
  return (
    <div>
      <PageHeader title="Reviews" description="Write a review from any book's page." />
      <Tabs label="Review filter" value={scope} onChange={setScope} tabs={[{ value: "club", label: "Club reviews" }, { value: "mine", label: "My reviews" }]} />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data?.length === 0 && <EmptyState icon={Star} title="No reviews yet" />}
      <div className="space-y-3">
        {q.data?.map((r) => (
          <ReviewCard key={r.id} review={r} showBook />
        ))}
      </div>
    </div>
  );
}

export function QuotesPage() {
  useDocumentTitle("Quotes");
  const [scope, setScope] = useState<"club" | "mine">("mine");
  const q = useQuery({ queryKey: ["quotes", scope], queryFn: () => api<Quote[]>(`/api/quotes?scope=${scope}`) });
  return (
    <div>
      <PageHeader title="Quotes" description="Passages worth keeping. Save a quote from any book's page." />
      <Tabs label="Quote filter" value={scope} onChange={setScope} tabs={[{ value: "mine", label: "My quotes" }, { value: "club", label: "Club quotes" }]} />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data?.length === 0 && <EmptyState icon={QuoteIcon} title="No quotes yet" />}
      <div className="space-y-3">
        {q.data?.map((x) => (
          <QuoteCard key={x.id} quote={x} />
        ))}
      </div>
    </div>
  );
}

interface Stats {
  year: number;
  byStatus: Record<string, number>;
  finishedByMonth: { month: number; count: number }[];
  pagesRead: number;
}

export function GoalsPage() {
  useDocumentTitle("Goals");
  const qc = useQueryClient();
  const toast = useToast();
  const year = new Date().getFullYear();
  const goal = useQuery({ queryKey: ["goal", year], queryFn: () => api<GoalProgress>(`/api/goals?year=${year}`) });
  const history = useQuery({ queryKey: ["goal", "history"], queryFn: () => api<GoalProgress[]>("/api/goals/history") });
  const stats = useQuery({ queryKey: ["library", "stats", year], queryFn: () => api<Stats>(`/api/library/stats?year=${year}`) });
  const [target, setTarget] = useState("");
  const save = useMutation({
    mutationFn: () => api<GoalProgress>("/api/goals", { method: "PUT", body: { year, target: Number(target) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["goal"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast("Goal saved");
      setTarget("");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const maxMonth = Math.max(1, ...(stats.data?.finishedByMonth.map((m) => m.count) ?? [1]));
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: stats.data?.finishedByMonth.find((m) => m.month === i + 1)?.count ?? 0 }));
  return (
    <div className="space-y-6">
      <PageHeader title="Reading goals" description="Your personal annual book count. Books count when you mark them finished in that year." />
      <Card>
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Target className="size-4 text-accent" aria-hidden /> {year}
          </span>
        </SectionTitle>
        {goal.data && (
          <>
            <p className="font-serif text-3xl font-semibold">
              {goal.data.completed}
              {goal.data.target ? <span className="text-lg text-ink-muted"> / {goal.data.target} books</span> : <span className="text-lg text-ink-muted"> books finished</span>}
            </p>
            {goal.data.target && (
              <div className="mt-3">
                <ProgressBar value={goal.data.completed} max={goal.data.target} label="Personal goal progress" />
              </div>
            )}
          </>
        )}
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(target) > 0) save.mutate();
          }}
        >
          <Field label={goal.data?.target ? "Change target" : "Set a target"}>
            {(id) => <Input id={id} type="number" min={1} max={1000} value={target} onChange={(e) => setTarget(e.target.value)} className="w-32" />}
          </Field>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </form>
      </Card>
      {stats.data && (
        <Card>
          <SectionTitle>This year at a glance</SectionTitle>
          <p className="mb-4 text-sm text-ink-muted">
            {stats.data.pagesRead.toLocaleString()} pages read · {stats.data.byStatus.reading ?? 0} in progress · {stats.data.byStatus.tbr ?? 0} on your TBR
          </p>
          <div className="flex h-32 items-end gap-1.5" role="img" aria-label="Books finished per month">
            {months.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t bg-accent/80" style={{ height: `${(m.count / maxMonth) * 100}%`, minHeight: m.count ? 4 : 0 }} title={`${m.count}`} />
                <span className="text-[10px] text-ink-muted">{new Date(2000, m.month - 1, 1).toLocaleDateString(undefined, { month: "narrow" })}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {history.data && history.data.length > 0 && (
        <Card>
          <SectionTitle>Past goals</SectionTitle>
          <ul className="divide-y divide-line">
            {history.data.map((h) => (
              <li key={h.year} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium">{h.year}</span>
                <span>
                  {h.completed} / {h.target} {h.target && h.completed >= h.target ? "— reached!" : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
