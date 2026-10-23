import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Gift, Plus, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import type { Challenge, MonthlyRecap, ReadingLogEntry, Streak, UserBook } from "@shared/types";
import { ChallengeCard, ChallengeForm } from "@/components/growth/Challenges";
import { isoDay } from "@/components/growth/streak";
import { StreakStrip } from "@/components/growth/StreakStrip";
import { RecapCard } from "@/components/recap/RecapCard";
import { Alert, Button, Card, EmptyState, Field, Input, LinkButton, PageHeader, SectionTitle, Select, Spinner, Stat, Textarea, TextLink } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { clubPath, useMe } from "@/lib/club";
import { formatDate, todayIso } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

const PERSONAL_CHALLENGES = "/api/challenges";

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

function TodayLog({ day, entry, library }: { day: string; entry: ReadingLogEntry | null; library: UserBook[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pages, setPages] = useState(entry ? String(entry.pages || "") : "");
  const [minutes, setMinutes] = useState(entry ? String(entry.minutes || "") : "");
  const [editionId, setEditionId] = useState(entry?.edition?.id ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  useEffect(() => {
    setPages(entry ? String(entry.pages || "") : "");
    setMinutes(entry ? String(entry.minutes || "") : "");
    setEditionId(entry?.edition?.id ?? "");
    setNote(entry?.note ?? "");
  }, [entry, day]);
  const save = useMutation({
    mutationFn: () => api<{ entry: ReadingLogEntry; streak: Streak }>(`/api/reading-log/${day}?today=${todayIso()}`, { method: "PUT", body: { pages: Number(pages) || 0, minutes: Number(minutes) || 0, editionId: editionId || null, note: note || null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reading-log"] });
      void qc.invalidateQueries({ queryKey: ["streak"] });
      void qc.invalidateQueries({ queryKey: ["recap"] });
      void qc.invalidateQueries({ queryKey: ["challenges"] });
      toast(day === todayIso() ? "Logged. Streak kept." : "Logged.");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const reading = library.filter((b) => b.status === "reading");
  const others = library.filter((b) => b.status !== "reading");
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pages read">{(id) => <Input id={id} type="number" inputMode="numeric" min={0} max={5000} value={pages} onChange={(e) => setPages(e.target.value)} />}</Field>
        <Field label="Minutes read">{(id) => <Input id={id} type="number" inputMode="numeric" min={0} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} />}</Field>
      </div>
      <Field label="Book" hint={library.length ? undefined : "Add books to your library to pick one here."}>
        {(id, d) => (
          <Select id={id} aria-describedby={d} value={editionId} onChange={(e) => setEditionId(e.target.value)}>
            <option value="">Not tied to a book</option>
            {reading.length > 0 && (
              <optgroup label="Reading now">
                {reading.map((b) => (
                  <option key={b.id} value={b.edition.id}>
                    {b.edition.title}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Elsewhere on the shelf">
                {others.map((b) => (
                  <option key={b.id} value={b.edition.id}>
                    {b.edition.title}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        )}
      </Field>
      <Field label="Note" hint="A line for yourself. Only you can see it.">
        {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <Button type="submit" loading={save.isPending} disabled={!pages && !minutes && !note}>
        {entry && (entry.pages || entry.minutes) ? "Update log" : "Log reading"}
      </Button>
    </form>
  );
}

export function ReadingPage() {
  useDocumentTitle("Reading log");
  const { data: session } = useSession();
  const me = useMe();
  const today = todayIso();
  const [day, setDay] = useState(today);
  const [creating, setCreating] = useState(false);
  const from = addDays(today, -(12 * 7 + 6));
  const streak = useQuery({ queryKey: ["streak"], queryFn: () => api<Streak>(`/api/reading-log/streak?today=${todayIso()}`) });
  const log = useQuery({ queryKey: ["reading-log", from, today], queryFn: () => api<ReadingLogEntry[]>(`/api/reading-log?from=${from}&to=${today}&today=${today}`) });
  const library = useQuery({ queryKey: ["library"], queryFn: () => api<UserBook[]>("/api/library") });
  const month = today.slice(0, 7);
  const recap = useQuery({ queryKey: ["recap", "me", month], queryFn: () => api<MonthlyRecap>(`/api/recaps/monthly?month=${month}`) });
  const challenges = useQuery({ queryKey: ["challenges", "me"], queryFn: () => api<Challenge[]>(PERSONAL_CHALLENGES) });
  const entries = log.data ?? [];
  const entryForDay = entries.find((e) => e.day === day) ?? null;
  const s = streak.data;

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="You" title="Reading log" description="A few pages a day keeps the streak alive." />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="space-y-5">
          <div className="flex items-start gap-4">
            <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-control bg-accent-soft text-ink">
              <Flame className="size-6" aria-hidden strokeWidth={1.75} />
            </span>
            <div>
              <p className="label text-ink-muted">Current streak</p>
              {streak.isPending ? (
                <Spinner />
              ) : streak.isError ? (
                <Alert tone="error">{errorMessage(streak.error)}</Alert>
              ) : (
                <>
                  <p className="font-display text-5xl font-semibold leading-none">
                    {s?.current ?? 0}
                    <span className="ml-2 text-lg font-medium text-ink-muted">{s?.current === 1 ? "day" : "days"}</span>
                  </p>
                  <p className="mt-2 text-sm text-ink-muted">{s?.today ? "Logged today. Nicely kept." : s?.current ? "Log today to keep it going." : "Log a few pages today to start one."}</p>
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Stat value={s?.longest ?? 0} label="longest streak" />
            <Stat value={s?.lastDay ? formatDate(s.lastDay, { month: "short", day: "numeric" }) : "–"} label="last logged" />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Last 12 weeks</p>
            {log.isPending ? <Spinner /> : <StreakStrip entries={entries} today={today} />}
          </div>
        </Card>
        <Card>
          <SectionTitle
            as="h2"
            action={
              <Input type="date" aria-label="Day to log" className="h-9 w-auto text-sm" max={today} min={from} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
            }
          >
            {day === today ? "Today" : formatDate(day)}
          </SectionTitle>
          {log.isPending || library.isPending ? <Spinner /> : <TodayLog day={day} entry={entryForDay} library={library.data ?? []} />}
        </Card>
      </section>

      <section>
        <SectionTitle as="h2">This month</SectionTitle>
        {recap.isPending && <Spinner />}
        {recap.isError && <Alert tone="error">{errorMessage(recap.error)}</Alert>}
        {recap.data && <RecapCard recap={recap.data} subject={session?.user.name ?? "My reading"} />}
      </section>

      <section>
        <SectionTitle
          as="h2"
          action={
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
              New challenge
            </Button>
          }
        >
          Challenges
        </SectionTitle>
        {challenges.isPending && <Spinner />}
        {challenges.isError && <Alert tone="error">{errorMessage(challenges.error)}</Alert>}
        {challenges.data?.length === 0 && (
          <EmptyState icon={Trophy} title="No challenges yet" action={<Button onClick={() => setCreating(true)}>New challenge</Button>}>
            Set a personal target, or join one of your club's challenges below.
          </EmptyState>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {challenges.data?.map((c) => (
            <ChallengeCard key={c.id} challenge={c} basePath={c.clubId ? `/api/clubs/${c.clubId}/challenges` : PERSONAL_CHALLENGES} queryKey={["challenges"]} canEdit={!c.clubId} viewerId={session?.user.id} showLeaderboard={false} />
          ))}
        </div>
        {me.data && me.data.clubs.length > 0 && (
          <p className="mt-4 text-sm text-ink-muted">
            Club challenges:{" "}
            {me.data.clubs.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <TextLink to={clubPath(c.id, "challenges")}>{c.name}</TextLink>
              </span>
            ))}
          </p>
        )}
      </section>

      {me.data && me.data.clubs.length > 0 && (
        <section>
          <SectionTitle as="h2">Club Wrapped</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {me.data.clubs.map((c) => (
              <LinkButton key={c.id} to={clubPath(c.id, "wrapped")} variant="secondary" icon={Gift}>
                {c.name}
              </LinkButton>
            ))}
          </div>
        </section>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="New personal challenge">
        <ChallengeForm basePath={PERSONAL_CHALLENGES} queryKey={["challenges"]} onDone={() => setCreating(false)} />
      </Dialog>
    </div>
  );
}
