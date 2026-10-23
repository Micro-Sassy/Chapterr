import { X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { MemberSummary } from "@shared/types";
import { Alert, Button, cx, Spinner } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { Composer } from "./Composer";
import { MessageItem } from "./MessageItem";
import { flattenThread, type ChatMessage, type ThreadPage } from "./types";
import { useSendMessage, useThread } from "./useChat";

export interface ThreadPanelProps {
  clubId: string;
  conversationId: string;
  parent: ChatMessage;
  meId: string | undefined;
  members: MemberSummary[];
  knownUsernames: ReadonlySet<string>;
  onClose: () => void;
  onEdit?: (m: ChatMessage) => void;
  onDelete?: (m: ChatMessage) => void;
  onToggleReaction?: (m: ChatMessage, emoji: string) => void;
  canPost?: boolean;
}

/**
 * Replies to one message: a side panel on wide screens, the whole screen on a
 * phone. Focus lands on the heading when it opens; Escape closes it.
 */
export function ThreadPanel({ clubId, conversationId, parent, meId, members, knownUsernames, onClose, onEdit, onDelete, onToggleReaction, canPost = true }: ThreadPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const thread = useThread(clubId, parent.id);
  const send = useSendMessage(clubId, conversationId, parent.id);
  const replies = flattenThread(thread.data);
  const newestId = replies.at(-1)?.id;
  // The server sends the parent with each page; prefer the freshest copy we have.
  const parentFromPage = (thread.data?.pages[0] as ThreadPage | undefined)?.parent;
  const shownParent: ChatMessage = parent.replyCount !== undefined ? parent : (parentFromPage ?? parent);

  useEffect(() => {
    heading.current?.focus();
  }, [parent.id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [newestId]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const count = shownParent.replyCount ?? replies.length;

  return (
    <aside
      role="dialog"
      aria-labelledby="thread-heading"
      onKeyDown={onKeyDown}
      className={cx("fixed inset-0 z-40 flex flex-col bg-ground", "md:static md:z-auto md:h-full md:w-[22rem] md:shrink-0 md:border-l md:border-line md:bg-transparent md:pl-4")}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 md:px-0">
        <h2 id="thread-heading" ref={heading} tabIndex={-1} className="heading-s outline-none">
          Thread <span className="text-sm font-normal text-ink-muted">{count === 0 ? "" : `· ${count} ${count === 1 ? "reply" : "replies"}`}</span>
        </h2>
        <button type="button" onClick={onClose} aria-label="Close thread" className="-m-1 rounded-control p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 md:px-0" role="log" aria-live="polite" aria-relevant="additions" aria-label="Replies">
        <MessageItem message={shownParent} own={shownParent.sender.id === meId} clubId={clubId} knownUsernames={knownUsernames} showThreadLink={false} onToggleReaction={onToggleReaction} canReact={canPost} />
        <div className="my-3 border-t border-line" role="separator" />
        {thread.isPending && <Spinner label="Loading replies" />}
        {thread.isError && <Alert tone="error">{errorMessage(thread.error)}</Alert>}
        {thread.isSuccess && replies.length === 0 && <p className="py-6 text-center text-sm text-ink-muted">No replies yet. Start the thread.</p>}
        {replies.map((r) => (
          <MessageItem
            key={r.clientId ?? r.id}
            message={r}
            own={r.sender.id === meId}
            clubId={clubId}
            knownUsernames={knownUsernames}
            showThreadLink={false}
            canReact={canPost}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleReaction={onToggleReaction}
            onRetry={send.retry}
            onDiscard={send.discard}
          />
        ))}
        {thread.hasNextPage && (
          <div className="text-center">
            <Button size="sm" variant="ghost" loading={thread.isFetchingNextPage} onClick={() => void thread.fetchNextPage()}>
              Load more replies
            </Button>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="px-4 pb-4 md:px-0 md:pb-0">
        <Composer clubId={clubId} members={members} onSend={send.send} disabled={!canPost} label="Reply" placeholder="Reply in thread" autoFocus={false} />
      </div>
    </aside>
  );
}
