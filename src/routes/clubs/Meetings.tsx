import { CalendarDays, CalendarRange, List, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { CalendarItem, CalendarYear, MeetingFull } from "@shared/types";
import { useClubTimezone, useMeetings } from "@/components/meetings/api";
import { CalendarGrid, CalendarLegend, MonthNav, YearGrid } from "@/components/meetings/CalendarGrid";
import { MeetingCard } from "@/components/meetings/MeetingCard";
import { MeetingForm } from "@/components/meetings/MeetingForm";
import { Alert, Button, Checkbox, cx, EmptyState, PageHeader, Spinner, Tabs } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { errorMessage } from "@/lib/api";
import { itemDateKey, monthKeyOf, shiftMonth, todayKey, type MonthKey } from "@/lib/calendar";
import { clubPath, useClub } from "@/lib/club";
import { useDocumentTitle } from "@/lib/hooks";

export { MeetingDetailPage } from "@/components/meetings/MeetingDetail";

type View = "list" | "month" | "year";

export function meetingToCalendarItem(m: MeetingFull, clubId: string): CalendarItem {
  return { id: m.id, kind: "meeting", title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, allDay: false, link: clubPath(clubId, `meetings/${m.id}`), edition: m.edition, rsvp: m.rsvp.mine };
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const options: { value: View; label: string; icon: typeof List }[] = [
    { value: "list", label: "List", icon: List },
    { value: "month", label: "Month", icon: CalendarDays },
    { value: "year", label: "Year", icon: CalendarRange },
  ];
  return (
    <div role="radiogroup" aria-label="View" className="inline-flex rounded-control border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={view === o.value}
          onClick={() => onChange(o.value)}
          className={cx("inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-sm font-medium", view === o.value ? "bg-primary text-on-primary" : "text-ink-muted hover:text-ink")}
        >
          <o.icon className="size-4" aria-hidden /> {o.label}
        </button>
      ))}
    </div>
  );
}

function MeetingsMonth({ clubId, month, onMonth, tz }: { clubId: string; month: MonthKey; onMonth: (m: MonthKey) => void; tz: string }) {
  const from = `${month}-01`;
  const to = `${shiftMonth(month, 1)}-01`;
  const q = useMeetings(clubId, "all", { from, to });
  return (
    <div>
      <MonthNav month={month} onChange={onMonth}>
        <CalendarLegend />
      </MonthNav>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && <CalendarGrid month={month} timezone={tz} items={q.data.filter((m) => !m.archivedAt).map((m) => meetingToCalendarItem(m, clubId))} emptyText="No meetings this month." />}
    </div>
  );
}

function MeetingsYear({ clubId, year, onYear, onPickMonth, tz }: { clubId: string; year: number; onYear: (y: number) => void; onPickMonth: (m: MonthKey) => void; tz: string }) {
  const q = useMeetings(clubId, "all", { from: `${year}-01-01`, to: `${year + 1}-01-01` });
  const months: CalendarYear["months"] = Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const items = (q.data ?? []).filter((m) => !m.archivedAt && itemDateKey({ startsAt: m.startsAt, allDay: false }, tz).startsWith(month)).map((m) => meetingToCalendarItem(m, clubId));
    return { month, counts: { meetings: items.length, assignments: 0, polls: 0 }, items };
  });
  return (
    <div>
      <div className="mb-3 flex items-center gap-1">
        <Button size="sm" variant="secondary" onClick={() => onYear(year - 1)} aria-label="Previous year">
          {year - 1}
        </Button>
        <h2 className="heading-s min-w-24 text-center">{year}</h2>
        <Button size="sm" variant="secondary" onClick={() => onYear(year + 1)} aria-label="Next year">
          {year + 1}
        </Button>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && <YearGrid year={year} months={months} timezone={tz} onPickMonth={onPickMonth} />}
    </div>
  );
}

export function MeetingsPage() {
  const club = useClub();
  const tz = useClubTimezone();
  const navigate = useNavigate();
  useDocumentTitle(`Meetings · ${club.name}`);
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as View | null) ?? "list";
  const when = params.get("when") === "past" ? "past" : "upcoming";
  const month = params.get("month") ?? monthKeyOf(todayKey(tz));
  const year = Number(params.get("year")) || Number(month.slice(0, 4));
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const list = useMeetings(club.id, when, undefined, showArchived);

  return (
    <div>
      <PageHeader
        eyebrow={club.name}
        title="Meetings"
        description="When and where the club meets. Any member can plan a meeting; RSVPs, roles and notes live on each one."
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            Plan meeting
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ViewToggle view={view} onChange={(v) => set({ view: v === "list" ? null : v })} />
        {view === "list" && <Checkbox label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />}
      </div>

      {view === "list" && (
        <>
          <Tabs label="Meetings" value={when} onChange={(v) => set({ when: v === "upcoming" ? null : v })} tabs={[{ value: "upcoming" as const, label: "Upcoming" }, { value: "past" as const, label: "Past" }]} />
          {list.isPending && <Spinner />}
          {list.isError && <Alert tone="error">{errorMessage(list.error)}</Alert>}
          {list.data?.length === 0 && (
            <EmptyState icon={CalendarDays} title={when === "upcoming" ? "Nothing scheduled" : "No past meetings"} action={when === "upcoming" ? <Button icon={Plus} onClick={() => setCreating(true)}>Plan meeting</Button> : undefined}>
              {when === "upcoming" ? "Pick a date, a place and a book to talk about." : "Past meetings keep their notes and attendance here."}
            </EmptyState>
          )}
          <ul className="space-y-3">
            {list.data?.map((m) => (
              <li key={m.id}>
                <MeetingCard meeting={m} clubId={club.id} clubZone={tz} past={when === "past"} />
              </li>
            ))}
          </ul>
        </>
      )}
      {view === "month" && <MeetingsMonth clubId={club.id} month={month} onMonth={(m) => set({ month: m })} tz={tz} />}
      {view === "year" && <MeetingsYear clubId={club.id} year={year} onYear={(y) => set({ year: String(y) })} onPickMonth={(m) => set({ view: "month", month: m })} tz={tz} />}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Plan a meeting" wide>
        <MeetingForm
          clubId={club.id}
          onDone={(m) => {
            setCreating(false);
            if (m?.id) navigate(clubPath(club.id, `meetings/${m.id}`));
          }}
        />
      </Dialog>
    </div>
  );
}
