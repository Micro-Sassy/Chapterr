// Feature wave 2 types owned by files/branding/screening/push/streaks/challenges/recaps (W3/F3).
// Re-exported from shared/types.ts. Keep additive; document in docs/FEATURES-2.md.
import type { ChallengeKind, FileKind, JoinPolicy } from "./constants";
import type { EditionSummary, MemberSummary } from "./types";

export interface FileRecord {
  id: string;
  clubId: string | null;
  kind: FileKind;
  title: string;
  contentType: string;
  size: number;
  meetingId: string | null;
  url: string;
  owner: MemberSummary | null;
  createdAt: string;
}

export interface ClubBranding {
  bannerUrl: string | null;
  accentColor: string | null;
}

export interface ScreeningQuestion {
  id: string;
  label: string;
  required: boolean;
}

export interface ClubSettings {
  welcomeMessage: string | null;
  joinPolicy: JoinPolicy;
  screeningQuestions: ScreeningQuestion[];
  timezone: string;
  reminderOffsets: number[];
  rolesRotation: { host: boolean; picker: boolean; notetaker: boolean };
  discordWebhookConfigured: boolean;
}

export interface JoinRequest {
  id: string;
  member: MemberSummary;
  answers: { questionId: string; label: string; answer: string }[];
  message: string | null;
  status: "pending" | "approved" | "declined";
  decidedBy: MemberSummary | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface BulkInviteResult {
  sent: number;
  skipped: { row: number; email: string; reason: string }[];
}

export interface PushPublicKey {
  publicKey: string;
}

export interface ReadingLogEntry {
  day: string;
  pages: number;
  minutes: number;
  edition: EditionSummary | null;
  note: string | null;
}

export interface Streak {
  current: number;
  longest: number;
  today: boolean;
  lastDay: string | null;
}

export interface ChallengeParticipant extends MemberSummary {
  progress: number;
  completedAt: string | null;
}

export interface Challenge {
  id: string;
  clubId: string | null;
  owner: MemberSummary | null;
  title: string;
  description: string | null;
  kind: ChallengeKind;
  target: number;
  genreId: string | null;
  startsOn: string;
  endsOn: string;
  joined: boolean;
  myProgress: number;
  participants: ChallengeParticipant[];
  version: number;
  createdAt: string;
}

export interface MonthlyRecap {
  period: string;
  scope: "user" | "club";
  booksFinished: { edition: EditionSummary; by: MemberSummary | null }[];
  pagesRead: number;
  minutesRead: number;
  streakBest: number;
  topGenre: string | null;
  meetingsAttended: number;
  quotesSaved: number;
  reviewsWritten: number;
  headline: string;
}

export interface ClubWrapped {
  year: number;
  clubName: string;
  booksRead: EditionSummary[];
  pagesRead: number;
  meetings: number;
  attendanceRate: number | null;
  mostLovedBook: { edition: EditionSummary; loved: number } | null;
  topReviewer: { member: MemberSummary; reviews: number } | null;
  longestStreak: { member: MemberSummary; days: number } | null;
  busiestMonth: { month: string; messages: number } | null;
  mostReacted: { excerpt: string; author: MemberSummary | null; reactions: number } | null;
  polls: { held: number; votesCast: number };
  members: number;
}

export interface Feasibility {
  pageCount: number | null;
  estimatedHours: number | null;
  library: { openLibraryLendable: boolean | null; archiveOrgUrl: string | null; worldcatUrl: string | null };
  ebook: { googleBooksPrice: string | null; googleBooksUrl: string | null; kindleSearchUrl: string; kindleUnlimited: "unknown" };
  audio: { libroFmUrl: string; audibleSearchUrl: string };
  checkedAt: string;
}

export interface ShareLinks {
  text: string;
  url: string;
  whatsapp: string;
  sms: string;
  email: string;
}

export interface ClubIntelligence {
  duplicatePicks: { clubName: string; year: number; status: string }[];
  suggestions: { edition: EditionSummary; reason: string }[];
}
