// Feature wave 2 schemas owned by chat/rooms/guides (W2/F2). Re-exported from shared/schemas.ts.
import { z } from "zod";
import { GATE_TYPES, LIMITS, MESSAGE_EMOJI, ROOM_KINDS, WAVE2_LIMITS } from "./constants";
import { emptyToNull, idSchema, isoDateTime, longText, plainText } from "./schema-primitives";

export const messageCreateSchema = z.object({
  body: longText(LIMITS.messageMax, 0).default(""),
  parentId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  attachmentFileIds: z.array(idSchema).max(WAVE2_LIMITS.attachmentsPerMessage).default([]),
}).refine((d) => d.body.trim().length > 0 || d.attachmentFileIds.length > 0, { path: ["body"], message: "Write something or attach a photo" });
export type MessageCreateInput = z.input<typeof messageCreateSchema>;

export const reactionToggleSchema = z.object({ emoji: z.enum(MESSAGE_EMOJI) });

export const scheduledMessageSchema = z.object({
  conversationId: idSchema,
  body: longText(LIMITS.messageMax, 1),
  sendAt: isoDateTime,
});

export const roomSchema = z.object({
  kind: z.enum(ROOM_KINDS),
  title: plainText(120, 1),
  gateType: z.enum(GATE_TYPES).default("none"),
  gateValue: z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(100_000).nullable()).default(null),
});
export const roomsAutoSchema = z.object({ chapters: z.coerce.number().int().min(1).max(WAVE2_LIMITS.roomsPerBookMax - 1), reflection: z.boolean().default(true) });

export const progressSchema = z.object({
  chapter: z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(10_000).nullable()).default(null),
  page: z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(50_000).nullable()).default(null),
  percent: z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(100).nullable()).default(null),
  finished: z.boolean().default(false),
});

export const guideQuestionSchema = z.object({ id: z.string().max(40).optional(), text: plainText(500, 1), roomId: z.preprocess(emptyToNull, idSchema.nullable()).default(null) });
export const guideSchema = z.object({
  sections: z.array(z.object({ title: plainText(120, 1), questions: z.array(guideQuestionSchema).max(WAVE2_LIMITS.guideQuestionsMax) })).max(10),
  expectedVersion: z.number().int().min(1).optional(),
});
export const guideGenerateSchema = z.object({ source: z.enum(["template", "ai"]), chapters: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(200).nullable()).default(null) });

/** Scheduled sends must be at least 2 minutes out and at most 90 days out (checked server-side against the clock). */
export const SCHEDULED_MIN_LEAD_MS = 2 * 60_000;
export const SCHEDULED_MAX_LEAD_MS = 90 * 86_400_000;

/** Usernames are [a-z0-9_]; a mention is `@username` not glued to a preceding word character. */
export const MENTION_PATTERN = /(^|[^A-Za-z0-9_])@([A-Za-z0-9][A-Za-z0-9_]{1,29})/g;
