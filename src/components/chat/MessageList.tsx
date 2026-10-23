import { ArrowDown, ArrowUp } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, cx, EmptyState, Spinner } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { MessageItem, type MessageItemProps } from "./MessageItem";
import type { ChatMessage } from "./types";

const GROUP_WINDOW_MS = 5 * 60_000;
const NEAR_BOTTOM_PX = 120;
/** From this many unread on, offer a jump instead of making the reader scroll. */
export const JUMP_THRESHOLD = 10;

export interface MessageListProps extends Omit<MessageItemProps, "message" | "own" | "grouped"> {
  messages: ChatMessage[];
  meId: string | undefined;
  loading?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  /** Unread count when the conversation was opened; drives the "Jump to first unread" pill. */
  initialUnread?: number;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  /** Pinned content shown above the first message (room guide questions). */
  header?: ReactNode;
  className?: string;
  /** Replies live in threads; the main list hides them unless asked. */
  includeReplies?: boolean;
  /** A message to scroll to and highlight once loaded (from a notification link). */
  focusMessageId?: string | null;
}

/**
 * The scrolling list: day separators, consecutive messages from one sender
 * grouped, anchored to the bottom unless the reader has scrolled up (then a
 * "New messages" pill appears), and a jump to the first unread on open.
 */
export function MessageList({
  messages,
  meId,
  loading,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  initialUnread = 0,
  emptyTitle = "No messages yet",
  emptyBody = "Say hello.",
  header,
  className,
  includeReplies = false,
  focusMessageId,
  ...itemProps
}: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [newBelow, setNewBelow] = useState(0);
  const [showJump, setShowJump] = useState(initialUnread >= JUMP_THRESHOLD);
  const nearBottom = useRef(true);
  const pendingOlder = useRef<{ height: number; top: number } | null>(null);
  const lastNewest = useRef<string | undefined>(undefined);
  const initialised = useRef(false);
  const focused = useRef(false);

  const visible = includeReplies ? messages : messages.filter((m) => !m.parentId);
  const newest = visible.at(-1);
  const firstUnreadId = initialUnread > 0 ? visible[Math.max(0, visible.length - initialUnread)]?.id : undefined;

  const scrollToBottom = useCallback((smooth = false) => {
    bottom.current?.scrollIntoView({ block: "end", behavior: smooth ? "smooth" : "auto" });
    setNewBelow(0);
  }, []);

  // Keep the viewport steady when older pages are prepended.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pendingOlder.current) {
      el.scrollTop = pendingOlder.current.top + (el.scrollHeight - pendingOlder.current.height);
      pendingOlder.current = null;
      return;
    }
    if (!newest) return;
    if (!initialised.current) {
      initialised.current = true;
      lastNewest.current = newest.id;
      scrollToBottom();
      return;
    }
    if (newest.id === lastNewest.current) return;
    lastNewest.current = newest.id;
    const own = newest.sender.id === meId;
    if (own || nearBottom.current) scrollToBottom(true);
    else setNewBelow((n) => n + 1);
  }, [newest, meId, scrollToBottom]);

  // A linked message (from a notification) is brought into view once it is loaded.
  useEffect(() => {
    if (!focusMessageId || focused.current) return;
    const target = document.getElementById(`message-${focusMessageId}`);
    if (!target) return;
    focused.current = true;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
    target.classList.add("ring-2", "ring-accent");
    const t = setTimeout(() => target.classList.remove("ring-2", "ring-accent"), 2500);
    return () => clearTimeout(t);
  }, [focusMessageId, visible.length]);

  // Track whether the reader is at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      nearBottom.current = distance < NEAR_BOTTOM_PX;
      if (nearBottom.current) setNewBelow(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const loadOlder = () => {
    const el = scroller.current;
    if (el) pendingOlder.current = { height: el.scrollHeight, top: el.scrollTop };
    onLoadOlder?.();
  };

  const jumpToUnread = () => {
    setShowJump(false);
    const target = firstUnreadId ? document.getElementById(`message-${firstUnreadId}`) : null;
    if (target) {
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
    }
  };

  // Day separators and sender grouping are decided in one pass before render.
  const rows: { m: ChatMessage; day: string | null; grouped: boolean; unreadMarker: boolean }[] = [];
  let lastDay = "";
  let prev: ChatMessage | undefined;
  for (const m of visible) {
    const day = formatDate(m.createdAt, { dateStyle: "full" });
    const showDay = day !== lastDay;
    lastDay = day;
    const grouped =
      !showDay &&
      !!prev &&
      prev.sender.id === m.sender.id &&
      (prev.kind ?? "user") === "user" &&
      (m.kind ?? "user") === "user" &&
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
    const unreadMarker = m.id === firstUnreadId && initialUnread > 0;
    rows.push({ m, day: showDay ? day : null, grouped: grouped && !unreadMarker, unreadMarker });
    prev = m;
  }

  return (
    <div className={cx("relative min-h-0 flex-1", className)}>
      <div ref={scroller} className="h-full overflow-y-auto px-1 py-3" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages">
        {header}
        {hasOlder && (
          <div className="text-center">
            <Button size="sm" variant="ghost" loading={loadingOlder} onClick={loadOlder}>
              Load earlier
            </Button>
          </div>
        )}
        {loading && <Spinner />}
        {!loading && visible.length === 0 && <EmptyState title={emptyTitle}>{emptyBody}</EmptyState>}
        {rows.map(({ m, day, grouped, unreadMarker }) => {
          return (
            <div key={m.clientId ?? m.id}>
              {day && (
                <p className="my-3 flex items-center gap-3 text-center text-xs text-ink-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line" role="separator" aria-label={day}>
                  {day}
                </p>
              )}
              {unreadMarker && (
                <p className="my-2 flex items-center gap-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-accent before:h-px before:flex-1 before:bg-accent/50 after:h-px after:flex-1 after:bg-accent/50" role="separator">
                  New
                </p>
              )}
              <MessageItem message={m} own={m.sender.id === meId} grouped={grouped} {...itemProps} />
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {showJump && firstUnreadId && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <button type="button" onClick={jumpToUnread} className="pointer-events-auto inline-flex items-center gap-1.5 rounded-chip border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink shadow-float hover:bg-surface-2">
            <ArrowUp className="size-3.5" aria-hidden /> Jump to first unread ({initialUnread})
          </button>
        </div>
      )}
      {newBelow > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <button type="button" onClick={() => scrollToBottom(true)} className="pointer-events-auto inline-flex items-center gap-1.5 rounded-chip bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary shadow-float">
            <ArrowDown className="size-3.5" aria-hidden /> {newBelow === 1 ? "1 new message" : `${newBelow} new messages`}
          </button>
        </div>
      )}
    </div>
  );
}
