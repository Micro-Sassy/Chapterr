// Feature wave 2 schemas owned by meetings/calendar/polls/pace (W1/F1). Re-exported from shared/schemas.ts.
import { z } from "zod";
import { MEETING_ROLES, PACE_CADENCES, POLL_KINDS, RECURRENCE_FREQS, RSVP_STATUSES, SIGNUP_KINDS, WAVE2_LIMITS } from "./constants";
import { dateOnly, emptyToNull, idSchema, isoDateTime, longText, plainText, yearSchema } from "./schemas";

export const recurrenceSchema = z.object({
  freq: z.enum(RECURRENCE_FREQS),
  interval: z.coerce.number().int().min(1).max(12).optional(),
  byDay: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  byMonthDay: z.number().int().min(1).max(31).optional(),
  nthWeekday: z.object({ n: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(-1)]), day: z.number().int().min(0).max(6) }).optional(),
  until: z.preprocess(emptyToNull, dateOnly.nullable()).default(null),
  count: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(WAVE2_LIMITS.recurrenceOccurrencesMax).nullable()).default(null),
});
export type RecurrenceInput = z.input<typeof recurrenceSchema>;

export const rsvpSchema = z.object({
  status: z.enum(RSVP_STATUSES),
  guests: z.coerce.number().int().min(0).max(10).default(0),
  note: z.preprocess(emptyToNull, plainText(200).nullable()).default(null),
});

export const attendanceSchema = z.object({ userIds: z.array(idSchema).max(500) });

export const meetingRolesSchema = z.object({
  host: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  picker: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  notetaker: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
});
export const meetingRoleSchema = z.enum(MEETING_ROLES);

export const meetingNotesSchema = z.object({
  notes: z.preprocess(emptyToNull, longText(WAVE2_LIMITS.notesMax).nullable()).default(null),
  expectedVersion: z.number().int().min(1),
});

export const meetingCopySchema = z.object({
  startsAt: isoDateTime,
  keep: z.object({ book: z.boolean().default(true), location: z.boolean().default(true), details: z.boolean().default(true), signups: z.boolean().default(true) }).default({ book: true, location: true, details: true, signups: true }),
});

export const signupListSchema = z.object({ title: plainText(120, 1), kind: z.enum(SIGNUP_KINDS).default("potluck") });
export const signupItemSchema = z.object({ label: plainText(120, 1), quantity: z.coerce.number().int().min(1).max(100).default(1) });
export const signupClaimSchema = z.object({ note: z.preprocess(emptyToNull, plainText(200).nullable()).default(null) });

export const pollOptionInputSchema = z.object({
  label: plainText(WAVE2_LIMITS.pollTitleMax, 1),
  editionId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  startsAt: z.preprocess(emptyToNull, isoDateTime.nullable()).default(null),
  endsAt: z.preprocess(emptyToNull, isoDateTime.nullable()).default(null),
});
export const pollCreateSchema = z.object({
  kind: z.enum(POLL_KINDS),
  title: plainText(WAVE2_LIMITS.pollTitleMax, 1),
  description: z.preprocess(emptyToNull, longText(2000).nullable()).default(null),
  options: z.array(pollOptionInputSchema).min(2).max(WAVE2_LIMITS.pollOptionsMax),
  allowMultiple: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  allowMemberOptions: z.boolean().default(true),
  closesAt: z.preprocess(emptyToNull, isoDateTime.nullable()).default(null),
  year: z.preprocess(emptyToNull, yearSchema.nullable()).default(null),
  meetingId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
});
export type PollCreateInput = z.input<typeof pollCreateSchema>;
export const pollVoteSchema = z.object({ optionIds: z.array(idSchema).max(WAVE2_LIMITS.pollOptionsMax) });

export const pacePlanSchema = z.object({
  editionId: idSchema,
  meetingId: z.preprocess(emptyToNull, idSchema.nullable()).default(null),
  startsOn: dateOnly,
  endsOn: z.preprocess(emptyToNull, dateOnly.nullable()).default(null),
  totalPages: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(50_000).nullable()).default(null),
  cadence: z.enum(PACE_CADENCES).default("weekly"),
  restDays: z.array(z.number().int().min(0).max(6)).max(6).default([]),
  createAssignments: z.boolean().default(true),
});
export type PacePlanInput = z.input<typeof pacePlanSchema>;

export const editionMappingSchema = z.object({
  kind: z.enum(["kindle", "audio"]),
  total: z.coerce.number().int().min(1).max(10_000_000),
  label: z.preprocess(emptyToNull, plainText(120).nullable()).default(null),
});
