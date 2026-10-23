import type { Context } from "hono";
import { LIMITS } from "../../shared/constants";
import { pageQuerySchema } from "../../shared/schemas";
import type { Page } from "../../shared/types";
import type { AppEnv } from "../env";
import { parseWith } from "./http";

export interface PageQuery {
  cursor: string | null;
  limit: number;
}

/** Parse `?cursor=&limit=` (pageQuerySchema) with the default page size. */
export function pageQuery(c: Context<AppEnv>, defaultLimit: number = LIMITS.pageSize): PageQuery {
  const q = parseWith(pageQuerySchema, { cursor: c.req.query("cursor"), limit: c.req.query("limit") });
  return { cursor: q.cursor, limit: q.limit ?? defaultLimit };
}

/**
 * Build a page from `limit + 1` rows fetched in cursor order. `cursorOf` returns
 * the value the client sends back to continue after the last item of this page.
 */
export function makePage<T>(rows: T[], limit: number, cursorOf: (item: T) => string): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? cursorOf(last) : null };
}

/** Cursors are timestamps (ISO-8601) in this API; reject anything else. */
export function timeCursor(cursor: string | null): string | null {
  if (!cursor) return null;
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(cursor) || Number.isNaN(Date.parse(cursor))) return null;
  return cursor;
}
