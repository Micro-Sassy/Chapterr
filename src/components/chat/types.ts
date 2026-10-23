import type { Conversation, ConversationExtras, Message, MessageExtras, Page } from "@shared/types";
import type { InfiniteData } from "@tanstack/react-query";

/**
 * A chat message as the client sees it. Wave 2 fields are optional so the UI
 * keeps working while the API is still being built; `pending` and `clientId`
 * exist only on optimistic entries that have not been confirmed by the server.
 */
export type ChatMessage = Message &
  Partial<MessageExtras> & {
    clientId?: string;
    pending?: "sending" | "failed";
    /** Local preview URLs for attachments on an optimistic message. */
    localPreviews?: string[];
  };

/**
 * A conversation row. Room conversations are stored with kind "direct" and a
 * `roomId`; the client treats `roomId !== null` as a room whatever `kind` says.
 */
export type ChatConversation = Conversation & Partial<ConversationExtras>;

/** A thread page carries the parent alongside the replies. */
export type ThreadPage = Page<ChatMessage> & { parent?: ChatMessage };

export type MessagePages = InfiniteData<Page<ChatMessage>>;

export const isRoomConversation = (c: ChatConversation) => !!c.roomId;

/** Conversation pages are newest-first; items within a page are chronological. Flatten to one chronological list. */
export function flattenPages(data: MessagePages | undefined): ChatMessage[] {
  if (!data) return [];
  const out: ChatMessage[] = [];
  for (let i = data.pages.length - 1; i >= 0; i--) out.push(...(data.pages[i]?.items ?? []));
  return out;
}

/** Thread pages are oldest-first (the cursor walks towards newer replies). Flatten in page order. */
export function flattenThread(data: MessagePages | undefined): ChatMessage[] {
  if (!data) return [];
  return data.pages.flatMap((p) => p.items);
}

export const messagesKey = (conversationId: string) => ["messages", conversationId] as const;
export const threadKey = (parentId: string) => ["thread", parentId] as const;
export const scheduledKey = (clubId: string) => ["scheduled", clubId] as const;
export const roomsKey = (clubId: string, editionId: string) => ["rooms", clubId, editionId] as const;
export const roomKey = (clubId: string, roomId: string) => ["room", clubId, roomId] as const;
export const progressKey = (clubId: string, editionId: string) => ["progress", clubId, editionId] as const;
export const progressAllKey = (clubId: string, editionId: string) => ["progress-all", clubId, editionId] as const;
export const guideKey = (clubId: string, editionId: string) => ["guide", clubId, editionId] as const;
