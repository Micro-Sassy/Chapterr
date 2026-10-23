import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CalendarRange, Copy, Download, Rss } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import type { CalendarFeedUrl, CalendarMonth, CalendarYear } from "@shared/types";
import { meetingKeys, useClubTimezone } from "@/components/meetings/api";
import { CalendarGrid, CalendarLegend, MonthNav, YearGrid } from "@/components/meetings/CalendarGrid";
import { clubApi } from "@/components/records";
import { Alert, Button, buttonClass, cx, Input, PageHeader, Spinner } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api, errorMessage } from "@/lib/api";
import { monthKeyOf, todayKey, type MonthKey } from "@/lib/calendar";
import { useClub } from "@/lib/club";
import { useDocumentTitle } from "@/lib/hooks";

function SubscribeDialog({ open, onClose, clubId }: { open: boolean; onClose: () => void; clubId: string }) {
  const q = useQuery({ queryKey: ["calendar-feed-url", clubId], queryFn: () => api<CalendarFeedUrl>(clubApi(clubId, "/calendar/feed-url")), enabled: open, staleTime: Infinity });
  const [copied, setCopied] = useState(false);
  const url = q.data?.url ?? "";
  const webcal = url.replace(/^https?:/, "webcal:");
  return (
    <Dialog open={open} onClose={onClose} title="Subscribe to the calendar">
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && (
        <div className="space-y-4 text-sm">
          <p>Your calendar app checks this address for meetings, due dates and poll deadlines, and keeps itself up to date. The link is yours alone; treat it like a password.</p>
          <div className="flex gap-2">
            <Input readOnly value={url} aria-label="Calendar feed address" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="secondary"
              icon={Copy}
              onClick={async () => {
                await navigator.clipboard?.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer noopener" className={buttonClass("secondary")}>
              Google Calendar
            </a>
            <a href={webcal} className={buttonClass("secondary")}>
              Apple Calendar
            </a>
          </div>
          <details className="rounded-control border border-line p-3">
            <summary className="cursor-pointer font-medium">Add it by hand</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
              <li>Google Calendar: Other calendars, then From URL, then paste the address.</li>
              <li>Apple Calendar: File, New Calendar Subscription, then paste the address.</li>
              <li>Outlook: Add calendar, Subscribe from web, then paste the address.</li>
            </ul>
          </details>
          <a href={url} download="chapterr.ics" className={buttonClass("ghost", "sm")}>
            <Download className="size-4" aria-hidden /> Download .ics once
          </a>
        </div>
      )}
    </Dialog>
  );
}

export function CalendarPage() {
  const club = useClub();
  const tz = useClubTimezone();
  useDocumentTitle(`Calendar · ${club.name}`);
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "year" ? "year" : "month";
  const month: MonthKey = params.get("month") ?? monthKeyOf(todayKey(tz));
  const year = Number(params.get("year")) || Number(month.slice(0, 4));
  const [subscribing, setSubscribing] = useState(false);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const monthQ = useQuery({
    queryKey: [...meetingKeys.calendar(club.id), "month", month],
    queryFn: () => api<CalendarMonth>(clubApi(club.id, `/calendar?month=${month}`)),
    enabled: view === "month",
    refetchOnWindowFocus: true,
  });
  const yearQ = useQuery({
    queryKey: [...meetingKeys.calendar(club.id), "year", year],
    queryFn: () => api<CalendarYear>(clubApi(club.id, `/calendar?year=${year}`)),
    enabled: view === "year",
    refetchOnWindowFocus: true,
  });

  return (
    <div>
      <PageHeader
        eyebrow={club.name}
        title="Calendar"
        description={`Meetings, reading due dates and poll deadlines, shown in ${tz.replace(/_/g, " ")}.`}
        actions={
          <>
            <div role="radiogroup" aria-label="View" className="inline-flex rounded-control border border-line bg-surface p-0.5">
              {(["month", "year"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => set({ view: v === "month" ? null : v })}
                  className={cx("inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-sm font-medium", view === v ? "bg-primary text-on-primary" : "text-ink-muted hover:text-ink")}
                >
                  {v === "month" ? <CalendarDays className="size-4" aria-hidden /> : <CalendarRange className="size-4" aria-hidden />} {v === "month" ? "Month" : "Year"}
                </button>
              ))}
            </div>
            <Button variant="secondary" icon={Rss} onClick={() => setSubscribing(true)}>
              Subscribe
            </Button>
          </>
        }
      />
      {view === "month" && (
        <>
          <MonthNav month={month} onChange={(m) => set({ month: m })}>
            <CalendarLegend />
          </MonthNav>
          {monthQ.isPending && <Spinner />}
          {monthQ.isError && <Alert tone="error">{errorMessage(monthQ.error)}</Alert>}
          {monthQ.data && <CalendarGrid month={month} items={monthQ.data.items} timezone={tz} />}
        </>
      )}
      {view === "year" && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button size="sm" variant="secondary" onClick={() => set({ year: String(year - 1) })} aria-label="Previous year">
                {year - 1}
              </Button>
              <h2 className="heading-s min-w-24 text-center">{year}</h2>
              <Button size="sm" variant="secondary" onClick={() => set({ year: String(year + 1) })} aria-label="Next year">
                {year + 1}
              </Button>
            </div>
            <CalendarLegend />
          </div>
          {yearQ.isPending && <Spinner />}
          {yearQ.isError && <Alert tone="error">{errorMessage(yearQ.error)}</Alert>}
          {yearQ.data && <YearGrid year={year} months={yearQ.data.months} timezone={tz} onPickMonth={(m) => set({ view: null, month: m })} />}
        </>
      )}
      <SubscribeDialog open={subscribing} onClose={() => setSubscribing(false)} clubId={club.id} />
    </div>
  );
}
