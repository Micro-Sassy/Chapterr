// Feature wave 2 schemas owned by files/branding/screening/push/streaks/challenges (W3/F3). Re-exported from shared/schemas.ts.
import { z } from "zod";
import { CHALLENGE_KINDS, FILE_KINDS, JOIN_POLICIES, WAVE2_LIMITS } from "./constants";
import { dateOnly, emptyToNull, idSchema, longText, plainText } from "./schemas";

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1E3A2F");

export const fileKindSchema = z.enum(FILE_KINDS);

export const screeningQuestionSchema = z.object({ id: z.string().max(40).optional(), label: plainText(200, 1), required: z.boolean().default(true) });
export const clubSettingsSchema = z.object({
  welcomeMessage: z.preprocess(emptyToNull, longText(WAVE2_LIMITS.welcomeMessageMax).nullable()).default(null),
  joinPolicy: z.enum(JOIN_POLICIES).default("link"),
  screeningQuestions: z.array(screeningQuestionSchema).max(WAVE2_LIMITS.screeningQuestionsMax).default([]),
  timezone: plainText(64, 1).default("America/Chicago"),
  reminderOffsets: z.array(z.number().int().min(15).max(60 * 24 * 14)).max(4).default([1440, 120]),
  rolesRotation: z.object({ host: z.boolean(), picker: z.boolean(), notetaker: z.boolean() }).default({ host: true, picker: true, notetaker: true }),
  discordWebhookUrl: z.preprocess(emptyToNull, z.string().url().startsWith("https://discord.com/api/webhooks/").nullable()).optional(),
  expectedVersion: z.number().int().min(1),
});
export const brandingSchema = z.object({
  accentColor: z.preprocess(emptyToNull, hexColor.nullable()).default(null),
  bannerFileId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  expectedVersion: z.number().int().min(1),
});

export const joinAnswersSchema = z.object({
  code: z.string().min(1),
  answers: z.array(z.object({ questionId: z.string().max(40), answer: plainText(500) })).max(WAVE2_LIMITS.screeningQuestionsMax).default([]),
  message: z.preprocess(emptyToNull, plainText(500).nullable()).default(null),
});
export const joinDecisionSchema = z.object({ note: z.preprocess(emptyToNull, plainText(300).nullable()).default(null) });

export const bulkInviteSchema = z.object({ csv: z.string().max(200_000), expiresInDays: z.coerce.number().int().min(1).max(90).default(14) });

export const phoneSchema = z.object({
  phone: z.preprocess(emptyToNull, z.string().regex(/^\+[1-9]\d{6,14}$/, "Use international format, e.g. +12145551234").nullable()).default(null),
  smsOptIn: z.boolean().default(false),
});

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
  userAgent: z.preprocess(emptyToNull, plainText(200).nullable()).default(null),
});
export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) });

export const readingLogSchema = z.object({
  pages: z.coerce.number().int().min(0).max(5000).default(0),
  minutes: z.coerce.number().int().min(0).max(1440).default(0),
  editionId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  note: z.preprocess(emptyToNull, plainText(300).nullable()).default(null),
});

export const challengeSchema = z
  .object({
    title: plainText(120, 1),
    description: z.preprocess(emptyToNull, longText(2000).nullable()).default(null),
    kind: z.enum(CHALLENGE_KINDS),
    target: z.coerce.number().int().min(1).max(100_000),
    genreId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
    startsOn: dateOnly,
    endsOn: dateOnly,
  })
  .refine((d) => d.startsOn <= d.endsOn, { path: ["endsOn"], message: "End after start" });
export type ChallengeInput = z.input<typeof challengeSchema>;
export const challengeUpdateSchema = challengeSchema.and(z.object({ expectedVersion: z.number().int().min(1) }));
export const challengeProgressSchema = z.object({ progress: z.coerce.number().int().min(0).max(100_000) });

export const bridgeSchema = z.object({ kind: z.enum(["meeting", "poll", "assignment"]), id: idSchema });
