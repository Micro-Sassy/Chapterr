import { ArrowLeft, Plus, Vote } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { PollKind } from "@shared/constants";
import type { Poll } from "@shared/types";
import { useClubTimezone } from "@/components/meetings/api";
import { POLL_KIND_LABELS, usePoll, usePolls } from "@/components/polls/api";
import { PollDetail, PollMeta } from "@/components/polls/PollDetail";
import { PollForm } from "@/components/polls/PollForm";
import { PollOptionRows } from "@/components/polls/PollOptionRows";
import { pollResults, turnoutLine } from "@/components/polls/results";
import { Alert, Button, Card, EmptyState, PageHeader, Spinner, Tabs, TextLink } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { clubPath, isAdmin, useClub } from "@/lib/club";
import { useDocumentTitle } from "@/lib/hooks";

function PollCard({ poll, clubId, tz }: { poll: Poll; clubId: string; tz: string }) {
  const r = pollResults(poll);
  return (
    <Card as="article" className="space-y-3">
      <div className="space-y-1">
        <h3 className="heading-s">
          <Link to={clubPath(clubId, `polls/${poll.id}`)} className="hover:underline">
            {poll.title}
          </Link>
        </h3>
        <PollMeta poll={poll} tz={tz} />
      </div>
      <PollOptionRows poll={poll} tz={tz} compact />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        <span>
          {turnoutLine(poll.totalVoters)}
          {r.options.some((o) => o.option.mine) ? " · you voted" : ""}
        </span>
        <TextLink to={clubPath(clubId, `polls/${poll.id}`)} className="text-sm">
          {poll.status === "open" ? (r.options.some((o) => o.option.mine) ? "Change vote" : "Vote") : "See result"}
        </TextLink>
      </div>
    </Card>
  );
}

function PollPage({ clubId, pollId, tz }: { clubId: string; pollId: string; tz: string }) {
  const club = useClub();
  const session = useSession();
  const q = usePoll(clubId, pollId);
  useDocumentTitle(q.data ? `${q.data.title} · ${club.name}` : "Poll");
  return (
    <div className="space-y-6">
      <TextLink to={clubPath(clubId, "polls")} className="inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" aria-hidden /> All polls
      </TextLink>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && <PollDetail poll={q.data} clubId={clubId} tz={tz} isAdmin={isAdmin(club)} userId={session.data?.user.id} memberCount={club.memberCount} />}
    </div>
  );
}

export function PollsPage() {
  const club = useClub();
  const tz = useClubTimezone();
  const navigate = useNavigate();
  const { pollId } = useParams();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<"open" | "closed">("open");
  const wantedKind = params.get("new") as PollKind | null;
  const [creating, setCreating] = useState(!!wantedKind);
  const q = usePolls(club.id, status);
  useDocumentTitle(`Polls · ${club.name}`);

  if (pollId) return <PollPage clubId={club.id} pollId={pollId} tz={tz} />;

  const closeCreate = () => {
    setCreating(false);
    if (params.has("new")) setParams({}, { replace: true });
  };

  return (
    <div>
      <PageHeader
        eyebrow={club.name}
        title="Polls"
        description="Pick the next book, settle on a date, or ask the club anything."
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            New poll
          </Button>
        }
      />
      <Tabs label="Polls" value={status} onChange={setStatus} tabs={[{ value: "open" as const, label: "Open" }, { value: "closed" as const, label: "Closed" }]} />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data?.length === 0 && (
        <EmptyState icon={Vote} title={status === "open" ? "No open polls" : "No closed polls yet"} action={status === "open" ? <Button icon={Plus} onClick={() => setCreating(true)}>New poll</Button> : undefined}>
          {status === "open" ? `Start one for the ${POLL_KIND_LABELS.book.toLowerCase()}, a ${POLL_KIND_LABELS.date.toLowerCase()} or a question.` : "Closed polls keep their results here."}
        </EmptyState>
      )}
      <ul className="grid gap-4 lg:grid-cols-2">
        {q.data?.map((p) => (
          <li key={p.id}>
            <PollCard poll={p} clubId={club.id} tz={tz} />
          </li>
        ))}
      </ul>
      <Dialog open={creating} onClose={closeCreate} title="New poll" wide>
        {creating && (
          <PollForm
            clubId={club.id}
            tz={tz}
            defaultKind={wantedKind && ["book", "date", "custom"].includes(wantedKind) ? wantedKind : "custom"}
            defaultYear={Number(params.get("year")) || undefined}
            onDone={(p) => {
              closeCreate();
              if (p?.id) navigate(clubPath(club.id, `polls/${p.id}`));
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
