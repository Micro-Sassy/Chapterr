import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, GripVertical, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { WAVE2_LIMITS } from "@shared/constants";
import type { JoinRequest, ScreeningQuestion } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { clubApi } from "@/components/records";
import { Alert, Badge, Button, Checkbox, EmptyState, Input, Spinner, Tabs } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, relativeTime } from "@/lib/format";

export type DraftQuestion = Pick<ScreeningQuestion, "label" | "required"> & { id?: string; key: string };

export const newQuestionKey = () => Math.random().toString(36).slice(2, 10);

/** Up to five questions a newcomer answers before an admin approves them. */
export function ScreeningQuestionsEditor({ value, onChange, disabled }: { value: DraftQuestion[]; onChange: (q: DraftQuestion[]) => void; disabled?: boolean }) {
  const update = (key: string, patch: Partial<DraftQuestion>) => onChange(value.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = value.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-sm text-ink-muted">No questions yet. Newcomers can still leave a short message.</p>}
      <ol className="space-y-2">
        {value.map((q, i) => (
          <li key={q.key} className="flex flex-wrap items-center gap-2 rounded-control border border-line bg-surface p-2">
            <span className="inline-flex flex-col text-ink-muted">
              <button type="button" aria-label={`Move question ${i + 1} up`} className="rounded-chip p-0.5 hover:text-ink disabled:opacity-30" disabled={disabled || i === 0} onClick={() => move(i, i - 1)}>
                <GripVertical className="size-4 rotate-90" aria-hidden />
              </button>
              <button type="button" aria-label={`Move question ${i + 1} down`} className="rounded-chip p-0.5 hover:text-ink disabled:opacity-30" disabled={disabled || i === value.length - 1} onClick={() => move(i, i + 1)}>
                <GripVertical className="size-4 -rotate-90" aria-hidden />
              </button>
            </span>
            <Input aria-label={`Question ${i + 1}`} className="h-10 min-w-0 flex-1 text-sm" maxLength={200} value={q.label} disabled={disabled} onChange={(e) => update(q.key, { label: e.target.value })} placeholder="What are you reading right now?" />
            <Checkbox label="Required" className="text-xs" checked={q.required} disabled={disabled} onChange={(e) => update(q.key, { required: e.target.checked })} />
            <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove question ${i + 1}`} disabled={disabled} onClick={() => onChange(value.filter((x) => x.key !== q.key))} />
          </li>
        ))}
      </ol>
      {value.length < WAVE2_LIMITS.screeningQuestionsMax && (
        <Button size="sm" variant="secondary" icon={Plus} disabled={disabled} onClick={() => onChange([...value, { key: newQuestionKey(), label: "", required: true }])}>
          Add question
        </Button>
      )}
      <p className="text-xs text-ink-muted">Up to {WAVE2_LIMITS.screeningQuestionsMax} questions. Answers are visible to admins only.</p>
    </div>
  );
}

/** Pending, approved and declined requests with their answers; approve or decline. */
export function JoinRequestsPanel({ clubId }: { clubId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<JoinRequest["status"]>("pending");
  const q = useQuery({
    queryKey: ["join-requests", clubId, status],
    queryFn: () => api<JoinRequest[] | { items: JoinRequest[] }>(clubApi(clubId, `/join-requests?status=${status}`)).then((r) => (Array.isArray(r) ? r : r.items)),
    refetchInterval: status === "pending" ? 60_000 : false,
  });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "decline"; name: string }) => api(clubApi(clubId, `/join-requests/${id}/${action}`), { body: {} }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["join-requests", clubId] });
      void qc.invalidateQueries({ queryKey: ["club-members", clubId] });
      void qc.invalidateQueries({ queryKey: ["club", clubId] });
      toast(v.action === "approve" ? `${v.name} is in. We sent them a welcome.` : `${v.name}'s request was declined.`);
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  return (
    <div className="space-y-3">
      <Tabs
        label="Join request status"
        value={status}
        onChange={setStatus}
        tabs={[
          { value: "pending", label: "Pending" },
          { value: "approved", label: "Approved" },
          { value: "declined", label: "Declined" },
        ]}
      />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data?.length === 0 && <EmptyState title={status === "pending" ? "No one is waiting" : `No ${status} requests`}>{status === "pending" ? "New requests appear here when someone asks to join." : undefined}</EmptyState>}
      <ul className="divide-y divide-line">
        {q.data?.map((r) => (
          <li key={r.id} className="space-y-2 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar member={r.member} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {r.member.displayName} <span className="text-ink-muted">@{r.member.username}</span>
                </p>
                <p className="text-xs text-ink-muted">
                  Asked {relativeTime(r.createdAt)}
                  {r.decidedAt && r.decidedBy ? ` · ${r.status} by ${r.decidedBy.displayName} ${formatDateTime(r.decidedAt)}` : ""}
                </p>
              </div>
              {r.status === "pending" ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" icon={X} loading={decide.isPending && decide.variables?.id === r.id && decide.variables.action === "decline"} onClick={() => decide.mutate({ id: r.id, action: "decline", name: r.member.displayName })}>
                    Decline
                  </Button>
                  <Button size="sm" icon={Check} loading={decide.isPending && decide.variables?.id === r.id && decide.variables.action === "approve"} onClick={() => decide.mutate({ id: r.id, action: "approve", name: r.member.displayName })}>
                    Approve
                  </Button>
                </div>
              ) : (
                <Badge tone={r.status === "approved" ? "success" : "neutral"}>{r.status === "approved" ? "Approved" : "Declined"}</Badge>
              )}
            </div>
            {(r.answers.length > 0 || r.message) && (
              <dl className="ml-11 space-y-1.5 rounded-control bg-ground p-3 text-sm">
                {r.answers.map((a) => (
                  <div key={a.questionId}>
                    <dt className="text-xs text-ink-muted">{a.label}</dt>
                    <dd className="whitespace-pre-wrap">{a.answer || <span className="text-ink-muted">No answer</span>}</dd>
                  </div>
                ))}
                {r.message && (
                  <div>
                    <dt className="text-xs text-ink-muted">Message</dt>
                    <dd className="whitespace-pre-wrap">{r.message}</dd>
                  </div>
                )}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
