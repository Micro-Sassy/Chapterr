import { Archive, Check, Lock, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Poll } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { BookPicker } from "@/components/books";
import { MemberLink } from "@/components/content";
import { clubApi, useSharedMutation } from "@/components/records";
import { Alert, Badge, Button, Card, Field, Input } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api } from "@/lib/api";
import { formatInZone, zoneAbbr, zonedToIso } from "@/lib/calendar";
import { relativeTime } from "@/lib/format";
import { allowsMemberOptions, POLL_KIND_LABELS, pollInvalidations } from "./api";
import { optionLabel, PollOptionRows } from "./PollOptionRows";
import { pollResults, turnoutLine } from "./results";

export function PollMeta({ poll, tz }: { poll: Poll; tz: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
      <Badge tone={poll.kind === "book" ? "brass" : poll.kind === "date" ? "info" : "neutral"}>{POLL_KIND_LABELS[poll.kind]}</Badge>
      {poll.status === "closed" ? (
        <Badge>
          <Lock className="size-3" aria-hidden /> Closed
        </Badge>
      ) : poll.closesAt ? (
        <span>
          Closes {formatInZone(poll.closesAt, tz, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} {zoneAbbr(poll.closesAt, tz)}
        </span>
      ) : (
        <span>Open until closed</span>
      )}
      {poll.anonymous && <Badge>Anonymous</Badge>}
      {poll.allowMultiple && <Badge>Several choices</Badge>}
      {poll.appliedAt && <Badge tone="success">Applied</Badge>}
    </p>
  );
}

/** The full poll: vote, add options, close, apply the result. */
export function PollDetail({ poll, clubId, tz, isAdmin, userId, memberCount }: { poll: Poll; clubId: string; tz: string; isAdmin: boolean; userId: string | undefined; memberCount?: number }) {
  const keys = pollInvalidations(clubId);
  const mine = new Set(poll.options.filter((o) => o.mine).map((o) => o.id));
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newStart, setNewStart] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const choice = selected ?? mine;
  const open = poll.status === "open";
  const canClose = open && (isAdmin || (!!userId && poll.createdBy?.id === userId));
  const results = pollResults(poll);

  const vote = useSharedMutation((optionIds: string[]) => api(clubApi(clubId, `/polls/${poll.id}/vote`), { method: "PUT", body: { optionIds } }), keys, "Vote counted.");
  const addOption = useSharedMutation((opt: { label: string; editionId?: string | null; startsAt?: string | null }) => api(clubApi(clubId, `/polls/${poll.id}/options`), { body: { options: [opt] } }), keys, "Option added.");
  const close = useSharedMutation(() => api(clubApi(clubId, `/polls/${poll.id}/close`), { method: "POST" }), keys, "Poll closed.");
  const apply = useSharedMutation(() => api(clubApi(clubId, `/polls/${poll.id}/apply`), { method: "POST", body: {} }), keys, poll.kind === "book" ? "Added to the reading list." : poll.kind === "date" ? "Meeting scheduled." : "Result applied.");
  const archive = useSharedMutation(() => api(clubApi(clubId, `/polls/${poll.id}`), { method: "DELETE" }), keys, "Poll archived.");

  const toggle = (id: string) => {
    const next = new Set(choice);
    if (poll.allowMultiple) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      next.clear();
      next.add(id);
    }
    setSelected(next);
  };
  const dirty = selected !== null && (selected.size !== mine.size || Array.from(selected).some((id) => !mine.has(id)));

  return (
    <Card as="article" className="space-y-4">
      <div className="space-y-1.5">
        <h2 className="heading-m">{poll.title}</h2>
        <PollMeta poll={poll} tz={tz} />
        {poll.description && <p className="whitespace-pre-wrap text-sm">{poll.description}</p>}
        <p className="text-xs text-ink-muted">
          {poll.createdBy ? (
            <>
              Started by <MemberLink member={poll.createdBy} /> {relativeTime(poll.createdAt)}
            </>
          ) : (
            `Started ${relativeTime(poll.createdAt)}`
          )}
        </p>
      </div>

      <PollOptionRows poll={poll} tz={tz} selected={open ? choice : undefined} onToggle={open ? toggle : undefined} />
      <p className="text-sm text-ink-muted">
        {turnoutLine(poll.totalVoters, memberCount)}
        {poll.allowMultiple ? `, ${results.totalVotes} ${results.totalVotes === 1 ? "choice" : "choices"} in all` : ""}.
      </p>

      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={Check} loading={vote.isPending} disabled={!dirty || choice.size === 0} onClick={() => vote.mutate(Array.from(choice), { onSuccess: () => setSelected(null) })}>
            {mine.size ? "Change vote" : "Vote"}
          </Button>
          {mine.size > 0 && !dirty && <span className="text-sm text-ink-muted">You voted. Pick differently to change it.</span>}
          {allowsMemberOptions(poll) && poll.options.length < 20 && (
            <Button variant="ghost" size="sm" icon={Plus} onClick={() => setAdding(true)}>
              Add option
            </Button>
          )}
        </div>
      )}

      {poll.status === "closed" && results.winner && (
        <Alert tone={poll.appliedAt ? "success" : "info"} title={results.tie ? "A tie, settled by the earliest option" : "Result"}>
          <span className={results.winner.edition ? "book-title text-base" : undefined}>{optionLabel(results.winner, tz)}</span>
          {" won with "}
          {results.winner.votes} {results.winner.votes === 1 ? "vote" : "votes"}.
          {poll.appliedAt && (poll.kind === "book" ? " It is on the reading list." : poll.kind === "date" ? " The meeting is scheduled." : "")}
        </Alert>
      )}
      {!poll.anonymous && poll.status === "closed" && poll.totalVoters > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-ink-muted">
          Voters:
          {Array.from(new Map(poll.options.flatMap((o) => o.voters).map((v) => [v.id, v])).values()).map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1">
              <Avatar member={v} size="xs" /> {v.displayName}
            </span>
          ))}
        </p>
      )}

      {(canClose || isAdmin) && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {canClose && (
            <Button variant="secondary" size="sm" icon={Lock} onClick={() => setConfirmClose(true)}>
              Close poll
            </Button>
          )}
          {isAdmin && poll.status === "closed" && !poll.appliedAt && results.winner && poll.kind !== "custom" && (
            <Button size="sm" icon={Sparkles} onClick={() => setConfirmApply(true)}>
              Apply result
            </Button>
          )}
          {isAdmin && (
            <Button variant="ghost" size="sm" icon={Archive} loading={archive.isPending} onClick={() => archive.mutate(undefined)}>
              Archive
            </Button>
          )}
        </div>
      )}

      <Dialog open={confirmClose} onClose={() => setConfirmClose(false)} title="Close this poll">
        <div className="space-y-4 text-sm">
          <p>Voting stops and the option with the most votes wins. Ties go to the option listed first.</p>
          <div className="flex gap-2">
            <Button loading={close.isPending} onClick={() => close.mutate(undefined, { onSuccess: () => setConfirmClose(false) })}>
              Close poll
            </Button>
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>
              Keep open
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog open={confirmApply} onClose={() => setConfirmApply(false)} title="Apply the result">
        <div className="space-y-4 text-sm">
          {results.winner && (
            <p>
              {poll.kind === "book" ? (
                <>
                  <span className="book-title text-base">{results.winner.label}</span> is added to the {poll.year ?? "current"} reading list as planned, and the club is told.
                </>
              ) : (
                <>A meeting is {poll.meetingId ? "moved to" : "created for"} {optionLabel(results.winner, tz)}.</>
              )}
            </p>
          )}
          <div className="flex gap-2">
            <Button loading={apply.isPending} onClick={() => apply.mutate(undefined, { onSuccess: () => setConfirmApply(false) })}>
              Apply
            </Button>
            <Button variant="ghost" onClick={() => setConfirmApply(false)}>
              Not now
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add an option" wide={poll.kind === "book"}>
        {poll.kind === "book" ? (
          <BookPicker pickLabel="Add" onPick={(e) => addOption.mutate({ label: e.title, editionId: e.id }, { onSuccess: () => setAdding(false) })} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (poll.kind === "date") {
                const iso = zonedToIso(newStart, tz);
                if (!iso) return;
                addOption.mutate({ label: formatInZone(iso, tz, { dateStyle: "medium", timeStyle: "short" }), startsAt: iso }, { onSuccess: () => setAdding(false) });
              } else if (newLabel.trim()) {
                addOption.mutate({ label: newLabel.trim() }, { onSuccess: () => setAdding(false) });
              }
            }}
          >
            {poll.kind === "date" ? (
              <Field label="Starts" hint={`In ${tz.replace(/_/g, " ")}.`}>
                {(id, d) => <Input id={id} aria-describedby={d} type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} required />}
              </Field>
            ) : (
              <Field label="Option">{(id) => <Input id={id} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} maxLength={200} autoFocus />}</Field>
            )}
            <Button type="submit" loading={addOption.isPending}>
              Add option
            </Button>
          </form>
        )}
      </Dialog>
    </Card>
  );
}
