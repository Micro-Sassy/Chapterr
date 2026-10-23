import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, DoorOpen, Lock, MessageCirclePlus, UsersRound } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ClubMember } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { ChatConversation } from "@/components/chat/ChatConversation";
import { gateLabel } from "@/components/chat/gate";
import { isRoomConversation, type ChatConversation as ChatConversationRow } from "@/components/chat/types";
import { clubApi } from "@/components/records";
import { Alert, Button, cx, EmptyState, Input, Spinner } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { clubPath, useClub } from "@/lib/club";
import { relativeTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { useRealtimeStatus } from "@/lib/realtime";

function NewConversation({ clubId, onClose }: { clubId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [filter, setFilter] = useState("");
  const members = useQuery({ queryKey: ["club-members", clubId], queryFn: () => api<ClubMember[]>(clubApi(clubId, "/members")) });
  const start = useMutation({
    mutationFn: (userId: string) => api<{ id: string }>(clubApi(clubId, "/conversations/direct"), { body: { userId } }),
    onSuccess: ({ id }) => {
      onClose();
      navigate(clubPath(clubId, `messages/${id}`));
    },
  });
  const list = (members.data ?? []).filter((m) => m.id !== session?.user.id && `${m.displayName} ${m.username}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-3">
      <Input type="search" aria-label="Find a member" placeholder="Find a member" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
      {members.isPending && <Spinner />}
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {list.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => start.mutate(m.id)} className="flex w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-surface-2">
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

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-chip bg-primary px-1.5 text-[11px] font-semibold text-on-primary">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

function ConversationRow({ clubId, c, active }: { clubId: string; c: ChatConversationRow; active: boolean }) {
  const room = isRoomConversation(c);
  const locked = room && c.room ? !c.room.unlocked : false;
  return (
    <li>
      <Link
        to={clubPath(clubId, `messages/${c.id}`)}
        aria-current={active ? "page" : undefined}
        aria-label={locked ? `${c.title}, locked` : undefined}
        className={cx("flex items-center gap-3 rounded-control px-3 py-2.5", active ? "bg-surface-2" : "hover:bg-surface-2", locked && "opacity-70")}
      >
        {c.kind === "club" ? (
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
            <UsersRound className="size-5" aria-hidden strokeWidth={1.75} />
          </span>
        ) : room ? (
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted">
            {locked ? <Lock className="size-4" aria-hidden strokeWidth={1.75} /> : <DoorOpen className="size-5" aria-hidden strokeWidth={1.75} />}
          </span>
        ) : (
          <Avatar member={c.otherMember} size="md" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className={cx("truncate text-sm", c.unreadCount ? "font-semibold" : "font-medium")}>{c.title}</span>
            {c.lastMessageAt && <span className="shrink-0 text-xs text-ink-muted">{relativeTime(c.lastMessageAt)}</span>}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-ink-muted">
              {locked && c.room ? gateLabel(c.room) : (c.lastMessagePreview ?? (c.lastMessageAt ? "Message removed" : "No messages yet"))}
            </span>
            {!locked && <UnreadBadge count={c.unreadCount} />}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <div className="mb-1 flex items-center justify-between px-3">
        <h2 className="label text-ink-muted">{title}</h2>
        {action}
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

function ConversationList({ clubId, activeId }: { clubId: string; activeId?: string }) {
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["conversations", clubId], queryFn: () => api<ChatConversationRow[]>(clubApi(clubId, "/conversations")) });

  const groups = useMemo(() => {
    const all = q.data ?? [];
    const club = all.filter((c) => c.kind === "club");
    const direct = all.filter((c) => c.kind === "direct");
    const rooms = all.filter((c) => (c.kind !== "club" && c.kind !== "direct") || isRoomConversation(c));
    const byBook = new Map<string, { title: string; editionId: string | null; items: ChatConversationRow[] }>();
    for (const c of rooms) {
      const key = c.room?.edition.id ?? "other";
      const g = byBook.get(key) ?? { title: c.room?.edition.title ?? "Discussion rooms", editionId: c.room?.edition.id ?? null, items: [] };
      g.items.push(c);
      byBook.set(key, g);
    }
    return { club, direct, books: [...byBook.values()] };
  }, [q.data]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="display-l">Messages</h1>
        <Button size="sm" variant="secondary" icon={MessageCirclePlus} onClick={() => setCreating(true)}>
          New
        </Button>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.isSuccess && (
        <>
          {groups.club.length > 0 && (
            <Group title="Club">
              {groups.club.map((c) => (
                <ConversationRow key={c.id} clubId={clubId} c={c} active={c.id === activeId} />
              ))}
            </Group>
          )}
          {groups.books.map((b) => (
            <Group
              key={b.editionId ?? "other"}
              title={b.title}
              action={
                b.editionId ? (
                  <Link to={clubPath(clubId, `rooms/${b.editionId}`)} className="text-xs font-medium text-ink-muted hover:text-ink hover:underline">
                    All rooms
                  </Link>
                ) : undefined
              }
            >
              {b.items.map((c) => (
                <ConversationRow key={c.id} clubId={clubId} c={c} active={c.id === activeId} />
              ))}
            </Group>
          ))}
          {groups.direct.length > 0 && (
            <Group title="Direct">
              {groups.direct.map((c) => (
                <ConversationRow key={c.id} clubId={clubId} c={c} active={c.id === activeId} />
              ))}
            </Group>
          )}
        </>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New conversation">
        <NewConversation clubId={clubId} onClose={() => setCreating(false)} />
      </Dialog>
    </div>
  );
}

function ConversationView({ clubId, id }: { clubId: string; id: string }) {
  const realtime = useRealtimeStatus();
  const meta = useQuery({ queryKey: ["conversation", clubId, id], queryFn: () => api<ChatConversationRow>(clubApi(clubId, `/conversations/${id}`)) });
  const list = useQuery({ queryKey: ["conversations", clubId], queryFn: () => api<ChatConversationRow[]>(clubApi(clubId, "/conversations")) });
  // The unread count as it was when this conversation was opened (the server resets it as we read).
  const initialUnread = useRef<number | null>(null);
  if (initialUnread.current === null && list.data) initialUnread.current = list.data.find((c) => c.id === id)?.unreadCount ?? 0;
  useDocumentTitle(meta.data?.title ?? "Messages");

  if (meta.isError) return <Alert tone="error">{errorMessage(meta.error)}</Alert>;
  const conv = meta.data;
  const room = conv ? isRoomConversation(conv) : false;
  const subtitle = conv?.kind === "club" ? "Everyone in the club" : room ? (conv?.room ? `${conv.room.edition.title} · ${gateLabel(conv.room)}` : "Discussion room") : "Private conversation";

  const header = (
    <div className="flex items-center gap-3 border-b border-line pb-3">
      <Link to={clubPath(clubId, "messages")} className="rounded-control p-1 md:hidden" aria-label="Back to conversations">
        <ArrowLeft className="size-5" aria-hidden />
      </Link>
      {conv?.kind === "direct" ? (
        <Avatar member={conv.otherMember} />
      ) : room ? (
        <DoorOpen className="size-5 text-ink-muted" aria-hidden strokeWidth={1.75} />
      ) : (
        <UsersRound className="size-5 text-ink-muted" aria-hidden strokeWidth={1.75} />
      )}
      <div className="min-w-0 flex-1">
        <h2 className="heading-s truncate">{conv?.title ?? "…"}</h2>
        <p className="truncate text-xs text-ink-muted">
          {subtitle} · {realtime === "open" ? "Live" : "Reconnecting"}
        </p>
      </div>
      {room && conv?.room && (
        <Link to={clubPath(clubId, `rooms/${conv.room.edition.id}`)} className="hidden text-xs font-medium text-ink-muted hover:text-ink hover:underline sm:inline">
          All rooms
        </Link>
      )}
    </div>
  );

  return (
    <ChatConversation
      key={id}
      clubId={clubId}
      conversationId={id}
      header={header}
      initialUnread={initialUnread.current ?? 0}
      className="h-[calc(100dvh-10rem)] md:h-[calc(100dvh-8rem)]"
      emptyBody={conv?.kind === "direct" ? "Say hello." : room ? "Nobody has spoken here yet. You are first." : "Say hello to the club."}
    />
  );
}

export function ClubMessagesPage() {
  const club = useClub();
  const { conversationId } = useParams();
  useDocumentTitle(`Messages · ${club.name}`);
  return (
    <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
      <div className={conversationId ? "hidden md:block" : undefined}>
        <ConversationList clubId={club.id} activeId={conversationId} />
      </div>
      <div className={conversationId ? undefined : "hidden md:block"}>
        {conversationId ? (
          <ConversationView key={conversationId} clubId={club.id} id={conversationId} />
        ) : (
          <EmptyState icon={UsersRound} title="Choose a conversation">
            Talk with the whole club, open a discussion room, or start a private conversation with one member. Messages stay inside the club and can never be shared publicly.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
