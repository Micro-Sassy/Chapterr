import { Hono } from "hono";
import { SENTIMENT_LABELS, type Sentiment } from "../../shared/constants";
import type { ActivityItem, ClubCard, ClubDashboard, HomeData, Page } from "../../shared/types";
import type { AppEnv } from "../env";
import { visibleInClubSql } from "../lib/club";
import { all, first } from "../lib/db";
import { badRequest } from "../lib/errors";
import { loadUserBooks } from "../lib/loaders";
import { editionCols, mapEdition, mapMember, memberCols, type Row } from "../lib/mappers";
import { makePage, pageQuery, timeCursor } from "../lib/paging";
import { currentYear, localToday } from "../lib/util";
import { loadAssignments, loadClubGoal, loadCurrentBooks, loadMeetings } from "./club";
import { loadClub, loadClubSummaries } from "./clubs";
import { unreadByClub, unreadInClub } from "./messages";
import { personalGoal } from "./personal";

/** `homeRoutes` is mounted at /api (GET /home); `clubHomeRoutes` under /api/clubs/:clubId (dashboard, activity). */
export const homeRoutes = new Hono<AppEnv>();
export const clubHomeRoutes = new Hono<AppEnv>();

/**
 * One club's activity feed, merged from several tables. Personal items appear
 * only when their owner is a member of the club and they are club-visible (or
 * belong to the viewer). `before` restricts every source to older items, so
 * the merged feed pages by timestamp.
 */
export async function loadActivity(db: D1Database, clubId: string, viewerId: string, limit: number, before: string | null = null): Promise<ActivityItem[]> {
  const per = Math.min(limit + 1, 60);
  const M = memberCols("u", "m_");
  const E = editionCols("e", "e_");
  const olderThan = (col: string) => (before ? `AND ${col} < ?` : "");
  const cursorParams = before ? [before] : [];
  const [books, reviews, quotes, recs, clubBooks, meetings, assignments] = await Promise.all([
    all<Row>(
      db,
      `SELECT ub.id, ub.status, ub.updated_at AS at, ${M}, ${E} FROM user_books ub JOIN "user" u ON u.id = ub.user_id
       JOIN book_editions e ON e.id = ub.edition_id
       WHERE ub.status IN ('reading', 'finished') AND ${visibleInClubSql("ub")} ${olderThan("ub.updated_at")} ORDER BY ub.updated_at DESC LIMIT ?`,
      clubId,
      viewerId,
      ...cursorParams,
      per,
    ),
    all<Row>(
      db,
      `SELECT r.id, r.sentiment, r.created_at AS at, ${M}, ${E} FROM reviews r JOIN "user" u ON u.id = r.user_id
       JOIN book_editions e ON e.id = r.edition_id WHERE ${visibleInClubSql("r")} ${olderThan("r.created_at")} ORDER BY r.created_at DESC LIMIT ?`,
      clubId,
      viewerId,
      ...cursorParams,
      per,
    ),
    all<Row>(
      db,
      `SELECT q.id, q.created_at AS at, ${M}, ${E} FROM quotes q JOIN "user" u ON u.id = q.user_id
       JOIN book_editions e ON e.id = q.edition_id WHERE ${visibleInClubSql("q")} ${olderThan("q.created_at")} ORDER BY q.created_at DESC LIMIT ?`,
      clubId,
      viewerId,
      ...cursorParams,
      per,
    ),
    all<Row>(
      db,
      `SELECT r.id, r.created_at AS at, ${M}, ${E} FROM recommendations r JOIN "user" u ON u.id = r.user_id
       JOIN book_editions e ON e.id = r.edition_id WHERE r.club_id = ? AND r.recipient_user_id IS NULL ${olderThan("r.created_at")} ORDER BY r.created_at DESC LIMIT ?`,
      clubId,
      ...cursorParams,
      per,
    ),
    all<Row>(
      db,
      `SELECT b.id, b.year, b.created_at AS at, ${M}, ${E} FROM club_annual_books b JOIN "user" u ON u.id = b.created_by
       JOIN book_editions e ON e.id = b.edition_id WHERE b.club_id = ? AND b.archived_at IS NULL ${olderThan("b.created_at")} ORDER BY b.created_at DESC LIMIT ?`,
      clubId,
      ...cursorParams,
      per,
    ),
    all<Row>(
      db,
      `SELECT m.id, m.title, m.created_at AS at, ${M} FROM club_meetings m JOIN "user" u ON u.id = m.created_by
       WHERE m.club_id = ? AND m.archived_at IS NULL ${olderThan("m.created_at")} ORDER BY m.created_at DESC LIMIT ?`,
      clubId,
      ...cursorParams,
      per,
    ),
    all<Row>(
      db,
      `SELECT a.id, a.created_at AS at, ${M}, ${E} FROM club_assignments a JOIN "user" u ON u.id = a.created_by
       JOIN book_editions e ON e.id = a.edition_id WHERE a.club_id = ? AND a.archived_at IS NULL ${olderThan("a.created_at")} ORDER BY a.created_at DESC LIMIT ?`,
      clubId,
      ...cursorParams,
      per,
    ),
  ]);
  const base = `/c/${clubId}`;
  const items: ActivityItem[] = [
    ...books.map((r) => ({
      id: `ub-${r.id}-${r.status}`,
      kind: (r.status === "finished" ? "finished" : "started") as ActivityItem["kind"],
      actor: mapMember(r, "m_"),
      edition: mapEdition(r, "e_"),
      summary: r.status === "finished" ? "finished reading" : "is reading",
      link: `/books/${r.e_id}`,
      createdAt: String(r.at),
    })),
    ...reviews.map((r) => ({
      id: `rv-${r.id}`,
      kind: "review" as const,
      actor: mapMember(r, "m_"),
      edition: mapEdition(r, "e_"),
      summary: `reviewed (${SENTIMENT_LABELS[r.sentiment as Sentiment].toLowerCase()})`,
      link: `/books/${r.e_id}#review-${r.id}`,
      createdAt: String(r.at),
    })),
    ...quotes.map((r) => ({
      id: `qt-${r.id}`,
      kind: "quote" as const,
      actor: mapMember(r, "m_"),
      edition: mapEdition(r, "e_"),
      summary: "saved a quote from",
      link: `/books/${r.e_id}`,
      createdAt: String(r.at),
    })),
    ...recs.map((r) => ({
      id: `rc-${r.id}`,
      kind: "recommendation" as const,
      actor: mapMember(r, "m_"),
      edition: mapEdition(r, "e_"),
      summary: "recommended to the club",
      link: `${base}/recommend`,
      createdAt: String(r.at),
    })),
    ...clubBooks.map((r) => ({
      id: `cb-${r.id}`,
      kind: "club_book" as const,
      actor: mapMember(r, "m_"),
      edition: mapEdition(r, "e_"),
      summary: `added to the ${r.year} club list`,
      link: `${base}/list?year=${r.year}`,
      createdAt: String(r.at),
    })),
    ...meetings.map((r) => ({
      id: `mt-${r.id}`,
      kind: "meeting" as const,
      actor: mapMember(r, "m_"),
      edition: null,
      summary: `scheduled “${String(r.title)}”`,
      link: `${base}/meetings`,
      createdAt: String(r.at),
    })),
    ...assignments.map((r) => ({
      id: `as-${r.id}`,
      kind: "assignment" as const,
      actor: mapMember(r, "m_"),
      edition: mapEdition(r, "e_"),
      summary: "set a reading assignment for",
      link: base,
      createdAt: String(r.at),
    })),
  ];
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit + 1);
}

// ---------------------------------------------------------------------------
// Home: every club at a glance plus personal reading
// ---------------------------------------------------------------------------

homeRoutes.get("/home", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const year = currentYear();
  const today = localToday(c.req.query("today"));
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const E = editionCols("e", "e_");
  const [clubs, meetings, assignments, currentBooks, unread, personal, reading, unreadNotifications] = await Promise.all([
    loadClubSummaries(db, user.id),
    // Next meeting per club (one row per club).
    all<Row>(
      db,
      `SELECT m.club_id, m.id, m.title, m.starts_at FROM club_meetings m
         JOIN club_members cm ON cm.club_id = m.club_id AND cm.user_id = ?
        WHERE m.archived_at IS NULL AND m.starts_at >= ?
          AND m.id = (SELECT x.id FROM club_meetings x WHERE x.club_id = m.club_id AND x.archived_at IS NULL AND x.starts_at >= ? ORDER BY x.starts_at, x.id LIMIT 1)`,
      user.id,
      since,
      since,
    ),
    // Soonest open assignment per club.
    all<Row>(
      db,
      `SELECT a.club_id, a.id, a.due_date, ${E} FROM club_assignments a JOIN book_editions e ON e.id = a.edition_id
         JOIN club_members cm ON cm.club_id = a.club_id AND cm.user_id = ?
        WHERE a.archived_at IS NULL AND a.due_date >= ?
          AND a.id = (SELECT x.id FROM club_assignments x WHERE x.club_id = a.club_id AND x.archived_at IS NULL AND x.due_date >= ? ORDER BY x.due_date, x.id LIMIT 1)`,
      user.id,
      today,
      today,
    ),
    // The book each club is currently reading.
    all<Row>(
      db,
      `SELECT b.club_id, ${E} FROM club_annual_books b JOIN book_editions e ON e.id = b.edition_id
         JOIN club_members cm ON cm.club_id = b.club_id AND cm.user_id = ?
        WHERE b.archived_at IS NULL AND b.status = 'current'
          AND b.id = (SELECT x.id FROM club_annual_books x WHERE x.club_id = b.club_id AND x.archived_at IS NULL AND x.status = 'current' ORDER BY x.year DESC, x.position, x.id LIMIT 1)`,
      user.id,
    ),
    unreadByClub(db, user.id),
    personalGoal(db, user.id, year),
    loadUserBooks(db, user.id, "ub.user_id = ? AND ub.status = 'reading'", [user.id], { limit: 12 }),
    first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL AND created_at <= ?", user.id, now),
  ]);
  const meetingBy = new Map(meetings.map((r) => [String(r.club_id), r]));
  const assignmentBy = new Map(assignments.map((r) => [String(r.club_id), r]));
  const bookBy = new Map(currentBooks.map((r) => [String(r.club_id), r]));
  const cards: ClubCard[] = clubs.map((club) => {
    const m = meetingBy.get(club.id);
    const a = assignmentBy.get(club.id);
    const b = bookBy.get(club.id);
    return {
      ...club,
      nextMeeting: m ? { id: String(m.id), title: String(m.title), startsAt: String(m.starts_at) } : null,
      currentAssignment: a ? { id: String(a.id), dueDate: String(a.due_date), edition: mapEdition(a, "e_") } : null,
      currentBook: b ? mapEdition(b, "e_") : null,
      unreadMessages: unread.get(club.id) ?? 0,
    };
  });
  const data: HomeData = {
    clubs: cards,
    personalGoal: personal,
    currentlyReading: reading,
    unreadNotifications: Number(unreadNotifications?.n ?? 0),
  };
  return c.json(data);
});

// ---------------------------------------------------------------------------
// Club dashboard and activity feed
// ---------------------------------------------------------------------------

clubHomeRoutes.get("/dashboard", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const db = c.env.DB;
  const year = currentYear();
  const today = localToday(c.req.query("today"));
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const [club, clubGoal, clubDone, meetings, assignments, currentBooks, activity, unreadMessages] = await Promise.all([
    loadClub(db, clubId, user.id),
    loadClubGoal(db, clubId, year),
    first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM club_annual_books WHERE club_id = ? AND year = ? AND status = 'completed' AND archived_at IS NULL", clubId, year),
    loadMeetings(db, clubId, "m.archived_at IS NULL AND m.starts_at >= ?", [since], "m.starts_at", 1),
    loadAssignments(db, clubId, "a.archived_at IS NULL AND a.due_date >= ?", [today], "a.due_date", 5),
    loadCurrentBooks(db, clubId),
    loadActivity(db, clubId, user.id, 20),
    unreadInClub(db, clubId, user.id),
  ]);
  if (!club) throw badRequest("Club not found");
  const data: ClubDashboard = {
    club,
    clubGoal,
    clubCompleted: Number(clubDone?.n ?? 0),
    nextMeeting: meetings[0] ?? null,
    currentAssignments: assignments,
    currentBooks,
    activity: activity.slice(0, 20),
    unreadMessages,
    memberCount: club.memberCount,
  };
  return c.json(data);
});

clubHomeRoutes.get("/activity", async (c) => {
  const { cursor, limit } = pageQuery(c);
  if (cursor && !timeCursor(cursor)) throw badRequest("Invalid cursor");
  const items = await loadActivity(c.env.DB, c.get("club").id, c.get("user").id, limit, cursor);
  const page: Page<ActivityItem> = makePage(items, limit, (i) => i.createdAt);
  return c.json(page);
});
