// Feature wave 2 types owned by the chat/rooms/guides work (W2/F2).
// Re-exported from shared/types.ts. Keep additive; document in docs/FEATURES-2.md.
import type { GateType, RoomKind } from "./constants";
import type { EditionSummary, MemberSummary } from "./types";

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
