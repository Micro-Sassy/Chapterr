import { Check } from "lucide-react";
import { RSVP_LABELS, RSVP_STATUSES, type RsvpStatus } from "@shared/constants";
import type { RsvpSummary } from "@shared/types";
import { cx } from "@/components/ui";

export interface RsvpChipState {
  status: RsvpStatus;
  label: string;
  count: number;
  selected: boolean;
}

/** Pure view state for the three RSVP chips. */
export function rsvpChipStates(summary: RsvpSummary): RsvpChipState[] {
  return RSVP_STATUSES.map((status) => ({ status, label: RSVP_LABELS[status], count: summary[status], selected: summary.mine === status }));
}

/** "4 going (+2 guests) · 1 maybe" */
export function rsvpSummaryLine(summary: RsvpSummary): string {
  const parts = [`${summary.going} going${summary.goingGuests ? ` (+${summary.goingGuests} ${summary.goingGuests === 1 ? "guest" : "guests"})` : ""}`];
  if (summary.maybe) parts.push(`${summary.maybe} maybe`);
  if (summary.no) parts.push(`${summary.no} can't`);
  return parts.join(" · ");
}

/**
 * Going / Maybe / Can't make it, as a radio group. The viewer's choice is filled
 * Forest; counts sit beside each label. Disabled once the deadline has passed.
 */
export function RsvpChips({
  summary,
  onChange,
  disabled,
  busy,
  size = "md",
  label = "Your RSVP",
}: {
  summary: RsvpSummary;
  onChange: (status: RsvpStatus) => void;
  disabled?: boolean;
  busy?: boolean;
  size?: "sm" | "md";
  label?: string;
}) {
  const closed = summary.deadlinePassed;
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {rsvpChipStates(summary).map((c) => (
        <button
          key={c.status}
          type="button"
          role="radio"
          aria-checked={c.selected}
          disabled={disabled || closed || busy}
          onClick={() => !c.selected && onChange(c.status)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-control border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
            c.selected ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink hover:bg-surface-2",
          )}
        >
          {c.selected && <Check className="size-3.5" aria-hidden />}
          {c.label}
          <span className={cx("tabular-nums", c.selected ? "text-on-primary/80" : "text-ink-muted")} aria-label={`${c.count} ${c.label.toLowerCase()}`}>
            {c.count}
          </span>
        </button>
      ))}
      {closed && <span className="text-xs text-ink-muted">RSVPs closed</span>}
    </div>
  );
}
