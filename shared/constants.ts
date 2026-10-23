export const APP_NAME = "Chapterr";
export const APP_TAGLINE = "Your club, one shelf";

/** Club roles. Owners created the club; admins manage members; everyone else is a member. */
export const CLUB_ROLES = ["owner", "admin", "member"] as const;
export type ClubRole = (typeof CLUB_ROLES)[number];
export const CLUB_ROLE_LABELS: Record<ClubRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** Billing plans. Every club is free while Chapterr is in beta. */
export const CLUB_PLANS = ["beta_free", "free", "standard"] as const;
export type ClubPlan = (typeof CLUB_PLANS)[number];
export const CLUB_PLAN_LABELS: Record<ClubPlan, string> = { beta_free: "Free (beta)", free: "Free", standard: "Standard" };
/** Price per club per month once billing is enabled, in US cents. */
export const CLUB_PRICE_CENTS = 100;

export const READING_STATUSES = ["tbr", "reading", "finished", "abandoned"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];
export const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  tbr: "To be read",
  reading: "Reading",
  finished: "Finished",
  abandoned: "Did not finish",
};

/** Five-state review sentiment, strongest positive first. */
export const SENTIMENTS = ["loved", "liked", "mixed", "disliked", "hated"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  loved: "Loved it",
  liked: "Liked it",
  mixed: "Mixed feelings",
  disliked: "Didn't like it",
  hated: "Really disliked it",
};

/**
 * Visibility of personal content inside the app. "private" is visible only to
 * the owner; "club" is visible to members of any club the viewer shares with
 * the owner. Nothing is public unless its owner creates an explicit share link.
 */
export const VISIBILITIES = ["private", "club"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const BOOK_FORMATS = ["hardcover", "paperback", "ebook", "audiobook", "other", "unknown"] as const;
export type BookFormat = (typeof BOOK_FORMATS)[number];

export const REVIEW_REACTIONS = ["like", "insightful", "funny", "agree"] as const;
export type ReviewReaction = (typeof REVIEW_REACTIONS)[number];

export const CLUB_BOOK_STATUSES = ["planned", "current", "completed"] as const;
export type ClubBookStatus = (typeof CLUB_BOOK_STATUSES)[number];

export const CLUB_ACTIVITY_KINDS = ["event", "discussion", "challenge", "other"] as const;
export type ClubActivityKind = (typeof CLUB_ACTIVITY_KINDS)[number];

/**
 * Content that can be shared through a public link. Chats and messages are
 * deliberately absent — they can never be shared publicly.
 */
export const SHARE_RESOURCE_TYPES = ["review", "quote", "reading_list", "club_list"] as const;
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];

export const NOTIFICATION_KINDS = [
  "direct_message",
  "recommendation",
  "club_assignment",
  "club_meeting",
  "review_reaction",
  "club_member_joined",
  "club_role_changed",
  "club_removed",
  // Feature wave 2
  "meeting_reminder",
  "rsvp_update",
  "poll_opened",
  "poll_closed",
  "join_request",
  "join_approved",
  "mention",
  "thread_reply",
  "reaction",
  "digest",
  "challenge_update",
  "welcome",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const LIMITS = {
  usernameMin: 3,
  usernameMax: 30,
  displayNameMax: 60,
  passwordMin: 10,
  passwordMax: 128,
  bioMax: 1000,
  reviewMax: 20_000,
  quoteMax: 4_000,
  notesMax: 10_000,
  messageMax: 4_000,
  avatarBytesMax: 400_000,
  importRowsPerBatch: 50,
  importFileBytesMax: 10_000_000,
  clubNameMin: 2,
  clubNameMax: 60,
  clubDescriptionMax: 500,
  /** Clubs one account may belong to. */
  clubsPerUserMax: 20,
  /** Clubs one account may own. */
  clubsOwnedMax: 10,
  /** Members per club (also the default clubs.member_limit). */
  clubMembersMax: 200,
  inviteCodeLength: 10,
  /** Items per page on paginated lists. */
  pageSize: 50,
  pageSizeMax: 100,
} as const;

export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "root",
  "support",
  "help",
  "system",
  "moderator",
  "mod",
  "staff",
  "chapterr",
  "bookclub",
  "billing",
  "app",
  "www",
  "join",
  "club",
  "api",
  "auth",
  "login",
  "logout",
  "register",
  "settings",
  "me",
  "null",
  "undefined",
  "anonymous",
  "everyone",
]);

// ---------------------------------------------------------------------------
// Feature wave 2 (see docs/FEATURES-2.md)
// ---------------------------------------------------------------------------

export const RSVP_STATUSES = ["going", "maybe", "no"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];
export const RSVP_LABELS: Record<RsvpStatus, string> = { going: "Going", maybe: "Maybe", no: "Can't make it" };

export const MEETING_ROLES = ["host", "picker", "notetaker"] as const;
export type MeetingRole = (typeof MEETING_ROLES)[number];
export const MEETING_ROLE_LABELS: Record<MeetingRole, string> = { host: "Host", picker: "Picker", notetaker: "Note-taker" };

export const RECURRENCE_FREQS = ["weekly", "biweekly", "monthly", "custom"] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

export const SIGNUP_KINDS = ["potluck", "supplies", "tasks", "other"] as const;
export type SignupKind = (typeof SIGNUP_KINDS)[number];

export const POLL_KINDS = ["book", "date", "custom"] as const;
export type PollKind = (typeof POLL_KINDS)[number];

export const FILE_KINDS = ["document", "photo", "recipe", "minutes", "banner", "attachment"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const ROOM_KINDS = ["chapter", "milestone", "reflection"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];
export const GATE_TYPES = ["none", "chapter", "page", "percent", "finished"] as const;
export type GateType = (typeof GATE_TYPES)[number];

export const CHALLENGE_KINDS = ["books", "pages", "genre", "streak", "custom"] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

export const PACE_CADENCES = ["weekly", "twice_weekly", "daily"] as const;
export type PaceCadence = (typeof PACE_CADENCES)[number];

export const MAPPING_KINDS = ["kindle", "audio"] as const;
export type MappingKind = (typeof MAPPING_KINDS)[number];

export const JOIN_POLICIES = ["link", "approval"] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];

/** Reactions available on chat messages (a curated set keeps the picker small and the data clean). */
export const MESSAGE_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "👏", "📚", "🔥", "🤔", "✅", "🎉", "👀", "☕", "🍷", "🥐", "💬"] as const;
export type MessageEmoji = (typeof MESSAGE_EMOJI)[number];

export const WAVE2_LIMITS = {
  pollOptionsMax: 20,
  pollTitleMax: 200,
  signupItemsMax: 60,
  attachmentsPerMessage: 4,
  fileBytesMaxD1: 2_000_000,
  fileBytesMaxR2: 25_000_000,
  filesPerClub: 200,
  clubStorageBytesMax: 200_000_000,
  clubStorageBytesMaxD1: 50_000_000,
  bulkInviteRowsMax: 200,
  recurrenceOccurrencesMax: 52,
  roomsPerBookMax: 60,
  guideQuestionsMax: 40,
  screeningQuestionsMax: 5,
  scheduledMessagesPerUser: 20,
  welcomeMessageMax: 1000,
  notesMax: 20_000,
} as const;
