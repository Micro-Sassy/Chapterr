import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageCirclePlus, Pencil, Send, Trash2, UsersRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { LIMITS } from "@shared/constants";
import type { Conversation, MemberSummary, Message } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { Alert, Button, cx, EmptyState, IconButton, Input, Spinner, Textarea } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { formatDate, formatTime, relativeTime } from "@/lib/format";
import { useDocumentTitle, useOnline } from "@/lib/hooks";
import { applyMessageEvent, useRealtimeStatus } from "@/lib/realtime";

interface MessagePage {
  messages: Message[];
  hasMore: boolean;
}

function NewConversation({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [filter, setFilter] = useState("");
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<MemberSummary[]>("/api/members") });
  const start = useMutation({
    mutationFn: (userId: string) => api<{ id: string }>("/api/conversations/direct", { body: { userId } }),
    onSuccess: ({ id }) => {
      onClose();
      navigate(`/messages/${id}`);
    },
  });
  const list = (members.data ?? []).filter(
    (m) => m.id !== session?.user.id && `${m.displayName} ${m.username}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="space-y-3">
      <Input type="search" aria-label="Find a member" placeholder="Find a member" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
      {members.isPending && <Spinner />}
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {list.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => start.mutate(m.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2">
              <Avatar member={m} />
              <span>
                <span className="block text-sm font-medium">{m.displayName}</span>
                <span className="block text-xs text-ink-muted">@{m.username}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {start.isError && <Alert tone="error">{errorMessage(start.error)}</Alert>}
    </div>
  );
}

function ConversationList({ activeId }: { activeId?: string }) {
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["conversations"], queryFn: () => api<Conversation[]>("/api/conversations") });
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-3xl">Messages</h1>
        <Button size="sm" icon={MessageCirclePlus} onClick={() => setCreating(true)}>
          New
        </Button>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      <ul className="space-y-1">
        {q.data?.map((c) => (
          <li key={c.id}>
            <Link
              to={`/messages/${c.id}`}
              aria-current={c.id === activeId ? "page" : undefined}
              className={cx("flex items-center gap-3 rounded-[var(--radius)] px-3 py-2.5", c.id === activeId ? "bg-accent-soft" : "hover:bg-surface-2")}
            >
              {c.kind === "club" ? (
                <span className="inline-flex size-10 items-center justify-center rounded-full bg-accent text-on-accent">
                  <UsersRound className="size-5" aria-hidden />
                </span>
              ) : (
                <Avatar member={c.otherMember} size="md" />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={cx("truncate text-sm", c.unreadCount ? "font-bold" : "font-medium")}>{c.title}</span>
                  {c.lastMessageAt && <span className="shrink-0 text-xs text-ink-muted">{relativeTime(c.lastMessageAt)}</span>}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-ink-muted">{c.lastMessagePreview ?? (c.lastMessageAt ? "Message removed" : "No messages yet")}</span>
                  {c.unreadCount > 0 && (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-highlight px-1.5 text-[11px] font-bold text-white">
                      {c.unreadCount}
                      <span className="sr-only"> unread</span>
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New conversation">
        <NewConversation onClose={() => setCreating(false)} />
      </Dialog>
    </div>
  );
}

function MessageBubble({ message, own, onEdit, onDelete }: { message: Message; own: boolean; onEdit: () => void; onDelete: () => void }) {
  const removed = !!message.deletedAt;
  return (
    <div className={cx("group flex gap-2", own ? "flex-row-reverse" : "flex-row")}>
      {!own && <Avatar member={message.sender} />}
      <div className={cx("max-w-[80%]", own && "text-right")}>
        {!own && <p className="mb-0.5 text-xs font-medium text-ink-muted">{message.sender.displayName}</p>}
        <div
          className={cx(
            "inline-block rounded-[var(--radius)] px-3.5 py-2 text-left text-sm",
            removed ? "border border-dashed border-line italic text-ink-muted" : own ? "bg-accent text-on-accent" : "bg-surface border border-line",
          )}
        >
          {removed ? "Message removed" : <p className="whitespace-pre-wrap break-words">{message.body}</p>}
        </div>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-muted" style={{ justifyContent: own ? "flex-end" : "flex-start" }}>
          {own && !removed && (
            <span className="flex opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              <IconButton icon={Pencil} label="Edit message" className="size-7" onClick={onEdit} />
              <IconButton icon={Trash2} label="Remove message" className="size-7" onClick={onDelete} />
            </span>
          )}
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          {message.editedAt && !removed && <span>· edited</span>}
        </p>
      </div>
    </div>
  );
}

function ConversationView({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const realtime = useRealtimeStatus();
  const { data: session } = useSession();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Message | null>(null);
  const [editText, setEditText] = useState("");
  const [older, setOlder] = useState<Message[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const meta = useQuery({ queryKey: ["conversation", id], queryFn: () => api<Conversation>(`/api/conversations/${id}`) });
  const page = useQuery({
    queryKey: ["messages", id],
    queryFn: () => api<MessagePage>(`/api/conversations/${id}/messages?limit=50`),
    // Realtime keeps this fresh; poll slowly as a fallback when the socket is down.
    refetchInterval: realtime === "open" ? false : 20_000,
  });
  useDocumentTitle(meta.data?.title ?? "Messages");

  useEffect(() => {
    setOlder([]);
    setHasMoreOlder(null);
  }, [id]);

  const messages = [...older, ...(page.data?.messages ?? [])];
  const lastId = page.data?.messages.at(-1)?.id;

  useEffect(() => {
    if (!lastId) return;
    void api(`/api/conversations/${id}/read`, { body: {} }).then(() => qc.invalidateQueries({ queryKey: ["conversations"] }));
  }, [id, lastId, qc]);

  useLayoutEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  const send = useMutation({
    mutationFn: (body: string) => api<Message>(`/api/conversations/${id}/messages`, { body: { body } }),
    onSuccess: (msg) => {
      applyMessageEvent(qc, msg);
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const edit = useMutation({
    mutationFn: ({ messageId, body }: { messageId: string; body: string }) => api<Message>(`/api/messages/${messageId}`, { method: "PATCH", body: { body } }),
    onSuccess: (msg) => {
      applyMessageEvent(qc, msg);
      setOlder((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      setEditing(null);
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const remove = useMutation({
    mutationFn: (messageId: string) => api<Message>(`/api/messages/${messageId}`, { method: "DELETE" }),
    onSuccess: (msg) => {
      applyMessageEvent(qc, msg);
      setOlder((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const loadOlder = useMutation({
    mutationFn: () => api<MessagePage>(`/api/conversations/${id}/messages?limit=50&before=${encodeURIComponent(messages[0]!.createdAt)}`),
    onSuccess: (res) => {
      setOlder((prev) => [...res.messages, ...prev]);
      setHasMoreOlder(res.hasMore);
    },
  });

  const submit = () => {
    const body = draft.trim();
    if (body && !send.isPending) send.mutate(body);
  };

  if (meta.isError) return <Alert tone="error">{errorMessage(meta.error)}</Alert>;
  const canLoadOlder = hasMoreOlder ?? page.data?.hasMore ?? false;
  let lastDay = "";

  return (
    <div className="flex h-[calc(100dvh-10rem)] flex-col md:h-[calc(100dvh-7rem)]">
      <div className="flex items-center gap-3 border-b border-line pb-3">
        <Link to="/messages" className="md:hidden" aria-label="Back to conversations">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        {meta.data?.kind === "direct" ? <Avatar member={meta.data.otherMember} /> : <UsersRound className="size-5 text-accent" aria-hidden />}
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{meta.data?.title ?? "…"}</h2>
          <p className="text-xs text-ink-muted">
            {meta.data?.kind === "club" ? "Everyone in the club" : "Private conversation"} · {realtime === "open" ? "Live" : "Reconnecting…"}
          </p>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto py-4" aria-live="polite" aria-relevant="additions">
        {canLoadOlder && (
          <div className="text-center">
            <Button size="sm" variant="ghost" loading={loadOlder.isPending} onClick={() => loadOlder.mutate()}>
              Load earlier messages
            </Button>
          </div>
        )}
        {page.isPending && <Spinner />}
        {page.isSuccess && messages.length === 0 && <EmptyState title="No messages yet">Say hello!</EmptyState>}
        {messages.map((m) => {
          const day = formatDate(m.createdAt, { dateStyle: "full" });
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {showDay && <p className="my-2 text-center text-xs text-ink-muted">{day}</p>}
              <MessageBubble
                message={m}
                own={m.sender.id === session?.user.id}
                onEdit={() => {
                  setEditing(m);
                  setEditText(m.body ?? "");
                }}
                onDelete={() => confirm("Remove this message for everyone?") && remove.mutate(m.id)}
              />
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          aria-label="Message"
          rows={1}
          maxLength={LIMITS.messageMax}
          placeholder={online ? "Write a message" : "You are offline"}
          disabled={!online}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 min-h-10 resize-none"
        />
        <Button type="submit" icon={Send} loading={send.isPending} disabled={!draft.trim() || !online} aria-label="Send message">
          <span className="hidden sm:inline">Send</span>
        </Button>
      </form>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit message">
        <div className="space-y-3">
          <Textarea aria-label="Edited message" rows={4} maxLength={LIMITS.messageMax} value={editText} onChange={(e) => setEditText(e.target.value)} />
          <Button loading={edit.isPending} disabled={!editText.trim()} onClick={() => editing && edit.mutate({ messageId: editing.id, body: editText.trim() })}>
            Save
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function MessagesPage() {
  const { id } = useParams();
  useDocumentTitle("Messages");
  return (
    <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
      <div className={id ? "hidden md:block" : undefined}>
        <ConversationList activeId={id} />
      </div>
      <div className={id ? undefined : "hidden md:block"}>
        {id ? (
          <ConversationView key={id} id={id} />
        ) : (
          <EmptyState icon={UsersRound} title="Choose a conversation">
            Chat with the whole club or start a private conversation with one member. Messages are only visible to signed-in members and can never be
            shared publicly.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
