import { Hono } from "hono";
import { READING_STATUSES, type ClubRole } from "../../shared/constants";
import type { MemberProfile } from "../../shared/types";
import type { AppEnv } from "../env";
import { sharesClubWith } from "../lib/club";
import { all, first } from "../lib/db";
import { badRequest, notFound } from "../lib/errors";
import { loadQuotes, loadReviews, loadUserBooks } from "../lib/loaders";
import { mapMember, memberCols, type Row } from "../lib/mappers";
import { currentYear } from "../lib/util";
import { personalGoal } from "./personal";

/**
 * Member profiles. There is no global member directory: members are listed
 * per club (/api/clubs/:clubId/members). A profile is visible only to members
 * who share at least one club with its owner; everyone else gets 404, so
 * usernames cannot be probed across clubs.
 */
export const memberRoutes = new Hono<AppEnv>();

async function findMember(db: D1Database, viewerId: string, username: string): Promise<Row> {
  const row = await first<Row>(
    db,
    `SELECT ${memberCols("u", "m_")}, u."createdAt" AS joined_at, p.bio, p.location, p.pronouns, p.favorite_genres
     FROM "user" u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.username = ? COLLATE NOCASE AND u."emailVerified" = 1`,
    username.toLowerCase(),
  );
  if (!row || !(await sharesClubWith(db, viewerId, String(row.m_id)))) throw notFound("Member not found");
  return row;
}

memberRoutes.get("/:username", async (c) => {
  const viewer = c.get("user");
  const row = await findMember(c.env.DB, viewer.id, c.req.param("username"));
  const memberId = String(row.m_id);
  const year = currentYear();
  const own = memberId === viewer.id;
  const vis = own ? "" : " AND visibility = 'club'";
  const [counts, finishedThisYear, reviews, quotes, goal, shared] = await Promise.all([
    all<{ status: string; n: number }>(c.env.DB, `SELECT status, COUNT(*) AS n FROM user_books WHERE user_id = ?${vis} GROUP BY status`, memberId),
    first<{ n: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND status = 'finished' AND substr(finished_at, 1, 4) = ?${vis}`,
      memberId,
      String(year),
    ),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?${vis}`, memberId),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM quotes WHERE user_id = ?${vis}`, memberId),
    personalGoal(c.env.DB, memberId, year),
    all<{ id: string; name: string; role: ClubRole }>(
      c.env.DB,
      `SELECT c.id, c.name, b.role FROM club_members a
         JOIN club_members b ON b.club_id = a.club_id AND b.user_id = ?
         JOIN clubs c ON c.id = a.club_id AND c.archived_at IS NULL
        WHERE a.user_id = ? ORDER BY c.name COLLATE NOCASE`,
      memberId,
      viewer.id,
    ),
  ]);
  const byStatus = Object.fromEntries(counts.map((r) => [r.status, Number(r.n)]));
  const profile: MemberProfile = {
    ...mapMember(row, "m_"),
    profile: {
      bio: (row.bio as string | null) ?? null,
      location: (row.location as string | null) ?? null,
      pronouns: (row.pronouns as string | null) ?? null,
      favoriteGenres: (row.favorite_genres as string | null) ?? null,
    },
    joinedAt: String(row.joined_at),
    sharedClubs: shared.map((s) => ({ id: s.id, name: s.name, role: s.role })),
    stats: {
      finishedThisYear: Number(finishedThisYear?.n ?? 0),
      reading: byStatus.reading ?? 0,
      tbr: byStatus.tbr ?? 0,
      reviews: Number(reviews?.n ?? 0),
      quotes: Number(quotes?.n ?? 0),
    },
    goal: own ? goal : { ...goal, completed: Number(finishedThisYear?.n ?? 0) },
  };
  return c.json(profile);
});

memberRoutes.get("/:username/books", async (c) => {
  const viewer = c.get("user");
  const row = await findMember(c.env.DB, viewer.id, c.req.param("username"));
  const status = c.req.query("status");
  if (status && !(READING_STATUSES as readonly string[]).includes(status)) throw badRequest("Invalid status");
  const books = await loadUserBooks(
    c.env.DB,
    viewer.id,
    status ? "ub.user_id = ? AND ub.status = ?" : "ub.user_id = ?",
    status ? [String(row.m_id), status] : [String(row.m_id)],
    { limit: 1000 },
  );
  return c.json(books);
});

memberRoutes.get("/:username/reviews", async (c) => {
  const viewer = c.get("user");
  const row = await findMember(c.env.DB, viewer.id, c.req.param("username"));
  return c.json(await loadReviews(c.env.DB, viewer.id, "r.user_id = ?", [String(row.m_id)], { limit: 200 }));
});

memberRoutes.get("/:username/quotes", async (c) => {
  const viewer = c.get("user");
  const row = await findMember(c.env.DB, viewer.id, c.req.param("username"));
  return c.json(await loadQuotes(c.env.DB, viewer.id, "q.user_id = ?", [String(row.m_id)], 200));
});
