import { useState } from "react";
import { RSVP_LABELS, RSVP_STATUSES } from "@shared/constants";
import type { MeetingDetail } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { MemberLink } from "@/components/content";
import { Button, Card, Field, Input, SectionTitle } from "@/components/ui";
import { useSession } from "@/lib/auth";
import { daysUntil, formatInZone, zoneAbbr } from "@/lib/calendar";
import { useRsvp } from "./api";
import { RsvpChips, rsvpSummaryLine } from "./RsvpChips";

function deadlineLine(deadline: string, tz: string, passed: boolean): string {
  const when = `${formatInZone(deadline, tz, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} ${zoneAbbr(deadline, tz)}`;
  if (passed) return `RSVPs closed ${when}.`;
  const days = daysUntil(deadline, tz);
  const left = days <= 0 ? "today" : days === 1 ? "tomorrow" : `${days} days left`;
  return `RSVP by ${when} (${left}).`;
}

/** Your reply with guests and a note, the deadline, and who said what. */
export function RsvpPanel({ meeting: m, clubId, tz }: { meeting: MeetingDetail; clubId: string; tz: string }) {
  const rsvp = useRsvp(clubId, m.id);
  const userId = useSession().data?.user.id;
  const mine = m.rsvps.find((r) => r.id === userId) ?? null;
  const [guests, setGuests] = useState(String(m.rsvp.myGuests ?? 0));
  const [note, setNote] = useState(mine?.note ?? "");
  const [editing, setEditing] = useState(false);
  const closed = m.rsvp.deadlinePassed;
  return (
    <Card>
      <SectionTitle as="h2">RSVP</SectionTitle>
      <RsvpChips summary={m.rsvp} busy={rsvp.isPending} onChange={(status) => rsvp.mutate({ status, guests: status === "going" ? Number(guests) || 0 : 0, note: note || null })} />
      {m.rsvpDeadline && <p className="mt-2 text-sm text-ink-muted">{deadlineLine(m.rsvpDeadline, tz, closed)}</p>}
      {m.rsvp.mine && !closed && (
        <div className="mt-3">
          {editing ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                rsvp.mutate({ status: m.rsvp.mine!, guests: m.rsvp.mine === "going" ? Number(guests) || 0 : 0, note: note || null }, { onSuccess: () => setEditing(false) });
              }}
            >
              {m.rsvp.mine === "going" && (
                <Field label="Guests" className="w-24">
                  {(id) => <Input id={id} type="number" min={0} max={10} value={guests} onChange={(e) => setGuests(e.target.value)} />}
                </Field>
              )}
              <Field label="Note (optional)" className="min-w-48 flex-1">
                {(id) => <Input id={id} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Running late, bringing a friend…" />}
              </Field>
              <Button type="submit" size="sm" loading={rsvp.isPending}>
                Save reply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {m.rsvp.mine === "going" ? "Edit reply" : "Add note"}
            </Button>
          )}
        </div>
      )}
      <p className="mt-4 text-sm font-medium">{rsvpSummaryLine(m.rsvp)}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {RSVP_STATUSES.map((status) => {
          const people = m.rsvps.filter((r) => r.status === status);
          return (
            <div key={status}>
              <h3 className="label mb-2 text-ink-muted">
                {RSVP_LABELS[status]} <span className="tabular-nums">{people.length}</span>
              </h3>
              {people.length === 0 ? (
                <p className="text-xs text-ink-muted">Nobody yet.</p>
              ) : (
                <ul className="space-y-2">
                  {people.map((r) => (
                    <li key={r.id} className="flex items-start gap-2 text-sm">
                      <Avatar member={r} size="xs" />
                      <span className="min-w-0">
                        <MemberLink member={r} className="font-medium" />
                        {r.guests > 0 && <span className="text-ink-muted"> +{r.guests}</span>}
                        {r.note && <span className="block text-xs text-ink-muted">{r.note}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
