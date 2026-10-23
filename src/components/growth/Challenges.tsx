import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Trash2, Trophy, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { CHALLENGE_KINDS, type ChallengeKind } from "@shared/constants";
import { challengeSchema, type ChallengeInput } from "@shared/schemas";
import type { Challenge, Genre } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { Alert, Badge, Button, Card, cx, Field, Input, ProgressBar, Select, Textarea } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { formatDate, todayIso } from "@/lib/format";

export const CHALLENGE_KIND_LABELS: Record<ChallengeKind, string> = {
  books: "Books finished",
  pages: "Pages read",
  genre: "Books in a genre",
  streak: "Reading streak (days)",
  custom: "Custom (track by hand)",
};

export const unitFor = (kind: ChallengeKind) => (kind === "pages" ? "pages" : kind === "streak" ? "days" : kind === "custom" ? "" : "books");

export function challengeState(c: Challenge, today = todayIso()): "upcoming" | "open" | "ended" {
  if (c.startsOn > today) return "upcoming";
  if (c.endsOn < today) return "ended";
  return "open";
}

/** Create or edit a challenge. `basePath` is `/api/challenges` or `/api/clubs/:id/challenges`. */
export function ChallengeForm({ basePath, challenge, genres, onDone, queryKey }: { basePath: string; challenge?: Challenge; genres?: Genre[]; onDone: () => void; queryKey: unknown[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const year = new Date().getFullYear();
  const form = useForm<ChallengeInput>({
    resolver: zodResolver(challengeSchema),
    defaultValues: challenge
      ? { title: challenge.title, description: challenge.description ?? "", kind: challenge.kind, target: challenge.target, genreId: challenge.genreId ?? "", startsOn: challenge.startsOn, endsOn: challenge.endsOn }
      : { title: "", description: "", kind: "books", target: 12, genreId: "", startsOn: `${year}-01-01`, endsOn: `${year}-12-31` },
  });
  const kind = form.watch("kind");
  const save = useMutation({
    mutationFn: (v: ChallengeInput) => (challenge ? api<Challenge>(`${basePath}/${challenge.id}`, { method: "PUT", body: { ...v, expectedVersion: challenge.version } }) : api<Challenge>(basePath, { body: v })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      toast(challenge ? "Challenge updated." : "Challenge created.");
      onDone();
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.fields) {
        for (const [k, v] of Object.entries(err.fields)) form.setError(k as keyof ChallengeInput, { message: v[0] });
      }
      if (err instanceof ApiRequestError && err.status === 409) void qc.invalidateQueries({ queryKey });
    },
  });
  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      <Field label="Title" error={e.title?.message}>
        {(id) => <Input id={id} maxLength={120} placeholder="Twelve books in twelve months" {...form.register("title")} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Count what" error={e.kind?.message}>
          {(id) => (
            <Select id={id} {...form.register("kind")}>
              {CHALLENGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CHALLENGE_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={`Target${unitFor(kind) ? ` (${unitFor(kind)})` : ""}`} error={e.target?.message}>
          {(id) => <Input id={id} type="number" inputMode="numeric" min={1} max={100000} {...form.register("target")} />}
        </Field>
      </div>
      {kind === "genre" && (
        <Field label="Genre" hint={genres?.length ? undefined : "Genres belong to a club. Pick one from the club's list."} error={e.genreId?.message}>
          {(id, d) => (
            <Select id={id} aria-describedby={d} {...form.register("genreId")}>
              <option value="">Any genre</option>
              {genres?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts" error={e.startsOn?.message}>
          {(id) => <Input id={id} type="date" {...form.register("startsOn")} />}
        </Field>
        <Field label="Ends" error={e.endsOn?.message}>
          {(id) => <Input id={id} type="date" {...form.register("endsOn")} />}
        </Field>
      </div>
      <Field label="Description" error={e.description?.message}>
        {(id) => <Textarea id={id} rows={3} maxLength={2000} {...form.register("description")} />}
      </Field>
      {save.isError && !Object.keys(e).length && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <Button type="submit" loading={save.isPending}>
        {challenge ? "Save changes" : "Create challenge"}
      </Button>
    </form>
  );
}

/** One challenge: progress, join/leave, manual progress for custom ones, and the leaderboard when shared. */
export function ChallengeCard({ challenge: c, basePath, queryKey, canEdit, genres, viewerId, showLeaderboard = true }: { challenge: Challenge; basePath: string; queryKey: unknown[]; canEdit: boolean; genres?: Genre[]; viewerId?: string; showLeaderboard?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [progressInput, setProgressInput] = useState(String(c.myProgress));
  const refresh = () => void qc.invalidateQueries({ queryKey });
  const join = useMutation({ mutationFn: () => api(`${basePath}/${c.id}/join`, { body: {} }), onSuccess: () => (refresh(), toast(`You joined ${c.title}.`)), onError: (err) => toast(errorMessage(err), "error") });
  const leave = useMutation({ mutationFn: () => api(`${basePath}/${c.id}/leave`, { body: {} }), onSuccess: () => (refresh(), toast(`You left ${c.title}.`)), onError: (err) => toast(errorMessage(err), "error") });
  const progress = useMutation({
    mutationFn: () => api(`${basePath}/${c.id}/progress`, { method: "PUT", body: { progress: Number(progressInput) } }),
    onSuccess: () => (refresh(), toast("Progress saved.")),
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const remove = useMutation({
    mutationFn: () => api(`${basePath}/${c.id}`, { method: "DELETE" }),
    onSuccess: () => (refresh(), toast("Challenge removed.")),
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const state = challengeState(c);
  const unit = unitFor(c.kind);
  const done = c.myProgress >= c.target;
  const mine = c.participants.find((p) => p.id === viewerId);
  const leaderboard = [...c.participants].sort((a, b) => b.progress - a.progress || (a.completedAt ?? "9").localeCompare(b.completedAt ?? "9"));
  const finishedCount = c.participants.filter((p) => p.completedAt).length;
  return (
    <Card as="article" className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className={cx("inline-flex size-10 shrink-0 items-center justify-center rounded-control", done ? "bg-accent-soft text-ink" : "bg-surface-2 text-ink-muted")}>
          <Trophy className="size-5" aria-hidden strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="heading-s">{c.title}</h3>
          <p className="text-xs text-ink-muted">
            {CHALLENGE_KIND_LABELS[c.kind]} · {c.target.toLocaleString()} {unit} · {formatDate(c.startsOn)} to {formatDate(c.endsOn)}
            {c.owner ? ` · set by ${c.owner.displayName}` : ""}
          </p>
          {c.description && <p className="mt-2 whitespace-pre-wrap text-sm">{c.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={state === "open" ? "success" : "neutral"}>{state === "open" ? "Open" : state === "upcoming" ? "Starts soon" : "Ended"}</Badge>
          {done && c.joined && (
            <Badge tone="brass">
              <Check className="size-3" aria-hidden /> Completed
            </Badge>
          )}
          {canEdit && (
            <>
              <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${c.title}`} onClick={() => setEditing(true)} />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${c.title}`} loading={remove.isPending} onClick={() => confirm(`Delete ${c.title}?`) && remove.mutate()} />
            </>
          )}
        </div>
      </div>

      {c.joined ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span>
              <span className="font-display text-2xl font-medium">{c.myProgress.toLocaleString()}</span>
              <span className="text-ink-muted"> of {c.target.toLocaleString()} {unit}</span>
            </span>
            <span className="text-xs text-ink-muted">{Math.min(100, Math.round((c.myProgress / c.target) * 100))}%</span>
          </div>
          <ProgressBar value={c.myProgress} max={c.target} label={`Your progress in ${c.title}`} />
          {c.kind === "custom" && state !== "upcoming" && (
            <form
              className="flex items-end gap-2 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                progress.mutate();
              }}
            >
              <Field label="Your progress" className="w-32">
                {(id) => <Input id={id} className="h-9 text-sm" type="number" inputMode="numeric" min={0} value={progressInput} onChange={(e) => setProgressInput(e.target.value)} />}
              </Field>
              <Button type="submit" size="sm" variant="secondary" loading={progress.isPending} disabled={Number(progressInput) === c.myProgress}>
                Update
              </Button>
            </form>
          )}
          {c.clubId && (
            <Button size="sm" variant="ghost" icon={UserMinus} loading={leave.isPending} onClick={() => confirm(`Leave ${c.title}? Your progress stays on record.`) && leave.mutate()}>
              Leave
            </Button>
          )}
        </div>
      ) : (
        state !== "ended" && (
          <Button size="sm" icon={UserPlus} loading={join.isPending} onClick={() => join.mutate()}>
            Join challenge
          </Button>
        )
      )}

      {showLeaderboard && c.clubId && (
        <div>
          <p className="mb-2 flex items-center justify-between text-xs text-ink-muted">
            <span>
              {c.participants.length} {c.participants.length === 1 ? "member" : "members"} in
              {finishedCount > 0 ? ` · ${finishedCount} finished` : ""}
            </span>
            {mine && leaderboard.length > 1 && <span>You are {ordinal(leaderboard.findIndex((p) => p.id === mine.id) + 1)}</span>}
          </p>
          {leaderboard.length === 0 ? (
            <p className="text-sm text-ink-muted">No one has joined yet.</p>
          ) : (
            <ol className="divide-y divide-line">
              {leaderboard.slice(0, 10).map((p, i) => (
                <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-5 text-right font-display text-base text-ink-muted">{i + 1}</span>
                  <Avatar member={p} size="xs" />
                  <span className={cx("min-w-0 flex-1 truncate", p.id === viewerId && "font-semibold")}>
                    {p.displayName}
                    {p.id === viewerId && <span className="text-ink-muted"> (you)</span>}
                  </span>
                  <span className="w-28 shrink-0">
                    <ProgressBar value={p.progress} max={c.target} label={`${p.displayName}'s progress`} />
                  </span>
                  <span className="w-20 text-right text-xs text-ink-muted">
                    {p.completedAt ? <Badge tone="brass">Done</Badge> : `${p.progress.toLocaleString()} ${unit}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {leaderboard.length > 10 && <p className="mt-1 text-xs text-ink-muted">Top 10 shown of {leaderboard.length}.</p>}
        </div>
      )}

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit challenge">
        <ChallengeForm basePath={basePath} challenge={c} genres={genres} queryKey={queryKey} onDone={() => setEditing(false)} />
      </Dialog>
    </Card>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"] as const;
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
