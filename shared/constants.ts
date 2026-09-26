export const APP_NAME = "Teel Ridge Book Club";

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
 * the owner; "club" is visible to every signed-in member. Nothing is public
 * unless its owner creates an explicit share link.
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
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const CLUB_CONVERSATION_ID = "club";

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
  "teelridge",
  "bookclub",
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
