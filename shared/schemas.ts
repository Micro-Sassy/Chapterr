import { z } from "zod";
import {
  BOOK_FORMATS,
  CLUB_ACTIVITY_KINDS,
  CLUB_BOOK_STATUSES,
  LIMITS,
  READING_STATUSES,
  RESERVED_USERNAMES,
  REVIEW_REACTIONS,
  SENTIMENTS,
  SHARE_RESOURCE_TYPES,
  VISIBILITIES,
} from "./constants";
import { normalizeIsbn } from "./isbn";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Trimmed single-line text without control characters. */
export const plainText = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min, min > 0 ? "Required" : undefined)
    .max(max, `Must be ${max} characters or fewer`)
    .refine((v) => !CONTROL_CHARS.test(v) && !/[\r\n]/.test(v), "Contains unsupported characters");

/** Trimmed multi-line text without control characters (newlines/tabs allowed). */
export const longText = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min, min > 0 ? "Required" : undefined)
    .max(max, `Must be ${max.toLocaleString("en-US")} characters or fewer`)
    .refine((v) => !CONTROL_CHARS.test(v), "Contains unsupported characters");

export const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id");

/** Calendar date without time, e.g. 2026-03-14. */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Invalid date");

export const isoDateTime = z.iso.datetime({ offset: true });

export const yearSchema = z.coerce.number().int().min(1900).max(2200);

export const optionalNullable = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform((v) => v ?? null);

export const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * Usernames are ASCII, lowercase, 3–30 characters of a–z, 0–9 and single
 * underscores. Restricting the alphabet prevents look-alike (homoglyph)
 * handles, and lowercasing makes uniqueness case-insensitive.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.usernameMin, `At least ${LIMITS.usernameMin} characters`)
  .max(LIMITS.usernameMax, `At most ${LIMITS.usernameMax} characters`)
  .regex(/^[a-z0-9_]+$/, "Use only letters, numbers and underscores")
  .regex(/^[a-z0-9]/, "Must start with a letter or number")
  .regex(/[a-z0-9]$/, "Must end with a letter or number")
  .refine((v) => !v.includes("__"), "Avoid consecutive underscores")
  .refine((v) => !RESERVED_USERNAMES.has(v), "That username is reserved");

export function isValidUsername(value: string): boolean {
  return usernameSchema.safeParse(value).success;
}

export const displayNameSchema = plainText(LIMITS.displayNameMax, 1);

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address").max(254));

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, `Use at least ${LIMITS.passwordMin} characters`)
  .max(LIMITS.passwordMax, `Use at most ${LIMITS.passwordMax} characters`);

export const registerSchema = z
  .object({
    username: usernameSchema,
    displayName: displayNameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptPrivacy: z.literal(true, { error: "Please accept the privacy and use notice" }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
export type RegisterInput = z.input<typeof registerSchema>;

export const signInSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email or username").max(254),
  password: z.string().min(1, "Enter your password").max(LIMITS.passwordMax),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
    revokeOtherSessions: z.boolean().default(true),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export const changeEmailSchema = z.object({
  newEmail: emailSchema,
  currentPassword: z.string().min(1, "Enter your current password"),
});

export const changeUsernameSchema = z.object({
  username: usernameSchema,
  currentPassword: z.string().min(1, "Enter your current password"),
});

export const profileUpdateSchema = z.object({
  displayName: displayNameSchema,
  bio: z.preprocess(emptyToNull, longText(LIMITS.bioMax).nullable()).default(null),
  location: z.preprocess(emptyToNull, plainText(80).nullable()).default(null),
  pronouns: z.preprocess(emptyToNull, plainText(40).nullable()).default(null),
  favoriteGenres: z.preprocess(emptyToNull, plainText(200).nullable()).default(null),
  defaultVisibility: z.enum(VISIBILITIES).default("club"),
});

export const notificationPreferencesSchema = z.object({
  inappDirectMessages: z.boolean(),
  inappRecommendations: z.boolean(),
  inappClubUpdates: z.boolean(),
  inappReactions: z.boolean(),
  emailClubUpdates: z.boolean(),
  emailRecommendations: z.boolean(),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

export const avatarUploadSchema = z.object({
  contentType: z.enum(["image/webp", "image/jpeg", "image/png"]),
  // base64 without data: prefix
  data: z
    .string()
    .max(Math.ceil((LIMITS.avatarBytesMax * 4) / 3) + 8)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Invalid image data"),
});

// ---------------------------------------------------------------------------
// Books & editions
// ---------------------------------------------------------------------------

export const bookSearchSchema = z.object({
  q: z.string().trim().min(2, "Type at least 2 characters").max(200),
});

export const httpsUrl = z
  .url()
  .max(1000)
  .refine((v) => v.startsWith("https://"), "Must be an https:// URL");

export const isbnInput = z
  .string()
  .trim()
  .max(20)
  .refine((v) => v === "" || normalizeIsbn(v).isbn13 !== null, "Not a valid ISBN");

export const manualEditionSchema = z.object({
  title: plainText(300, 1),
  subtitle: z.preprocess(emptyToNull, plainText(300).nullable()).default(null),
  authors: z.array(plainText(150, 1)).min(1, "Add at least one author").max(20),
  isbn: z.preprocess(emptyToNull, isbnInput.nullable()).default(null),
  publisher: z.preprocess(emptyToNull, plainText(200).nullable()).default(null),
  publishedDate: z.preprocess(emptyToNull, plainText(20).nullable()).default(null),
  pageCount: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(50_000).nullable()).default(null),
  format: z.enum(BOOK_FORMATS).default("unknown"),
  language: z.preprocess(emptyToNull, plainText(20).nullable()).default(null),
  description: z.preprocess(emptyToNull, longText(10_000).nullable()).default(null),
  coverUrl: z.preprocess(emptyToNull, httpsUrl.nullable()).default(null),
});
export type ManualEditionInput = z.input<typeof manualEditionSchema>;

export const editionUpdateSchema = manualEditionSchema.extend({ expectedVersion: z.number().int().min(1) });

/**
 * Add an edition found through a catalogue provider. The server re-fetches the
 * metadata itself; client-supplied metadata is never trusted.
 */
/**
 * Metadata from the search result the member picked. It is validated as
 * strictly as manual entry (members can already add any book by hand), lets
 * the server save the edition instantly, and is then enriched in the
 * background from the provider itself.
 */
export const catalogHintSchema = z.object({
  title: plainText(300, 1),
  subtitle: z.preprocess(emptyToNull, plainText(300).nullable()).default(null),
  authors: z.array(plainText(150, 1)).max(20).default([]),
  isbn13: z.preprocess(emptyToNull, z.string().regex(/^\d{13}$/).nullable()).default(null),
  isbn10: z.preprocess(emptyToNull, z.string().regex(/^\d{9}[\dX]$/).nullable()).default(null),
  publisher: z.preprocess(emptyToNull, plainText(200).nullable()).default(null),
  publishedYear: z.preprocess(emptyToNull, z.number().int().min(0).max(2200).nullable()).default(null),
  pageCount: z.preprocess(emptyToNull, z.number().int().min(1).max(50_000).nullable()).default(null),
  coverUrl: z.preprocess(emptyToNull, httpsUrl.nullable()).default(null),
  format: z.enum(BOOK_FORMATS).default("unknown"),
});
export type CatalogHint = z.output<typeof catalogHintSchema>;

export const providerEditionSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("google_books"),
    providerId: z.string().regex(/^[A-Za-z0-9_-]{4,40}$/),
    hint: catalogHintSchema.optional(),
  }),
  z.object({ provider: z.literal("open_library"), providerId: z.string().regex(/^OL\d+M$/), hint: catalogHintSchema.optional() }),
  z.object({ provider: z.literal("isbn"), providerId: isbnInput.refine((v) => v !== "", "ISBN required") }),
]);

export const bookGenresSchema = z.object({
  genreIds: z.array(idSchema).max(30),
});

// ---------------------------------------------------------------------------
// Personal library
// ---------------------------------------------------------------------------

export const userBookSchema = z
  .object({
    editionId: idSchema,
    status: z.enum(READING_STATUSES),
    startedAt: z.preprocess(emptyToNull, dateOnly.nullable()).default(null),
    finishedAt: z.preprocess(emptyToNull, dateOnly.nullable()).default(null),
    currentPage: z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(50_000).nullable()).default(null),
    progressPercent: z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(100).nullable()).default(null),
    visibility: z.enum(VISIBILITIES).default("club"),
    notes: z.preprocess(emptyToNull, longText(LIMITS.notesMax).nullable()).default(null),
  })
  .refine((d) => !(d.startedAt && d.finishedAt) || d.startedAt <= d.finishedAt, {
    path: ["finishedAt"],
    message: "Finish date must be after the start date",
  });
export type UserBookInput = z.input<typeof userBookSchema>;

export const progressUpdateSchema = z.object({
  currentPage: z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(50_000).nullable()).default(null),
  progressPercent: z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(100).nullable()).default(null),
});

export const reviewSchema = z.object({
  editionId: idSchema,
  body: longText(LIMITS.reviewMax),
  sentiment: z.enum(SENTIMENTS),
  visibility: z.enum(VISIBILITIES).default("club"),
  containsSpoilers: z.boolean().default(false),
});
export type ReviewInput = z.input<typeof reviewSchema>;

export const reviewUpdateSchema = reviewSchema.omit({ editionId: true });

export const reactionSchema = z.object({ reaction: z.enum(REVIEW_REACTIONS) });

export const quoteSchema = z.object({
  editionId: idSchema,
  text: longText(LIMITS.quoteMax, 1),
  location: z.preprocess(emptyToNull, plainText(60).nullable()).default(null),
  note: z.preprocess(emptyToNull, longText(2000).nullable()).default(null),
  visibility: z.enum(VISIBILITIES).default("club"),
});
export type QuoteInput = z.input<typeof quoteSchema>;
export const quoteUpdateSchema = quoteSchema.omit({ editionId: true });

export const personalGoalSchema = z.object({
  year: yearSchema,
  target: z.coerce.number().int().min(1).max(1000),
});

export const recommendationSchema = z.object({
  editionId: idSchema,
  recipientUserId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  note: z.preprocess(emptyToNull, longText(2000).nullable()).default(null),
});
export const recommendationUpdateSchema = z.object({
  note: z.preprocess(emptyToNull, longText(2000).nullable()).default(null),
});

// ---------------------------------------------------------------------------
// Shared club data (optimistic concurrency via expectedVersion)
// ---------------------------------------------------------------------------

export const versionSchema = z.object({ expectedVersion: z.number().int().min(1) });

export const clubGoalSchema = z.object({
  year: yearSchema,
  target: z.coerce.number().int().min(1).max(1000),
  expectedVersion: z.number().int().min(1).optional(),
});

export const clubAnnualBookCreateSchema = z.object({
  year: yearSchema,
  editionId: idSchema,
  status: z.enum(CLUB_BOOK_STATUSES).default("planned"),
  note: z.preprocess(emptyToNull, longText(2000).nullable()).default(null),
});
export const clubAnnualBookUpdateSchema = z.object({
  status: z.enum(CLUB_BOOK_STATUSES),
  note: z.preprocess(emptyToNull, longText(2000).nullable()).default(null),
  expectedVersion: z.number().int().min(1),
});
export const clubAnnualReorderSchema = z.object({
  year: yearSchema,
  orderedIds: z.array(idSchema).max(500),
});

export const meetingSchema = z
  .object({
    title: plainText(200, 1),
    startsAt: isoDateTime,
    endsAt: z.preprocess(emptyToNull, isoDateTime.nullable()).default(null),
    location: z.preprocess(emptyToNull, plainText(300).nullable()).default(null),
    details: z.preprocess(emptyToNull, longText(5000).nullable()).default(null),
    editionId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  })
  .refine((d) => !d.endsAt || d.endsAt > d.startsAt, { path: ["endsAt"], message: "End must be after start" });
export type MeetingInput = z.input<typeof meetingSchema>;
export const meetingUpdateSchema = meetingSchema.and(versionSchema);

export const assignmentSchema = z.object({
  editionId: idSchema,
  meetingId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  dueDate: dateOnly,
  readingScope: z.preprocess(emptyToNull, plainText(300).nullable()).default(null),
  details: z.preprocess(emptyToNull, longText(5000).nullable()).default(null),
});
export type AssignmentInput = z.input<typeof assignmentSchema>;
export const assignmentUpdateSchema = assignmentSchema.extend({ expectedVersion: z.number().int().min(1) });

export const genreSchema = z.object({ name: plainText(60, 1) });
export const genreUpdateSchema = genreSchema.extend({ expectedVersion: z.number().int().min(1) });

export const activitySchema = z.object({
  title: plainText(200, 1),
  kind: z.enum(CLUB_ACTIVITY_KINDS).default("other"),
  details: z.preprocess(emptyToNull, longText(5000).nullable()).default(null),
  startsAt: z.preprocess(emptyToNull, isoDateTime.nullable()).default(null),
});
export type ActivityInput = z.input<typeof activitySchema>;
export const activityUpdateSchema = activitySchema.extend({ expectedVersion: z.number().int().min(1) });

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export const messageSchema = z.object({ body: longText(LIMITS.messageMax, 1) });
export const directConversationSchema = z.object({ userId: idSchema });

// ---------------------------------------------------------------------------
// Public sharing
// ---------------------------------------------------------------------------

export const shareCreateSchema = z.object({
  resourceType: z.enum(SHARE_RESOURCE_TYPES),
  /** review/quote id; ignored for list types. */
  resourceId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  /** Year for club_list / optional filter for reading_list. */
  year: z.preprocess(emptyToNull, yearSchema.nullable()).default(null),
  /** Status filter for reading_list. */
  status: z.preprocess(emptyToNull, z.enum(READING_STATUSES).nullable()).default(null),
  expiresInDays: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(365).nullable()).default(null),
});
export type ShareCreateInput = z.input<typeof shareCreateSchema>;

// ---------------------------------------------------------------------------
// Goodreads import
// ---------------------------------------------------------------------------

export const importRowSchema = z.object({
  goodreadsId: z.preprocess(emptyToNull, plainText(20).nullable()).default(null),
  title: plainText(300, 1),
  authors: z.array(plainText(150, 1)).min(1).max(20),
  isbn13: z.preprocess(emptyToNull, z.string().regex(/^\d{13}$/).nullable()).default(null),
  isbn10: z.preprocess(emptyToNull, z.string().regex(/^\d{9}[\dX]$/).nullable()).default(null),
  publisher: z.preprocess(emptyToNull, plainText(200).nullable()).default(null),
  publishedYear: z.preprocess(emptyToNull, z.number().int().min(0).max(2200).nullable()).default(null),
  pageCount: z.preprocess(emptyToNull, z.number().int().min(1).max(50_000).nullable()).default(null),
  format: z.enum(BOOK_FORMATS).default("unknown"),
  status: z.enum(READING_STATUSES),
  dateAdded: z.preprocess(emptyToNull, dateOnly.nullable()).default(null),
  dateRead: z.preprocess(emptyToNull, dateOnly.nullable()).default(null),
  sentiment: z.preprocess(emptyToNull, z.enum(SENTIMENTS).nullable()).default(null),
  review: z.preprocess(emptyToNull, longText(LIMITS.reviewMax).nullable()).default(null),
  containsSpoilers: z.boolean().default(false),
  privateNotes: z.preprocess(emptyToNull, longText(LIMITS.notesMax).nullable()).default(null),
  shelves: z.array(plainText(80)).max(50).default([]),
});
export type ImportRow = z.output<typeof importRowSchema>;

export const importBatchSchema = z.object({
  importId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  visibility: z.enum(VISIBILITIES).default("club"),
  importReviews: z.boolean().default(true),
  rows: z.array(importRowSchema).min(1).max(LIMITS.importRowsPerBatch),
  totalRows: z.number().int().min(1).max(20_000),
  isFinalBatch: z.boolean().default(false),
});
