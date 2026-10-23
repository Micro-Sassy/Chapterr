import { AlertCircle, MessageSquare, Pencil, RotateCw, Sparkles, Trash2, X } from "lucide-react";
import { memo, type ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { MemberLink } from "@/components/content";
import { cx, IconButton } from "@/components/ui";
import { renderMentions } from "@/lib/mentions";
import { formatTime } from "@/lib/format";
import { AttachmentGrid, toGridImages } from "./AttachmentGrid";
import { ReactionBar } from "./ReactionBar";
import type { ChatMessage } from "./types";

export interface MessageItemProps {
  message: ChatMessage;
  own: boolean;
  clubId: string;
  /** Usernames of club members; mentions of anyone else stay plain text. */
  knownUsernames?: ReadonlySet<string>;
  /** Continues a run of messages from the same sender: hides the avatar and name. */
  grouped?: boolean;
  /** Hide the reply link (inside a thread panel, or when the conversation is read-only). */
  showThreadLink?: boolean;
  canReact?: boolean;
  onEdit?: (m: ChatMessage) => void;
  onDelete?: (m: ChatMessage) => void;
  onToggleReaction?: (m: ChatMessage, emoji: string) => void;
  onOpenThread?: (m: ChatMessage, trigger: HTMLElement) => void;
  onRetry?: (clientId: string) => void;
  onDiscard?: (clientId: string) => void;
}

const KIND_LABEL: Record<string, string> = { system: "Note", welcome: "Welcome", digest: "Catch-up" };

/** System, welcome and digest messages are quiet notes in the flow, not bubbles. */
function QuietNote({ message, clubId, knownUsernames }: { message: ChatMessage; clubId: string; knownUsernames?: ReadonlySet<string> }) {
  const kind = message.kind ?? "system";
  const body = message.deletedAt ? "Message removed" : (message.body ?? "");
  return (
    <div role="note" aria-label={KIND_LABEL[kind] ?? "Note"} className="mx-auto my-2 max-w-prose text-center">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        {kind !== "system" && <span className="label mr-2 inline-flex items-center gap-1 text-[11px] text-ink-muted">{kind === "digest" && <Sparkles className="size-3" aria-hidden />}{KIND_LABEL[kind]}</span>}
        <span className="whitespace-pre-wrap break-words">{renderMentions(body, clubId, knownUsernames)}</span>
      </p>
      <time dateTime={message.createdAt} className="text-[11px] text-ink-muted/80">
        {formatTime(message.createdAt)}
      </time>
    </div>
  );
}

export const MessageItem = memo(function MessageItem({
  message,
  own,
  clubId,
  knownUsernames,
  grouped,
  showThreadLink = true,
  canReact = true,
  onEdit,
  onDelete,
  onToggleReaction,
  onOpenThread,
  onRetry,
  onDiscard,
}: MessageItemProps) {
  if (message.kind && message.kind !== "user") return <QuietNote message={message} clubId={clubId} knownUsernames={knownUsernames} />;

  const removed = !!message.deletedAt;
  const pending = message.pending;
  const attachments = message.attachments ?? [];
  const images = message.localPreviews?.length ? message.localPreviews.map((url) => ({ url, title: null })) : toGridImages(attachments);
  const reactions = message.reactions ?? [];
  const replyCount = message.replyCount ?? 0;
  const hasBody = !!message.body && message.body.trim().length > 0;

  let bubble: ReactNode;
  if (removed) {
    bubble = <span className="italic">Message removed</span>;
  } else {
    bubble = (
      <>
        {images.length > 0 && <AttachmentGrid images={images} pending={pending === "sending"} className={hasBody ? "mb-2" : undefined} />}
        {hasBody && <p className="whitespace-pre-wrap break-words">{renderMentions(message.body ?? "", clubId, knownUsernames)}</p>}
      </>
    );
  }

  return (
    <article
      id={`message-${message.id}`}
      tabIndex={-1}
      aria-label={`${own ? "You" : message.sender.displayName}, ${formatTime(message.createdAt)}`}
      className={cx("group flex gap-2 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ink/20", own ? "flex-row-reverse" : "flex-row", grouped ? "mt-0.5" : "mt-3")}
    >
      {!own && <span className={cx("w-8 shrink-0", grouped && "invisible")}>{!grouped && <Avatar member={message.sender} />}</span>}
      <div className={cx("min-w-0 max-w-[85%] sm:max-w-[75%]", own && "text-right")}>
        {!own && !grouped && (
          <p className="mb-0.5 text-xs font-medium text-ink-muted">
            <MemberLink member={message.sender} />
          </p>
        )}
        <div
          className={cx(
            "inline-block rounded-control text-left text-[15px] leading-relaxed",
            removed ? "border border-dashed border-line px-3.5 py-2 text-ink-muted" : own ? "bg-primary text-on-primary" : "border border-line bg-surface",
            !removed && (hasBody || images.length === 0 ? "px-3.5 py-2" : "p-1"),
            pending === "sending" && "opacity-70",
            pending === "failed" && "border border-error",
          )}
        >
          {bubble}
        </div>
        <div className={cx("mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink-muted", own ? "justify-end" : "justify-start")}>
          {pending === "failed" ? (
            <span className="inline-flex items-center gap-1.5 text-error" role="alert">
              <AlertCircle className="size-3.5" aria-hidden /> Not sent.
              {onRetry && message.clientId && (
                <button type="button" onClick={() => onRetry(message.clientId!)} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                  <RotateCw className="size-3" aria-hidden /> Retry
                </button>
              )}
              {onDiscard && message.clientId && (
                <button type="button" onClick={() => onDiscard(message.clientId!)} className="inline-flex items-center gap-1 underline underline-offset-2">
                  <X className="size-3" aria-hidden /> Discard
                </button>
              )}
            </span>
          ) : pending === "sending" ? (
            <span>Sending</span>
          ) : (
            <>
              {own && !removed && (onEdit || onDelete) && (
                <span className="flex opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  {onEdit && hasBody && <IconButton icon={Pencil} label="Edit message" className="size-7" onClick={() => onEdit(message)} />}
                  {onDelete && <IconButton icon={Trash2} label="Remove message" className="size-7" onClick={() => onDelete(message)} />}
                </span>
              )}
              <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
              {message.editedAt && !removed && <span>· edited</span>}
              {showThreadLink && onOpenThread && !removed && (
                <button
                  type="button"
                  onClick={(e) => onOpenThread(message, e.currentTarget)}
                  className={cx("inline-flex items-center gap-1 rounded-chip px-1 font-medium hover:bg-surface-2 hover:text-ink", replyCount === 0 && "opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100")}
                  aria-label={replyCount === 0 ? "Reply in thread" : `Open thread, ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
                >
                  <MessageSquare className="size-3.5" aria-hidden />
                  {replyCount === 0 ? "Reply" : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
                </button>
              )}
            </>
          )}
        </div>
        {!removed && !pending && onToggleReaction && (
          <ReactionBar reactions={reactions} onToggle={(emoji) => onToggleReaction(message, emoji)} align={own ? "end" : "start"} canReact={canReact} />
        )}
      </div>
    </article>
  );
});
