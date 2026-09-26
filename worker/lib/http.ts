import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { ApiError, badRequest } from "./errors";

export function validationError(error: z.ZodError): ApiError {
  const flat = z.flattenError(error);
  const fields: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(flat.fieldErrors as Record<string, string[] | undefined>)) {
    if (v && v.length) fields[k] = v;
  }
  if (flat.formErrors.length) fields._form = flat.formErrors;
  const first = Object.values(fields)[0]?.[0];
  return new ApiError(422, "validation_error", first ?? "Please check the highlighted fields", { fields });
}

export async function parseBody<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function queryInt(c: Context<AppEnv>, name: string, fallback: number, min: number, max: number): number {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`Invalid ${name}`);
  return n;
}
