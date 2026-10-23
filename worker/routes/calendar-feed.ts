import type { Context } from "hono";
import type { AppEnv } from "../env";

/** Feature wave 2 (W1): public per-member .ics feed, GET /api/public/calendar/:token.ics. See docs/FEATURES-2.md. */
export async function calendarFeed(c: Context<AppEnv>): Promise<Response> {
  return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
}
