import { useQuery } from "@tanstack/react-query";
import { Plus, Trophy } from "lucide-react";
import { useState } from "react";
import type { Challenge, Genre } from "@shared/types";
import { ChallengeCard, ChallengeForm, challengeState } from "@/components/growth/Challenges";
import { clubApi } from "@/components/records";
import { Alert, Button, EmptyState, PageHeader, Spinner, Tabs } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { isAdmin, useClub } from "@/lib/club";
import { useDocumentTitle } from "@/lib/hooks";

type View = "open" | "upcoming" | "ended";

export function ClubChallengesPage() {
  const club = useClub();
  useDocumentTitle(`Challenges · ${club.name}`);
  const { data: session } = useSession();
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<View>("open");
  const basePath = clubApi(club.id, "/challenges");
  const queryKey = ["challenges", "club", club.id];
  const q = useQuery({ queryKey, queryFn: () => api<Challenge[] | { items: Challenge[] }>(basePath).then((r) => (Array.isArray(r) ? r : r.items)) });
  const genres = useQuery({ queryKey: ["genres", club.id, false], queryFn: () => api<Genre[]>(clubApi(club.id, "/genres")) });
  const admin = isAdmin(club);
  const all = q.data ?? [];
  const visible = all.filter((c) => challengeState(c) === view);
  const counts = { open: 0, upcoming: 0, ended: 0 };
  for (const c of all) counts[challengeState(c)]++;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={club.name}
        title="Challenges"
        description="Shared targets with a leaderboard. Progress comes from what members finish and log."
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            New challenge
          </Button>
        }
      />
      <Tabs
        label="Challenge status"
        value={view}
        onChange={setView}
        tabs={[
          { value: "open", label: "Open", count: counts.open },
          { value: "upcoming", label: "Upcoming", count: counts.upcoming },
          { value: "ended", label: "Ended", count: counts.ended },
        ]}
      />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.isSuccess && visible.length === 0 && (
        <EmptyState icon={Trophy} title={all.length === 0 ? "No challenges yet" : `Nothing ${view}`} action={<Button onClick={() => setCreating(true)}>New challenge</Button>}>
          {all.length === 0 ? "Twelve books this year, a genre month, a two-week streak: pick one and invite the club." : undefined}
        </EmptyState>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {visible.map((c) => (
          <ChallengeCard key={c.id} challenge={c} basePath={basePath} queryKey={queryKey} canEdit={admin || c.owner?.id === session?.user.id} genres={genres.data} viewerId={session?.user.id} />
        ))}
      </div>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New club challenge">
        <ChallengeForm basePath={basePath} genres={genres.data} queryKey={queryKey} onDone={() => setCreating(false)} />
      </Dialog>
    </div>
  );
}
