import type { ReactionSummary } from "@shared/types";
import { cx } from "@/components/ui";
import { EmojiPicker, emojiName } from "./EmojiPicker";

/**
 * Reactions under a message: one chip per emoji with its count, the reader's own
 * reactions highlighted, and a "+" that opens the curated picker.
 */
export function ReactionBar({ reactions, onToggle, align = "start", disabled, canReact = true }: { reactions: ReactionSummary[]; onToggle: (emoji: string) => void; align?: "start" | "end"; disabled?: boolean; canReact?: boolean }) {
  if (!canReact && reactions.length === 0) return null;
  return (
    <div className={cx("mt-1 flex flex-wrap items-center gap-1", align === "end" && "justify-end")} role="group" aria-label="Reactions">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          aria-pressed={r.mine}
          aria-label={`${emojiName(r.emoji)}, ${r.count}${r.mine ? ", you reacted" : ""}`}
          title={emojiName(r.emoji)}
          disabled={disabled || !canReact}
          onClick={() => onToggle(r.emoji)}
          className={cx(
            "inline-flex h-7 items-center gap-1 rounded-chip border px-2 text-xs font-semibold tabular-nums",
            r.mine ? "border-accent bg-accent-soft text-ink" : "border-line bg-surface text-ink-muted hover:bg-surface-2",
          )}
        >
          <span aria-hidden>{r.emoji}</span>
          <span aria-hidden>{r.count}</span>
        </button>
      ))}
      {canReact && !disabled && <EmojiPicker onPick={onToggle} selected={reactions.filter((r) => r.mine).map((r) => r.emoji)} align={align} />}
    </div>
  );
}
