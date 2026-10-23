import { ExternalLink, MapPin, Repeat, Users } from "lucide-react";
import { Link } from "react-router";
import type { MeetingFull } from "@shared/types";
import { BookCover } from "@/components/BookCover";
import { Badge, Card } from "@/components/ui";
import { clubPath } from "@/lib/club";
import { formatInZone, formatZonedTime, zoneAbbr } from "@/lib/calendar";
import { useRsvp } from "./api";
import { RsvpChips, rsvpSummaryLine } from "./RsvpChips";

/** A compact date block: weekday, day number, month, in the meeting's zone. */
export function DateBlock({ iso, timezone, muted }: { iso: string; timezone: string; muted?: boolean }) {
  return (
    <time dateTime={iso} className={`flex w-14 shrink-0 flex-col items-center rounded-control border py-1.5 text-center ${muted ? "border-line text-ink-muted" : "border-primary bg-primary text-on-primary"}`}>
      <span className="label">{formatInZone(iso, timezone, { weekday: "short" })}</span>
      <span className="font-display text-2xl font-medium leading-none">{formatInZone(iso, timezone, { day: "numeric" })}</span>
      <span className="text-[11px] uppercase tracking-wide">{formatInZone(iso, timezone, { month: "short" })}</span>
    </time>
  );
}

/** One row of the meetings list: when, where, the book, and the RSVP chips. */
export function MeetingCard({ meeting: m, clubId, clubZone, past = false }: { meeting: MeetingFull; clubId: string; clubZone: string; past?: boolean }) {
  const tz = m.timezone ?? clubZone;
  const rsvp = useRsvp(clubId, m.id);
  const href = clubPath(clubId, `meetings/${m.id}`);
  const roles = [m.roles.host && `Host: ${m.roles.host.displayName}`, m.roles.picker && `Picker: ${m.roles.picker.displayName}`, m.roles.notetaker && `Notes: ${m.roles.notetaker.displayName}`].filter(Boolean).join(" · ");
  return (
    <Card as="article" className={m.archivedAt ? "opacity-60" : undefined}>
      <div className="flex items-start gap-4">
        <DateBlock iso={m.startsAt} timezone={tz} muted={past || !!m.archivedAt} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="heading-s flex flex-wrap items-center gap-2">
            <Link to={href} className="hover:underline">
              {m.title}
            </Link>
            {m.seriesId && (
              <Badge tone="info">
                <Repeat className="size-3" aria-hidden /> Series{m.occurrence ? ` ${m.occurrence.index} of ${m.occurrence.total}` : ""}
              </Badge>
            )}
            {m.archivedAt && <Badge>Archived</Badge>}
          </h3>
          <p className="text-sm text-ink-muted">
            {formatZonedTime(m.startsAt, tz)}
            {m.endsAt ? ` to ${formatZonedTime(m.endsAt, tz)}` : ""} {zoneAbbr(m.startsAt, tz)}
          </p>
          {(m.location || m.locationUrl) && (
            <p className="flex items-center gap-1.5 text-sm text-ink-muted">
              <MapPin className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{m.location ?? "Online"}</span>
              {m.locationUrl && (
                <a href={m.locationUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline decoration-line underline-offset-2 hover:decoration-ink">
                  Open link <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </p>
          )}
          {m.edition && (
            <p className="flex items-center gap-2 pt-1">
              <BookCover url={m.edition.coverUrl} title={m.edition.title} size="xs" />
              <Link to={`/books/${m.edition.id}`} className="book-title text-[17px] hover:underline">
                {m.edition.title}
              </Link>
            </p>
          )}
          {roles && <p className="text-xs text-ink-muted">{roles}</p>}
          {!m.archivedAt && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {past ? (
                <span className="flex items-center gap-1.5 text-sm text-ink-muted">
                  <Users className="size-4" aria-hidden /> {m.attendance.marked ? `${m.attendance.present} attended` : rsvpSummaryLine(m.rsvp)}
                </span>
              ) : (
                <>
                  <RsvpChips size="sm" summary={m.rsvp} busy={rsvp.isPending} onChange={(status) => rsvp.mutate({ status, guests: status === "going" ? m.rsvp.myGuests : 0 })} label={`RSVP to ${m.title}`} />
                  {m.rsvp.goingGuests > 0 && <span className="text-xs text-ink-muted">+{m.rsvp.goingGuests} {m.rsvp.goingGuests === 1 ? "guest" : "guests"}</span>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
