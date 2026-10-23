import { Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MESSAGE_EMOJI, type MessageEmoji } from "@shared/constants";
import { cx } from "@/components/ui";

/** Plain names so screen readers announce a choice, not a code point. */
export const EMOJI_NAMES: Record<MessageEmoji, string> = {
  "👍": "Thumbs up",
  "❤️": "Heart",
  "😂": "Laughing",
  "😮": "Surprised",
  "😢": "Sad",
  "👏": "Applause",
  "📚": "Books",
  "🔥": "Fire",
  "🤔": "Thinking",
  "✅": "Done",
  "🎉": "Celebration",
  "👀": "Eyes",
  "☕": "Coffee",
  "🍷": "Wine",
  "🥐": "Croissant",
  "💬": "Speech bubble",
};

export const emojiName = (emoji: string) => EMOJI_NAMES[emoji as MessageEmoji] ?? emoji;

const COLS = 8;

/**
 * The curated reaction picker: a small popover with a keyboard-navigable grid
 * (arrows move, Enter or Space picks, Escape closes and returns focus).
 */
export function EmojiPicker({ onPick, selected = [], align = "start", className }: { onPick: (emoji: MessageEmoji) => void; selected?: string[]; align?: "start" | "end"; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    grid.current?.querySelector<HTMLElement>("button")?.focus();
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(grid.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => {
      e.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, n))]?.focus();
    };
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "ArrowRight":
        go(i + 1);
        break;
      case "ArrowLeft":
        go(i - 1);
        break;
      case "ArrowDown":
        go(i + COLS);
        break;
      case "ArrowUp":
        go(i - COLS);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(buttons.length - 1);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={root} className={cx("relative inline-flex", className)}>
      <button
        ref={trigger}
        type="button"
        aria-label="Add reaction"
        title="Add reaction"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-7 min-w-7 items-center justify-center rounded-chip border border-dashed border-line px-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
      >
        <Plus className="size-3.5" aria-hidden />
      </button>
      {open && (
        <div
          ref={grid}
          id={id}
          role="dialog"
          aria-label="Choose a reaction"
          onKeyDown={onKeyDown}
          className={cx("absolute bottom-full z-40 mb-1.5 grid w-max grid-cols-8 gap-0.5 rounded-card border border-line bg-surface p-1.5 shadow-float", align === "end" ? "right-0" : "left-0")}
        >
          {MESSAGE_EMOJI.map((emoji) => {
            const mine = selected.includes(emoji);
            return (
              <button
                key={emoji}
                type="button"
                aria-label={emojiName(emoji)}
                aria-pressed={mine}
                title={emojiName(emoji)}
                onClick={() => {
                  onPick(emoji);
                  close();
                }}
                className={cx("flex size-9 items-center justify-center rounded-control text-lg leading-none hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]", mine && "bg-accent-soft")}
              >
                <span aria-hidden>{emoji}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
