import { Lock } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { LIMITS } from "@shared/constants";
import { Alert, Button, cx, EmptyState, Textarea } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { ScheduledList } from "./ScheduledList";
import { ThreadPanel } from "./ThreadPanel";
import { flattenPages, type ChatMessage } from "./types";
import { isRoomLocked, useCancelScheduled, useClubMembers, useEditMessage, useMarkRead, useMessages, useRemoveMessage, useScheduled, useScheduleMessage, useSendMessage, useToggleReaction } from "./useChat";

export interface ChatConversationProps {
  clubId: string;
  conversationId: string;
  /** The title row above the messages. */
  header?: ReactNode;
  /** Pinned content above the first message (a room's guide questions). */
  pinned?: ReactNode;
  /** Unread count when opened; drives the "Jump to first unread" pill. */
  initialUnread?: number;
  canSchedule?: boolean;
  canPost?: boolean;
  /** What to show when the server says the room gate has not been reached. */
  renderLocked?: (err: ApiRequestError) => ReactNode;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  className?: string;
  /** A message to scroll to once loaded (notification links carry `?message=`). */
  focusMessageId?: string | null;
}

/**
 * One conversation end to end: the list, reactions, threads, the composer with
 * mentions, photos and scheduling, and the scheduled list. Used by the Messages
 * page and by discussion rooms.
 */
export function ChatConversation({ clubId, conversationId, header, pinned, initialUnread = 0, canSchedule = true, canPost = true, renderLocked, emptyTitle, emptyBody, className, focusMessageId }: ChatConversationProps) {
  const toast = useToast();
  const { data: session } = useSession();
  const meId = session?.user.id;
  const members = useClubMembers(clubId);
  const knownUsernames = useMemo(() => new Set((members.data ?? []).map((m) => m.username.toLowerCase())), [members.data]);

  const page = useMessages(clubId, conversationId);
  const messages = flattenPages(page.data);
  const newestId = messages.at(-1)?.id;
  useMarkRead(clubId, conversationId, newestId);

  const send = useSendMessage(clubId, conversationId);
  const edit = useEditMessage(clubId);
  const remove = useRemoveMessage(clubId);
  const react = useToggleReaction(clubId);
  const scheduled = useScheduled(clubId);
  const schedule = useScheduleMessage(clubId);
  const cancelScheduled = useCancelScheduled(clubId);

  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const threadSnapshot = useRef<ChatMessage | null>(null);
  const threadTrigger = useRef<HTMLElement | null>(null);
  const threadParent = threadId ? (messages.find((m) => m.id === threadId) ?? threadSnapshot.current) : null;

  const openThread = (m: ChatMessage, trigger: HTMLElement) => {
    threadSnapshot.current = m;
    threadTrigger.current = trigger;
    setThreadId(m.id);
  };
  const closeThread = () => {
    setThreadId(null);
    threadTrigger.current?.focus();
  };

  const onToggleReaction = (m: ChatMessage, emoji: string) => react.mutate({ message: m, emoji }, { onError: (err) => toast(errorMessage(err), "error") });
  const onEdit = (m: ChatMessage) => {
    setEditing(m);
    setEditText(m.body ?? "");
  };
  const onDelete = (m: ChatMessage) => {
    if (confirm("Remove this message for everyone?")) remove.mutate(m.id, { onError: (err) => toast(errorMessage(err), "error") });
  };

  if (page.isError && isRoomLocked(page.error)) {
    return (
      <div className={cx("flex flex-col", className)}>
        {header}
        {renderLocked ? (
          renderLocked(page.error)
        ) : (
          <EmptyState icon={Lock} title="This room is not open to you yet">
            {page.error.message}
          </EmptyState>
        )}
      </div>
    );
  }

  const myScheduled = (scheduled.data ?? []).filter((s) => s.conversationId === conversationId);

  return (
    <div className={cx("flex min-h-0", className)}>
      <div className={cx("flex min-h-0 min-w-0 flex-1 flex-col", threadId && "hidden md:flex")}>
        {header}
        {page.isError && <Alert tone="error" className="mt-3">{errorMessage(page.error)}</Alert>}
        <MessageList
          messages={messages}
          meId={meId}
          clubId={clubId}
          knownUsernames={knownUsernames}
          loading={page.isPending}
          hasOlder={!!page.hasNextPage}
          loadingOlder={page.isFetchingNextPage}
          onLoadOlder={() => void page.fetchNextPage()}
          initialUnread={initialUnread}
          header={pinned}
          emptyTitle={emptyTitle}
          emptyBody={emptyBody}
          focusMessageId={focusMessageId}
          canReact={canPost}
          onEdit={canPost ? onEdit : undefined}
          onDelete={canPost ? onDelete : undefined}
          onToggleReaction={onToggleReaction}
          onOpenThread={openThread}
          onRetry={send.retry}
          onDiscard={send.discard}
        />
        <ScheduledList items={myScheduled} onCancel={(id) => cancelScheduled.mutate(id, { onError: (err) => toast(errorMessage(err), "error") })} canceling={cancelScheduled.isPending} />
        <Composer
          clubId={clubId}
          members={members.data ?? []}
          onSend={send.send}
          onSchedule={
            canSchedule && canPost
              ? async (body, sendAt) => {
                  await schedule.mutateAsync({ conversationId, body, sendAt });
                  toast("Scheduled.");
                }
              : undefined
          }
          disabled={!canPost}
          placeholder={canPost ? undefined : "You can read this conversation but not post in it"}
        />
      </div>
      {threadId && threadParent && (
        <ThreadPanel
          clubId={clubId}
          conversationId={conversationId}
          parent={threadParent}
          meId={meId}
          members={members.data ?? []}
          knownUsernames={knownUsernames}
          onClose={closeThread}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleReaction={onToggleReaction}
          canPost={canPost}
        />
      )}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit message">
        <div className="space-y-3">
          <Textarea aria-label="Edited message" rows={4} maxLength={LIMITS.messageMax} value={editText} onChange={(e) => setEditText(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={edit.isPending}
              disabled={!editText.trim()}
              onClick={() =>
                editing &&
                edit.mutate(
                  { messageId: editing.id, body: editText.trim() },
                  {
                    onSuccess: () => setEditing(null),
                    onError: (err) => toast(errorMessage(err), "error"),
                  },
                )
              }
            >
              Save
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
