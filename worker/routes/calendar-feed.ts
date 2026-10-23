import type { Context } from "hono";
import type { AppEnv } from "../env";
import { first } from "../lib/db";
import { buildIcs, type IcsEvent } from "../lib/ics";
import { editionCols, mapEdition, type Row } from "../lib/mappers";
import { safeZone } from "../lib/recurrence";
import { timingSafeEqual } from "../lib/util";
import { all } from "../lib/db";
import { appOrigin, calendarTokenMac, fromBase64Url, loadMeetings, meetingToIcsEvent } from "./meetings";

const DAY_MS = 86_400_000;

/**
 * Feature wave 2 (W1): public per-member .ics feed, GET /api/public/calendar/:token(.ics).
 * The token is base64url("userId:clubId:HMAC") from GET /api/clubs/:clubId/calendar/feed-url.
 * It keeps working only while the member belongs to the club; anything else is a 404.
 */
export async function calendarFeed(c: Context<AppEnv>): Promise<Response> {
  const notFound = () => c.json({ error: { code: "not_found", message: "Not found" } }, 404);
  const raw = (c.req.param("token") ?? "").replace(/\.ics$/i, "");
  const decoded = fromBase64Url(raw);
  if (!decoded) return notFound();
  const parts = decoded.split(":");
  if (parts.length !== 3) return notFound();
  const [userId, clubId, mac] = parts as [string, string, string];
  const expected = await calendarTokenMac(c.env.BETTER_AUTH_SECRET, userId, clubId);
  if (!timingSafeEqual(new TextEncoder().encode(mac), new TextEncoder().encode(expected))) return notFound();
  const club = await first<{ id: string; name: string; timezone: string }>(
    c.env.DB,
    `SELECT c.id, c.name, c.timezone FROM clubs c JOIN club_members m ON m.club_id = c.id AND m.user_id = ? WHERE c.id = ? AND c.archived_at IS NULL`,
    userId,
    clubId,
  );
  if (!club) return notFound();

  const since = new Date(Date.now() - 90 * DAY_MS);
  const origin = appOrigin(c.env.PUBLIC_APP_URL);
  const [meetings, assignments] = await Promise.all([
    loadMeetings(c.env.DB, clubId, "m.archived_at IS NULL AND m.starts_at >= ?", [since.toISOString()], "m.starts_at", 500, userId),
    all<Row>(
      c.env.DB,
      `SELECT a.id, a.due_date, a.reading_scope, a.updated_at, a.created_at, ${editionCols("e", "e_")} FROM club_assignments a JOIN book_editions e ON e.id = a.edition_id
        WHERE a.club_id = ? AND a.archived_at IS NULL AND a.due_date >= ? ORDER BY a.due_date LIMIT 500`,
      clubId,
      since.toISOString().slice(0, 10),
    ),
  ]);
  const events: IcsEvent[] = [
    ...meetings.map((m) => meetingToIcsEvent(m, clubId, origin)),
    ...assignments.map<IcsEvent>((a) => {
      const edition = mapEdition(a, "e_");
      return {
        uid: `assignment-${String(a.id)}@chapterr.io`,
        start: String(a.due_date),
        allDay: true,
        summary: `Read ${edition.title}${a.reading_scope ? `: ${a.reading_scope}` : ""}`,
        description: `${club.name} reading assignment`,
        url: `${origin}/c/${clubId}`,
        createdAt: String(a.created_at),
        updatedAt: String(a.updated_at),
      };
    }),
  ];
  const ics = buildIcs({ name: `${club.name} (Chapterr)`, timezone: safeZone(club.timezone, "America/Chicago"), description: "Meetings and reading assignments", events });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="chapterr-${club.id}.ics"`,
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
