import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { Message, Page, ReactionSummary, RealtimeEvent, RealtimeEventWave2 } from "@shared/types";
import { messagesKey, threadKey, type ChatMessage, type MessagePages } from "@/components/chat/types";
import { useToast } from "@/components/ui/Toast";

type Status = "connecting" | "open" | "closed";
const RealtimeContext = createContext<Status>("closed");

export function useRealtimeStatus(): Status {
  return useContext(RealtimeContext);
}

/** Feature wave 2 events (docs/FEATURES-2.md §3), unioned with the original set on the client. */
export type Wave2Event = RealtimeEventWave2;

type AnyEvent = RealtimeEvent | Wave2Event;

/**
 * Chat lists are infinite queries. A conversation's pages are newest-first (new
 * messages join the first page); a thread's pages are oldest-first (new replies
 * join the last page). Items are chronological within a page either way.
 */
function upsertIntoPages(prev: MessagePages | undefined, message: ChatMessage, appendIfMissing: boolean, appendTo: "first" | "last" = "first"): MessagePages | undefined {
  if (!prev) return prev;
  for (let p = 0; p < prev.pages.length; p++) {
    const page = prev.pages[p];
    if (!page) continue;
    const idx = page.items.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      const pages = prev.pages.slice();
      const items = page.items.slice();
      // Keep local-only state (a pending flag) out of the merged record.
      items[idx] = { ...items[idx], ...message, pending: undefined, clientId: undefined, localPreviews: undefined };
      pages[p] = { ...page, items };
      return { ...prev, pages };
    }
  }
  if (!appendIfMissing) return prev;
  const at = appendTo === "first" ? 0 : prev.pages.length - 1;
  const target = prev.pages[at];
  if (!target) return { pages: [{ items: [message], nextCursor: null }], pageParams: [null] };
  const pages = prev.pages.slice();
  pages[at] = { ...target, items: [...target.items, message] };
  return { ...prev, pages };
}

function patchEverywhere(qc: QueryClient, messageId: string, patch: (m: ChatMessage) => ChatMessage) {
  const apply = (prev: MessagePages | undefined) => {
    if (!prev) return prev;
    let changed = false;
    const pages = prev.pages.map((page) => {
      const idx = page.items.findIndex((m) => m.id === messageId);
      const found = page.items[idx];
      if (idx < 0 || !found) return page;
      changed = true;
      const items = page.items.slice();
      items[idx] = patch(found);
      return { ...page, items };
    });
    return changed ? { ...prev, pages } : prev;
  };
  qc.setQueriesData<MessagePages>({ queryKey: ["messages"] }, apply);
  qc.setQueriesData<MessagePages>({ queryKey: ["thread"] }, apply);
}

/**
 * Merge a created/updated message into the cached list it belongs to, if that
 * list is loaded: the conversation's live pages, or, for a reply, its thread.
 */
export function applyMessageEvent(qc: QueryClient, message: ChatMessage) {
  if (message.parentId) {
    qc.setQueryData<MessagePages>(threadKey(message.parentId), (prev) => upsertIntoPages(prev, message, true, "last"));
    // An edited or removed reply may also be cached in the conversation list.
    qc.setQueryData<MessagePages>(messagesKey(message.conversationId), (prev) => upsertIntoPages(prev, message, false));
    return;
  }
  qc.setQueryData<MessagePages>(messagesKey(message.conversationId), (prev) => upsertIntoPages(prev, message, true));
}

/** Replace the reaction summary of one message wherever it is cached. */
export function applyReactionEvent(qc: QueryClient, messageId: string, reactions: ReactionSummary[]) {
  patchEverywhere(qc, messageId, (m) => ({ ...m, reactions }));
}

/** Bump the parent's reply count and, when the thread is open, append the reply. */
export function applyThreadReplyEvent(qc: QueryClient, event: { parentId: string; replyCount: number; message: Message }) {
  patchEverywhere(qc, event.parentId, (m) => ({ ...m, replyCount: event.replyCount }));
  const reply: ChatMessage = { ...event.message, parentId: event.parentId };
  qc.setQueryData<MessagePages>(threadKey(event.parentId), (prev) => upsertIntoPages(prev, reply, true, "last"));
}

/** Drop an optimistic entry (by its client id) once the server copy has taken its place. */
export function removeOptimistic(qc: QueryClient, listKey: readonly unknown[], clientId: string) {
  qc.setQueryData<MessagePages>(listKey, (prev) => {
    if (!prev) return prev;
    return { ...prev, pages: prev.pages.map((p) => ({ ...p, items: p.items.filter((m) => m.clientId !== clientId || !m.pending) })) };
  });
}

/** Add or replace an optimistic entry at the end of the live page (first page of a conversation, last page of a thread). */
export function putOptimistic(qc: QueryClient, listKey: readonly unknown[], message: ChatMessage, appendTo: "first" | "last" = "first") {
  qc.setQueryData<MessagePages>(listKey, (prev) => {
    const base: MessagePages = prev ?? { pages: [{ items: [], nextCursor: null } as Page<ChatMessage>], pageParams: [null] };
    const pages = base.pages.slice();
    const at = appendTo === "first" ? 0 : Math.max(0, pages.length - 1);
    const live = pages[at] ?? { items: [], nextCursor: null };
    const idx = live.items.findIndex((m) => m.clientId === message.clientId);
    const items = live.items.slice();
    if (idx >= 0) items[idx] = message;
    else items.push(message);
    pages[at] = { ...live, items };
    return { ...base, pages };
  });
}

/**
 * Keeps one authenticated WebSocket to the realtime Durable Object of the club
 * in the URL, reconnecting when the club changes, and folds incoming events into
 * the TanStack Query cache. No socket is held outside club routes. D1 remains the
 * source of truth: after any reconnect, conversations are refetched.
 */
export function RealtimeProvider({ clubId, children }: { clubId: string | null; children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [status, setStatus] = useState<Status>("closed");
  const retry = useRef(0);

  useEffect(() => {
    if (!clubId || typeof WebSocket === "undefined") {
      setStatus("closed");
      return;
    }
    let ws: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    retry.current = 0;

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/clubs/${encodeURIComponent(clubId)}/realtime`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        retry.current = 0;
        setStatus("open");
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
        // Catch up on anything missed while disconnected.
        void qc.invalidateQueries({ queryKey: ["conversations", clubId] });
        void qc.invalidateQueries({ queryKey: ["messages"] });
        void qc.invalidateQueries({ queryKey: ["thread"] });
      };
      ws.onmessage = (e) => {
        let event: AnyEvent;
        try {
          event = JSON.parse(String(e.data)) as AnyEvent;
        } catch {
          return;
        }
        switch (event.type) {
          case "message.created":
          case "message.updated":
            applyMessageEvent(qc, event.message);
            void qc.invalidateQueries({ queryKey: ["conversations", clubId] });
            void qc.invalidateQueries({ queryKey: ["club-dashboard", clubId] });
            void qc.invalidateQueries({ queryKey: ["home"] });
            break;
          case "message.reaction":
            applyReactionEvent(qc, event.messageId, event.reactions);
            break;
          case "thread.reply":
            applyThreadReplyEvent(qc, event);
            break;
          case "progress.updated":
            void qc.invalidateQueries({ queryKey: ["progress-all", clubId, event.editionId] });
            void qc.invalidateQueries({ queryKey: ["progress", clubId, event.editionId] });
            void qc.invalidateQueries({ queryKey: ["rooms", clubId, event.editionId] });
            break;
          case "rooms.changed":
            void qc.invalidateQueries({ queryKey: ["rooms", clubId, event.editionId] });
            void qc.invalidateQueries({ queryKey: ["guide", clubId, event.editionId] });
            void qc.invalidateQueries({ queryKey: ["conversations", clubId] });
            break;
          case "conversation.created":
            void qc.invalidateQueries({ queryKey: ["conversations", clubId] });
            break;
          case "notification.created":
            void qc.invalidateQueries({ queryKey: ["notifications"] });
            break;
          case "club.updated":
            void qc.invalidateQueries({ queryKey: ["club", event.clubId] });
            void qc.invalidateQueries({ queryKey: ["club-dashboard", event.clubId] });
            void qc.invalidateQueries({ queryKey: ["club-members", event.clubId] });
            void qc.invalidateQueries({ queryKey: ["me"] });
            void qc.invalidateQueries({ queryKey: ["home"] });
            break;
          case "membership.ended":
            stopped = true;
            void qc.invalidateQueries({ queryKey: ["me"] });
            void qc.invalidateQueries({ queryKey: ["home"] });
            qc.removeQueries({ queryKey: ["club", event.clubId] });
            toast("You are no longer a member of that club.");
            navigate("/", { replace: true });
            break;
        }
      };
      ws.onclose = (e) => {
        clearInterval(ping);
        setStatus("closed");
        if (stopped) return;
        if (e.code === 4001) {
          // Session ended on the server (sign-out elsewhere / password reset).
          void qc.invalidateQueries({ queryKey: ["session"] });
          return;
        }
        if (e.code === 4003) {
          // Membership ended: the server closes the socket after membership.ended.
          void qc.invalidateQueries({ queryKey: ["me"] });
          return;
        }
        const delay = Math.min(30_000, 1000 * 2 ** retry.current++);
        reconnect = setTimeout(connect, delay + Math.random() * 500);
      };
    };

    connect();
    const onOnline = () => {
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        clearTimeout(reconnect);
        retry.current = 0;
        connect();
      }
    };
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      window.removeEventListener("online", onOnline);
      clearInterval(ping);
      clearTimeout(reconnect);
      ws?.close(1000, "bye");
    };
  }, [clubId, qc, navigate, toast]);

  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>;
}
