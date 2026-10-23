import { Hono } from "hono";
import { dateOnly, readingLogQuerySchema, readingLogSchema } from "../../shared/schemas";
import type { ReadingLogEntry, Streak } from "../../shared/types";
import type { AppEnv } from "../env";
import { all, first, run } from "../lib/db";
import { badRequest, notFound } from "../lib/errors";
import { parseBody, parseWith } from "../lib/http";
import { editionCols, mapEditionOrNull, type Row } from "../lib/mappers";
import { invalidateRecaps } from "../lib/recaps";
import { addDays, loadStreak, memberToday } from "../lib/streaks";
import { nowIso } from "../lib/util";

/**
 * Personal daily reading log and streaks (/api/reading-log). Days are the
 * member's local calendar dates; the client sends `?today=YYYY-MM-DD` so a
 * late-night entry lands on the right day when no profile zone is set.
 */
export const readingLogRoutes = new Hono<AppEnv>();

const ENTRY_SELECT = `SELECT l.day, l.pages, l.minutes, l.note, ${editionCols("e", "e_")}
  FROM reading_log l LEFT JOIN book_editions e ON e.id = l.edition_id`;

function mapEntry(r: Row): ReadingLogEntry {
  return {
    day: String(r.day),
    pages: Number(r.pages ?? 0),
    minutes: Number(r.minutes ?? 0),
    edition: mapEditionOrNull(r, "e_"),
    note: (r.note as string | null) ?? null,
  };
}

readingLogRoutes.get("/", async (c) => {
  const user = c.get("user");
  const q = parseWith(readingLogQuerySchema, { from: c.req.query("from"), to: c.req.query("to") });
  const today = await memberToday(c.env.DB, user.id, c.req.query("today"));
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -89);
  const rows = await all<Row>(c.env.DB, `${ENTRY_SELECT} WHERE l.user_id = ? AND l.day BETWEEN ? AND ? ORDER BY l.day DESC LIMIT 400`, user.id, from, to);
  return c.json(rows.map(mapEntry) satisfies ReadingLogEntry[]);
});

readingLogRoutes.get("/streak", async (c) => {
  const user = c.get("user");
  const today = await memberToday(c.env.DB, user.id, c.req.query("today"));
  return c.json((await loadStreak(c.env.DB, user.id, today)) satisfies Streak);
});

/** Set (replace) a day's entry. Pages and minutes are totals for that day. */
readingLogRoutes.put("/:day", async (c) => {
  const user = c.get("user");
  const day = parseWith(dateOnly, c.req.param("day"));
  const today = await memberToday(c.env.DB, user.id, c.req.query("today"));
  if (day > addDays(today, 1)) throw badRequest("You cannot log reading in the future", { day: ["Future date"] });
  if (day < "2000-01-01") throw badRequest("That date is too far back", { day: ["Too early"] });
  const input = await parseBody(c, readingLogSchema);
  if (input.editionId) {
    const edition = await first(c.env.DB, "SELECT 1 FROM book_editions WHERE id = ?", input.editionId);
    if (!edition) throw notFound("Book not found");
  }
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO reading_log (user_id, day, edition_id, pages, minutes, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, day) DO UPDATE SET edition_id = excluded.edition_id, pages = excluded.pages, minutes = excluded.minutes,
       note = excluded.note, updated_at = excluded.updated_at`,
    user.id,
    day,
    input.editionId,
    input.pages,
    input.minutes,
    input.note,
    now,
    now,
  );
  c.executionCtx.waitUntil(invalidateRecaps(c.env, `user:${user.id}`));
  const [row, streak] = await Promise.all([
    first<Row>(c.env.DB, `${ENTRY_SELECT} WHERE l.user_id = ? AND l.day = ?`, user.id, day),
    loadStreak(c.env.DB, user.id, today),
  ]);
  return c.json({ entry: mapEntry(row!), streak } satisfies { entry: ReadingLogEntry; streak: Streak });
});

readingLogRoutes.delete("/:day", async (c) => {
  const user = c.get("user");
  const day = parseWith(dateOnly, c.req.param("day"));
  const res = await run(c.env.DB, "DELETE FROM reading_log WHERE user_id = ? AND day = ?", user.id, day);
  if (res.meta.changes === 0) throw notFound("No entry for that day");
  c.executionCtx.waitUntil(invalidateRecaps(c.env, `user:${user.id}`));
  const today = await memberToday(c.env.DB, user.id, c.req.query("today"));
  return c.json({ ok: true, streak: await loadStreak(c.env.DB, user.id, today) });
});
