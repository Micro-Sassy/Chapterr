import { useQuery } from "@tanstack/react-query";
import { Copy, Printer } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { MeetingDetail, MeetingPack } from "@shared/types";
import { clubApi } from "@/components/records";
import { Alert, Button, Spinner } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api, errorMessage } from "@/lib/api";
import { formatMeetingWhen } from "@/lib/calendar";
import { meetingKeys } from "./api";
import { rsvpSummaryLine } from "./RsvpChips";

/** The pack as plain text, for the clipboard and for printing. */
export function packToText(pack: MeetingPack, meeting: Pick<MeetingDetail, "title" | "startsAt" | "endsAt" | "location">, tz: string): string {
  const lines: string[] = [meeting.title, formatMeetingWhen(meeting.startsAt, meeting.endsAt, tz)];
  if (meeting.location) lines.push(meeting.location);
  if (pack.book) lines.push(`Book: ${pack.book.title}${pack.book.authors.length ? ` by ${pack.book.authors.join(", ")}` : ""}`);
  lines.push("");
  for (const section of pack.agenda) {
    lines.push(section.title.toUpperCase());
    for (const item of section.items) lines.push(`- ${item}`);
    lines.push("");
  }
  if (pack.questions.length) {
    lines.push("DISCUSSION QUESTIONS");
    pack.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
    lines.push("");
  }
  if (pack.quotes.length) {
    lines.push("QUOTES");
    for (const q of pack.quotes) lines.push(`"${q.text}" (${q.author}${q.location ? `, ${q.location}` : ""})`);
    lines.push("");
  }
  if (pack.reviews.length) {
    lines.push("WHAT THE CLUB THOUGHT");
    for (const r of pack.reviews) lines.push(`${r.author}, ${r.sentiment}: ${r.excerpt}`);
    lines.push("");
  }
  if (pack.lastNotes) {
    lines.push(`LAST TIME (${pack.lastNotes.meetingTitle})`);
    lines.push(pack.lastNotes.notes);
    lines.push("");
  }
  lines.push("RSVP");
  lines.push(rsvpSummaryLine(pack.rsvp));
  if (pack.signupGaps.length) {
    lines.push("");
    lines.push("STILL NEEDED");
    for (const g of pack.signupGaps) lines.push(`- ${g.item} (${g.needed}) for ${g.list}`);
  }
  return lines.join("\n").trim();
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="label mb-1.5 text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

/** Agenda, questions, quotes, reviews, last notes, RSVP and gaps in one place; copy or print it. */
export function MeetingPackDrawer({ open, onClose, meeting: m, clubId, tz }: { open: boolean; onClose: () => void; meeting: MeetingDetail; clubId: string; tz: string }) {
  const q = useQuery({ queryKey: meetingKeys.pack(clubId, m.id), queryFn: () => api<MeetingPack>(clubApi(clubId, `/meetings/${m.id}/pack`)), enabled: open, staleTime: 60_000 });
  const [copied, setCopied] = useState(false);
  const text = q.data ? packToText(q.data, m, tz) : "";
  const print = () => {
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return;
    w.document.title = `${m.title} meeting pack`;
    const pre = w.document.createElement("pre");
    pre.textContent = text;
    pre.style.whiteSpace = "pre-wrap";
    pre.style.font = "14px/1.5 Georgia, serif";
    pre.style.margin = "32px";
    w.document.body.appendChild(pre);
    w.focus();
    w.print();
  };
  return (
    <Dialog open={open} onClose={onClose} title="Meeting pack" wide>
      {q.isPending && <Spinner label="Putting the pack together" />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={Copy}
              onClick={async () => {
                await navigator.clipboard?.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied" : "Copy text"}
            </Button>
            <Button size="sm" variant="secondary" icon={Printer} onClick={print}>
              Print
            </Button>
          </div>
          {q.data.book && (
            <p>
              <span className="text-ink-muted">Book: </span>
              <span className="book-title text-lg">{q.data.book.title}</span>
              {q.data.book.authors.length > 0 && <span className="text-ink-muted"> by {q.data.book.authors.join(", ")}</span>}
            </p>
          )}
          {q.data.agenda.map((s) => (
            <Section key={s.title} title={s.title}>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {s.items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </Section>
          ))}
          {q.data.questions.length > 0 && (
            <Section title="Discussion questions">
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {q.data.questions.map((qu, i) => (
                  <li key={i}>{qu}</li>
                ))}
              </ol>
            </Section>
          )}
          {q.data.quotes.length > 0 && (
            <Section title="Quotes">
              <ul className="space-y-2">
                {q.data.quotes.map((qu, i) => (
                  <li key={i} className="border-l-2 border-accent pl-3 text-sm">
                    <span className="font-display text-base">“{qu.text}”</span>
                    <span className="block text-xs text-ink-muted">
                      {qu.author}
                      {qu.location ? `, ${qu.location}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {q.data.reviews.length > 0 && (
            <Section title="What the club thought">
              <ul className="space-y-1.5 text-sm">
                {q.data.reviews.map((r, i) => (
                  <li key={i}>
                    <span className="font-medium">{r.author}</span> <span className="text-ink-muted">({r.sentiment})</span>: {r.excerpt}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {q.data.lastNotes && (
            <Section title={`Last time: ${q.data.lastNotes.meetingTitle}`}>
              <p className="whitespace-pre-wrap text-sm">{q.data.lastNotes.notes}</p>
            </Section>
          )}
          <Section title="RSVP">
            <p className="text-sm">{rsvpSummaryLine(q.data.rsvp)}</p>
          </Section>
          {q.data.signupGaps.length > 0 && (
            <Section title="Still needed">
              <ul className="list-disc pl-5 text-sm">
                {q.data.signupGaps.map((g, i) => (
                  <li key={i}>
                    {g.item} ({g.needed}) for {g.list}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </Dialog>
  );
}
