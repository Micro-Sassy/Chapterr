import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { GoalProgress } from "@shared/types";
import { Button, Card, Field, Input, PageHeader, ProgressBar, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { useDocumentTitle } from "@/lib/hooks";

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
      void qc.invalidateQueries({ queryKey: ["home"] });
      toast("Goal saved.");
      setTarget("");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const maxMonth = Math.max(1, ...(stats.data?.finishedByMonth.map((m) => m.count) ?? [1]));
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: stats.data?.finishedByMonth.find((m) => m.month === i + 1)?.count ?? 0 }));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="You" title="Reading goals" description="Your personal annual book count. Books count when you mark them finished in that year." />
      <Card>
        <SectionTitle>{year}</SectionTitle>
        {goal.data && (
          <>
            <p className="font-display text-4xl font-medium">
              {goal.data.completed}
              {goal.data.target ? <span className="text-lg text-ink-muted"> of {goal.data.target} books</span> : <span className="text-lg text-ink-muted"> books finished</span>}
            </p>
            {goal.data.target && (
              <div className="mt-4">
                <ProgressBar value={goal.data.completed} max={goal.data.target} label="Personal goal progress" />
              </div>
            )}
          </>
        )}
        <form
          className="mt-5 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(target) > 0) save.mutate();
          }}
        >
          <Field label={goal.data?.target ? "Change target" : "Set a target"}>
            {(id) => <Input id={id} type="number" min={1} max={1000} value={target} onChange={(e) => setTarget(e.target.value)} className="w-32" />}
          </Field>
          <Button type="submit" loading={save.isPending}>
            Save goal
          </Button>
        </form>
      </Card>
      {stats.data && (
        <Card>
          <SectionTitle>This year at a glance</SectionTitle>
          <p className="mb-4 text-sm text-ink-muted">
            {stats.data.pagesRead.toLocaleString()} pages read · {stats.data.byStatus.reading ?? 0} in progress · {stats.data.byStatus.tbr ?? 0} to read
          </p>
          <div className="flex h-32 items-end gap-1.5" role="img" aria-label="Books finished per month">
            {months.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t-[2px] bg-primary" style={{ height: `${(m.count / maxMonth) * 100}%`, minHeight: m.count ? 4 : 0 }} title={`${m.count}`} />
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
                  {h.completed} of {h.target}
                  {h.target && h.completed >= h.target ? " · reached" : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
