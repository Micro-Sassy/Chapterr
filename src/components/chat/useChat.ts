import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { ClubMember, MemberSummary, Message, Page, ReactionSummary, ScheduledMessage } from "@shared/types";
import { clubApi } from "@/components/records";
import { api, ApiRequestError } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { applyMessageEvent, applyReactionEvent, putOptimistic, removeOptimistic, useRealtimeStatus } from "@/lib/realtime";
import { messagesKey, scheduledKey, threadKey, type ChatMessage, type MessagePages, type ThreadPage } from "./types";

const PAGE = 50;

export function useClubMembers(clubId: string) {
  return useQuery({ queryKey: ["club-members", clubId], queryFn: () => api<ClubMember[]>(clubApi(clubId, "/members")), staleTime: 60_000 });
}

/** The signed-in member as a MemberSummary, for optimistic entries. */
export function useMeSummary(): MemberSummary | null {
  const { data: session } = useSession();
  const u = session?.user;
  return u ? { id: u.id, username: u.username, displayName: u.name, avatarUrl: u.image } : null;
}

/** Is this error the server telling us the room gate has not been reached? */
export function isRoomLocked(err: unknown): err is ApiRequestError {
  return err instanceof ApiRequestError && err.status === 403 && err.code === "room_locked";
}

/** Live pages of a conversation (newest first; realtime appends to the first page). */
export function useMessages(clubId: string, conversationId: string, enabled = true) {
  const realtime = useRealtimeStatus();
  return useInfiniteQuery({
    queryKey: messagesKey(conversationId),
    queryFn: ({ pageParam }) =>
      api<Page<ChatMessage>>(clubApi(clubId, `/conversations/${encodeURIComponent(conversationId)}/messages?limit=${PAGE}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    // Realtime keeps this fresh; poll slowly as a fallback when the socket is down.
    refetchInterval: realtime === "open" ? false : 20_000,
    retry: (count, err) => !isRoomLocked(err) && count < 2,
  });
}

/** Replies to one message, oldest first; the cursor walks towards newer replies. */
export function useThread(clubId: string, parentId: string | null) {
  return useInfiniteQuery({
    queryKey: threadKey(parentId ?? ""),
    queryFn: ({ pageParam }) =>
      api<ThreadPage>(clubApi(clubId, `/messages/${encodeURIComponent(parentId!)}/thread?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!parentId,
  });
}

export interface SendInput {
  body: string;
  attachmentFileIds?: string[];
  /** Object URLs of the chosen photos, shown while the message is in flight. */
  localPreviews?: string[];
}

interface SendVars extends SendInput {
  clientId: string;
}

const newClientId = () => `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Posting to a conversation or a thread, optimistically: the message appears at
 * once marked as sending; on failure it stays with a Retry affordance; on success
 * the server copy replaces it.
 */
export function useSendMessage(clubId: string, conversationId: string, parentId: string | null = null) {
  const qc = useQueryClient();
  const me = useMeSummary();
  const listKey = parentId ? threadKey(parentId) : messagesKey(conversationId);
  const drafts = useRef(new Map<string, SendVars>());

  const mutation = useMutation({
    mutationFn: (vars: SendVars) =>
      api<ChatMessage>(clubApi(clubId, `/conversations/${encodeURIComponent(conversationId)}/messages`), {
        body: { body: vars.body, parentId, attachmentFileIds: vars.attachmentFileIds ?? [] },
      }),
    onMutate: (vars) => {
      drafts.current.set(vars.clientId, vars);
      if (!me) return;
      const optimistic: ChatMessage = {
        id: vars.clientId,
        clientId: vars.clientId,
        conversationId,
        sender: me,
        body: vars.body,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        parentId,
        replyCount: 0,
        attachments: [],
        mentions: [],
        reactions: [],
        kind: "user",
        pending: "sending",
        localPreviews: vars.localPreviews,
      };
      putOptimistic(qc, listKey, optimistic, parentId ? "last" : "first");
    },
    onSuccess: (msg, vars) => {
      drafts.current.delete(vars.clientId);
      removeOptimistic(qc, listKey, vars.clientId);
      applyMessageEvent(qc, { ...msg, parentId: msg.parentId ?? parentId });
      if (parentId) {
        // The realtime event carries the exact count; until it arrives, count locally.
        qc.setQueriesData<MessagePages>({ queryKey: ["messages"] }, (prev) => bumpReplyCount(prev, parentId));
      }
      void qc.invalidateQueries({ queryKey: ["conversations", clubId] });
    },
    onError: (_err, vars) => {
      qc.setQueryData<MessagePages>(listKey, (prev) => {
        if (!prev) return prev;
        return { ...prev, pages: prev.pages.map((p) => ({ ...p, items: p.items.map((m) => (m.clientId === vars.clientId ? { ...m, pending: "failed" } : m)) })) };
      });
    },
  });

  const send = useCallback((input: SendInput) => mutation.mutate({ ...input, clientId: newClientId() }), [mutation]);
  const retry = useCallback(
    (clientId: string) => {
      const vars = drafts.current.get(clientId);
      if (vars) mutation.mutate(vars);
    },
    [mutation],
  );
  const discard = useCallback(
    (clientId: string) => {
      drafts.current.delete(clientId);
      removeOptimistic(qc, listKey, clientId);
    },
    [qc, listKey],
  );
  return { send, retry, discard, isPending: mutation.isPending, error: mutation.error };
}

function bumpReplyCount(prev: MessagePages | undefined, parentId: string): MessagePages | undefined {
  if (!prev) return prev;
  return {
    ...prev,
    pages: prev.pages.map((p) => ({ ...p, items: p.items.map((m) => (m.id === parentId ? { ...m, replyCount: (m.replyCount ?? 0) + 1 } : m)) })),
  };
}

export function useEditMessage(clubId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, body }: { messageId: string; body: string }) => api<ChatMessage>(clubApi(clubId, `/messages/${encodeURIComponent(messageId)}`), { method: "PUT", body: { body } }),
    onSuccess: (msg) => applyMessageEvent(qc, msg),
  });
}

export function useRemoveMessage(clubId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => api<ChatMessage>(clubApi(clubId, `/messages/${encodeURIComponent(messageId)}`), { method: "DELETE" }),
    onSuccess: (msg) => applyMessageEvent(qc, msg),
  });
}

/** Toggle one emoji on a message. Applied optimistically; the server summary wins when it arrives. */
export function useToggleReaction(clubId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, emoji }: { message: ChatMessage; emoji: string }) =>
      api<{ reactions?: ReactionSummary[] } | Message | null>(clubApi(clubId, `/messages/${encodeURIComponent(message.id)}/reactions`), { method: "PUT", body: { emoji } }),
    onMutate: ({ message, emoji }) => {
      const before = message.reactions ?? [];
      applyReactionEvent(qc, message.id, toggleLocally(before, emoji));
      return { before };
    },
    onSuccess: (res, { message }) => {
      const reactions = res && typeof res === "object" && "reactions" in res && Array.isArray(res.reactions) ? res.reactions : null;
      if (reactions) applyReactionEvent(qc, message.id, reactions);
    },
    onError: (_e, { message }, ctx) => {
      if (ctx) applyReactionEvent(qc, message.id, ctx.before);
    },
  });
}

export function toggleLocally(reactions: ReactionSummary[], emoji: string): ReactionSummary[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) return [...reactions, { emoji, count: 1, mine: true }];
  if (existing.mine) {
    return reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r)).filter((r) => r.count > 0);
  }
  return reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r));
}

/** Mark the conversation read whenever its newest message changes. */
export function useMarkRead(clubId: string, conversationId: string, newestId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!newestId || newestId.startsWith("local-")) return;
    void api(clubApi(clubId, `/conversations/${encodeURIComponent(conversationId)}/read`), { body: {} })
      .then(() => qc.invalidateQueries({ queryKey: ["conversations", clubId] }))
      .catch(() => undefined);
  }, [clubId, conversationId, newestId, qc]);
}

// --- Scheduled messages ---------------------------------------------------------------

export function useScheduled(clubId: string) {
  return useQuery({ queryKey: scheduledKey(clubId), queryFn: () => api<ScheduledMessage[]>(clubApi(clubId, "/scheduled")) });
}

export function useScheduleMessage(clubId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; body: string; sendAt: string }) => api<ScheduledMessage>(clubApi(clubId, "/scheduled"), { body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: scheduledKey(clubId) }),
  });
}

export function useCancelScheduled(clubId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(clubApi(clubId, `/scheduled/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: scheduledKey(clubId) }),
  });
}
