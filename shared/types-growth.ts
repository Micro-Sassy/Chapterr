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

// ---------------------------------------------------------------------------
// Additions (W3): account contact details, push preferences, join requests as
// seen by the requester, invite preview extras, feasibility/bridge extras.
// ---------------------------------------------------------------------------

/** Phone + SMS opt-in, returned on `Me` next to the existing fields. */
export interface AccountContact {
  phone: string | null;
  smsOptIn: boolean;
}

/** Wave 2 notification channels, merged into `Me.preferences`. */
export interface PushPreferences {
  pushEnabled: boolean;
  pushMeetingReminders: boolean;
  pushMentions: boolean;
  emailMeetingReminders: boolean;
  smsMeetingReminders: boolean;
  digestCatchUp: boolean;
}

/** A join request as seen by the member who made it (`GET /api/clubs/requests`). */
export interface MyJoinRequest {
  id: string;
  club: { id: string; name: string };
  status: "pending" | "approved" | "declined";
  createdAt: string;
  decidedAt: string | null;
}

/** Extra fields on the invite preview when the club screens new members. */
export interface InvitePreviewExtras {
  joinPolicy: JoinPolicy;
  screeningQuestions: ScreeningQuestion[];
}

/** Response of `POST /api/clubs/join` when the club requires approval. */
export interface JoinPending {
  pending: true;
  requestId: string;
  clubName: string;
}

export interface PushSubscriptionInfo {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Payload delivered to the service worker (JSON body of the push message). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Storage usage for a club (`GET /files/usage`). */
export interface FileUsage {
  files: number;
  bytes: number;
  filesMax: number;
  bytesMax: number;
  perFileMax: number;
  storage: "r2" | "d1";
}

/** Extra fields on `ShareLinks`: `copy` is the ready-to-paste text with the link. */
export interface ShareLinksExtras {
  copy: string;
}
