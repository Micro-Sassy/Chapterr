// Feature wave 2 types owned by the chat/rooms/guides work (W2/F2).
// Re-exported from shared/types.ts. Keep additive; document in docs/FEATURES-2.md.
import type { GateType, RoomKind } from "./constants";
import type { EditionSummary, MemberSummary, Message } from "./types";

export interface Attachment {
  fileId: string;
  contentType: string;
  width: number | null;
  height: number | null;
  title: string | null;
  url: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface MessageExtras {
  parentId: string | null;
  replyCount: number;
  attachments: Attachment[];
  mentions: MemberSummary[];
  reactions: ReactionSummary[];
  kind: "user" | "system" | "welcome" | "digest";
}

export interface ScheduledMessage {
  id: string;
  conversationId: string;
  conversationTitle: string;
  body: string;
  sendAt: string;
  createdAt: string;
}

export interface ClubReadingProgress {
  chapter: number | null;
  page: number | null;
  percent: number | null;
  finished: boolean;
  updatedAt: string | null;
}

export interface MemberProgress extends MemberSummary {
  progress: ClubReadingProgress;
}

export interface DiscussionRoom {
  id: string;
  clubId: string;
  edition: EditionSummary;
  kind: RoomKind;
  title: string;
  position: number;
  gateType: GateType;
  gateValue: number | null;
  conversationId: string;
  unlocked: boolean;
  membersInside: number;
  messageCount: number;
  lastMessageAt: string | null;
  questions: GuideQuestion[];
  version: number;
  createdAt: string;
}

export interface GuideQuestion {
  id: string;
  text: string;
  roomId: string | null;
}

export interface GuideSection {
  title: string;
  questions: GuideQuestion[];
}

export interface DiscussionGuide {
  id: string;
  clubId: string;
  edition: EditionSummary;
  source: "manual" | "template" | "ai";
  sections: GuideSection[];
  version: number;
  updatedBy: MemberSummary | null;
  updatedAt: string;
}

/** A chat message with every wave 2 field. Every message endpoint (club chat, DMs, rooms, threads) returns this shape. */
export interface ChatMessage extends Message, MessageExtras {}

/**
 * Wave 2 additions to a conversation. Discussion rooms reuse the conversations
 * table with kind 'direct' (the CHECK only allows club|direct) and room_id set;
 * clients should treat `roomId !== null` as a room, whatever `kind` says.
 */
export interface ConversationExtras {
  roomId: string | null;
}

export interface RoomGate {
  type: GateType;
  value: number | null;
}

/** Body of a 403 `room_locked` error. */
export interface RoomLockedError {
  code: "room_locked";
  message: string;
  gate: RoomGate;
  progress: ClubReadingProgress;
}

/** Realtime events added in wave 2. The client unions these with RealtimeEvent. */
export type RealtimeEventWave2 =
  | { type: "message.reaction"; messageId: string; conversationId: string; reactions: ReactionSummary[] }
  | { type: "thread.reply"; parentId: string; conversationId: string; replyCount: number; message: ChatMessage }
  | { type: "progress.updated"; editionId: string; userId: string; progress: ClubReadingProgress }
  | { type: "rooms.changed"; editionId: string };
