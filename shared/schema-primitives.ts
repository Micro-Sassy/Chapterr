import { z } from "zod";

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

