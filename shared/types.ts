import type {
  BookFormat,
  ClubActivityKind,
  ClubBookStatus,
  NotificationKind,
  ReadingStatus,
  ReviewReaction,
  Sentiment,
  ShareResourceType,
  Visibility,
} from "./constants";

/** Error envelope returned by every failing API call. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
    /** For 409 conflicts: the latest server copy of the record. */
    current?: unknown;
  };
}

export interface MemberSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Genre {
  id: string;
  name: string;
  slug: string;
  version: number;
  archivedAt: string | null;
  bookCount?: number;
}

export interface EditionSummary {
  id: string;
  bookId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  coverUrl: string | null;
  isbn13: string | null;
  publishedYear: number | null;
  format: BookFormat;
  pageCount: number | null;
}

export interface EditionDetail extends EditionSummary {
  isbn10: string | null;
  publisher: string | null;
  publishedDate: string | null;
  language: string | null;
  description: string | null;
  coverUrlLarge: string | null;
  googleBooksId: string | null;
  openLibraryId: string | null;
  source: "google_books" | "open_library" | "manual" | "goodreads";
  version: number;
  genres: Genre[];
  createdAt: string;
  updatedAt: string;
  retailerLinks: { label: string; url: string }[];
}

/** A search hit from a catalogue provider (not yet stored). */
export interface CatalogResult {
  provider: "google_books" | "open_library";
  providerId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  publishedYear: number | null;
  publisher: string | null;
  isbn13: string | null;
  isbn10: string | null;
  pageCount: number | null;
  coverUrl: string | null;
  format: BookFormat;
  /** If the edition already exists locally, its id. */
  existingEditionId: string | null;
}

export interface BookSearchResponse {
  local: EditionSummary[];
  catalog: CatalogResult[];
  provider: "google_books" | "open_library" | "none";
  providerError: string | null;
}

export interface UserBook {
  id: string;
  userId: string;
  edition: EditionSummary;
  status: ReadingStatus;
  startedAt: string | null;
  finishedAt: string | null;
  currentPage: number | null;
  progressPercent: number | null;
  visibility: Visibility;
  /** Personal notes are only ever returned to their owner. */
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReactionCount {
  reaction: ReviewReaction;
  count: number;
  mine: boolean;
}

export interface Review {
  id: string;
  author: MemberSummary;
  edition: EditionSummary;
  body: string;
  sentiment: Sentiment;
  visibility: Visibility;
  containsSpoilers: boolean;
  reactions: ReactionCount[];
  isOwn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  id: string;
  author: MemberSummary;
  edition: EditionSummary;
  text: string;
  location: string | null;
  note: string | null;
  visibility: Visibility;
  isOwn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GoalProgress {
  year: number;
  target: number | null;
  completed: number;
}

export interface AuditInfo {
  createdBy: MemberSummary | null;
  updatedBy: MemberSummary | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ClubGoal extends AuditInfo {
  id: string;
  year: number;
  target: number;
  completed: number;
}

export interface ClubAnnualBook extends AuditInfo {
  id: string;
  year: number;
  edition: EditionSummary;
  position: number;
  status: ClubBookStatus;
  completedAt: string | null;
  note: string | null;
  archivedAt: string | null;
}

export interface Meeting extends AuditInfo {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  details: string | null;
  edition: EditionSummary | null;
  archivedAt: string | null;
}

export interface Assignment extends AuditInfo {
  id: string;
  edition: EditionSummary;
  meeting: { id: string; title: string; startsAt: string } | null;
  dueDate: string;
  readingScope: string | null;
  details: string | null;
  archivedAt: string | null;
}

export interface ClubActivity extends AuditInfo {
  id: string;
  title: string;
  kind: ClubActivityKind;
  details: string | null;
  startsAt: string | null;
  archivedAt: string | null;
}

export interface Recommendation {
  id: string;
  recommender: MemberSummary;
  recipient: MemberSummary | null;
  edition: EditionSummary;
  note: string | null;
  isOwn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  kind: "club" | "direct";
  title: string;
  otherMember: MemberSummary | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: MemberSummary;
  /** null when the message was removed by its sender. */
  body: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ShareLink {
  id: string;
  resourceType: ShareResourceType;
  resourceId: string | null;
  year: number | null;
  status: ReadingStatus | null;
  label: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

export interface ShareLinkCreated extends ShareLink {
  /** Only returned once, at creation. The server stores a hash of the token. */
  url: string;
}

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  actor: MemberSummary | null;
  createdAt: string;
  readAt: string | null;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
}

export interface NotificationPreferences {
  inappDirectMessages: boolean;
  inappRecommendations: boolean;
  inappClubUpdates: boolean;
  inappReactions: boolean;
  emailClubUpdates: boolean;
  emailRecommendations: boolean;
}

export interface Profile {
  bio: string | null;
  location: string | null;
  pronouns: string | null;
  favoriteGenres: string | null;
  defaultVisibility: Visibility;
}

export interface Me extends MemberSummary {
  email: string;
  emailVerified: boolean;
  profile: Profile;
  preferences: NotificationPreferences;
  createdAt: string;
}

export interface MemberProfile extends MemberSummary {
  profile: Omit<Profile, "defaultVisibility">;
  joinedAt: string;
  stats: { finishedThisYear: number; reading: number; tbr: number; reviews: number; quotes: number };
  goal: GoalProgress;
}

export interface ActivityItem {
  id: string;
  kind: "finished" | "started" | "review" | "quote" | "recommendation" | "club_book" | "meeting" | "assignment";
  actor: MemberSummary;
  edition: EditionSummary | null;
  summary: string;
  link: string;
  createdAt: string;
}

export interface DashboardData {
  personalGoal: GoalProgress;
  clubGoal: ClubGoal | null;
  clubCompleted: number;
  currentlyReading: UserBook[];
  nextMeeting: Meeting | null;
  currentAssignments: Assignment[];
  activity: ActivityItem[];
  unreadMessages: number;
  unreadNotifications: number;
}

export interface ImportResult {
  importId: string;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; title: string; message: string }[];
}

export interface ImportRecord {
  id: string;
  source: "goodreads";
  status: "running" | "completed" | "failed";
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errorCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface PublicConfig {
  appName: string;
  turnstileSiteKey: string;
  environment: string;
  googleBooksEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Public share payloads (no private fields: no email, no notes, no ids of members)
// ---------------------------------------------------------------------------

export interface PublicEdition {
  title: string;
  subtitle: string | null;
  authors: string[];
  coverUrl: string | null;
  isbn13: string | null;
  publishedYear: number | null;
}

export type PublicShare =
  | {
      type: "review";
      author: string;
      edition: PublicEdition;
      body: string;
      sentiment: Sentiment;
      containsSpoilers: boolean;
      createdAt: string;
    }
  | { type: "quote"; author: string; edition: PublicEdition; text: string; location: string | null; createdAt: string }
  | {
      type: "reading_list";
      owner: string;
      title: string;
      items: { edition: PublicEdition; status: ReadingStatus; finishedAt: string | null }[];
    }
  | {
      type: "club_list";
      title: string;
      year: number;
      goal: number | null;
      items: { edition: PublicEdition; status: ClubBookStatus; position: number }[];
    };

// ---------------------------------------------------------------------------
// Realtime (WebSocket) events pushed by the ClubRealtime Durable Object
// ---------------------------------------------------------------------------

export type RealtimeEvent =
  | { type: "message.created"; message: Message }
  | { type: "message.updated"; message: Message }
  | { type: "conversation.created"; conversationId: string }
  | { type: "notification.created"; notification: AppNotification }
  | { type: "hello"; userId: string }
  | { type: "pong" };
