import { Check, Crown } from "lucide-react";
import type { Poll, PollOption } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { BookCover } from "@/components/BookCover";
import { Badge, cx } from "@/components/ui";
import { formatInZone, zoneAbbr } from "@/lib/calendar";
import { pollResults } from "./results";

export function optionLabel(o: PollOption, tz: string) {
  if (o.startsAt) {
    const start = formatInZone(o.startsAt, tz, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const end = o.endsAt ? ` to ${formatInZone(o.endsAt, tz, { hour: "numeric", minute: "2-digit" })}` : "";
    return `${start}${end} ${zoneAbbr(o.startsAt, tz)}`;
  }
  return o.label;
}

/**
 * Options with result bars. When `selected` and `onToggle` are given the rows are
 * selectable (radio or checkbox semantics depending on the poll).
 */
export function PollOptionRows({ poll, tz, selected, onToggle, compact = false }: { poll: Poll; tz: string; selected?: Set<string>; onToggle?: (id: string) => void; compact?: boolean }) {
  const results = pollResults(poll);
  const closed = poll.status === "closed";
  const interactive = !!onToggle && !closed;
  const Row = interactive ? "button" : "div";
  return (
    <ul className={cx("space-y-2", compact && "space-y-1.5")} role={interactive ? (poll.allowMultiple ? "group" : "radiogroup") : undefined} aria-label={interactive ? "Options" : undefined}>
      {results.options.map(({ option: o, votes, percent, leading }) => {
        const isSelected = selected ? selected.has(o.id) : o.mine;
        const won = closed && results.winner?.id === o.id;
        return (
          <li key={o.id}>
            <Row
              type={interactive ? "button" : undefined}
              role={interactive ? (poll.allowMultiple ? "checkbox" : "radio") : undefined}
              aria-checked={interactive ? isSelected : undefined}
              onClick={interactive ? () => onToggle!(o.id) : undefined}
              className={cx(
                "relative block w-full overflow-hidden rounded-control border text-left",
                compact ? "px-2.5 py-1.5" : "px-3 py-2.5",
                isSelected ? "border-primary" : "border-line",
                interactive && "hover:bg-surface-2",
                won && "border-accent",
              )}
            >
              <span aria-hidden className={cx("absolute inset-y-0 left-0 transition-[width]", won ? "bg-accent-soft" : isSelected ? "bg-primary/10" : "bg-surface-2")} style={{ width: `${percent}%` }} />
              <span className="relative flex items-center gap-2.5">
                {interactive && (
                  <span className={cx("inline-flex size-5 shrink-0 items-center justify-center border", poll.allowMultiple ? "rounded-[5px]" : "rounded-full", isSelected ? "border-primary bg-primary text-on-primary" : "border-line bg-surface")} aria-hidden>
                    {isSelected && <Check className="size-3.5" />}
                  </span>
                )}
                {!interactive && o.mine && <Check className="size-4 shrink-0 text-ink" aria-label="Your vote" />}
                {o.edition && !compact && <BookCover url={o.edition.coverUrl} title={o.edition.title} size="xs" />}
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate", o.edition && "book-title text-[17px]", compact && "text-sm")}>{optionLabel(o, tz)}</span>
                  {o.edition && !compact && o.edition.authors.length > 0 && <span className="block truncate text-xs text-ink-muted">{o.edition.authors.join(", ")}</span>}
                </span>
                {won && (
                  <Badge tone="brass">
                    <Crown className="size-3" aria-hidden /> Winner
                  </Badge>
                )}
                {!closed && leading && !compact && results.totalVotes > 0 && <Badge tone="neutral">Leading</Badge>}
                <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                  {votes} <span className="sr-only">{votes === 1 ? "vote" : "votes"}</span>
                  {!compact && <span aria-hidden> · {percent}%</span>}
                </span>
              </span>
              {!poll.anonymous && o.voters.length > 0 && !compact && (
                <span className="relative mt-1.5 flex items-center gap-1 pl-7">
                  <span className="flex -space-x-1.5">
                    {o.voters.slice(0, 8).map((v) => (
                      <Avatar key={v.id} member={v} size="xs" className="ring-2 ring-surface" />
                    ))}
                  </span>
                  <span className="truncate text-xs text-ink-muted">{o.voters.map((v) => v.displayName).join(", ")}</span>
                </span>
              )}
            </Row>
          </li>
        );
      })}
    </ul>
  );
}
