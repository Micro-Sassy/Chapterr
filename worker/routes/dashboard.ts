import { Hono } from "hono";
import { SENTIMENT_LABELS, type Sentiment } from "../../shared/constants";
import type { ActivityItem, DashboardData } from "../../shared/types";
import type { AppEnv } from "../env";
import { all, first } from "../lib/db";
import { queryInt } from "../lib/http";
import { loadUserBooks } from "../lib/loaders";
import { editionCols, mapEdition, mapMember, memberCols, type Row } from "../lib/mappers";
import { currentYear, nowIso } from "../lib/util";
import { loadAssignments, loadClubGoal, loadMeetings } from "./club";
import { totalUnread } from "./messages";
import { personalGoal } from "./personal";

export const dashboardRoutes = new Hono<AppEnv>();

/**
 * Club activity feed, merged from several tables. Personal items only appear
 * when club-visible (or when they belong to the viewer).
 */
export async function loadActivity(db: D1Database, viewerId: string, limit: number): Promise<ActivityItem[]> {
  const per = Math.min(limit, 30);
  const M = memberCols("u", "m_");
  const E = editionCols("e", "e_");
  const [books, reviews, quotes, recs, clubBooks, meetings, assignments] = await Promise.all([
    all<Row>(
      db,
      `SELECT ub.id, ub.status, ub.updated_at AS at, ${M}, ${E} FROM user_books ub JOIN "user" u ON u.id = ub.user_id
       JOIN book_editions e ON e.id = ub.edition_id
       WHERE ub.status IN ('reading', 'finished') AND (ub.visibility = 'club' OR ub.user_id = ?) ORDER BY ub.updated_at DESC LIMIT ?`,
      viewerId,
      per,
    ),
    all<Row>(
      db,
      `SELECT r.id, r.sentiment, r.created_at AS at, ${M}, ${E} FROM reviews r JOIN "user" u ON u.id = r.user_id
       JOIN book_editions e ON e.id = r.edition_id WHERE (r.visibility = 'club' OR r.user_id = ?) ORDER BY r.created_at DESC LIMIT ?`,
      viewerId,
      per,
    ),
    all<Row>(
      db,
      `SELECT q.id, q.created_at AS at, ${M}, ${E} FROM quotes q JOIN "user" u ON u.id = q.user_id
       JOIN book_editions e ON e.id = q.edition_id WHERE (q.visibility = 'club' OR q.user_id = ?) ORDER BY q.created_at DESC LIMIT ?`,
      viewerId,
      per,
    ),
    all<Row>(
      db,
      `SELECT r.id, r.created_at AS at, ${M}, ${E} FROM recommendations r JOIN "user" u ON u.id = r.user_id
       JOIN book_editions e ON e.id = r.edition_id WHERE r.recipient_user_id IS NULL ORDER BY r.created_at DESC LIMIT ?`,
      per,
    ),
    all<Row>(
      db,
      `SELECT b.id, b.year, b.created_at AS at, ${M}, ${E} FROM club_annual_books b JOIN "user" u ON u.id = b.created_by
       JOIN book_editions e ON e.id = b.edition_id WHERE b.archived_at IS NULL ORDER BY b.created_at DESC LIMIT ?`,
      per,
    ),
    all<Row>(
      db,
      `SELECT m.id, m.title, m.created_at AS at, ${M} FROM club_meetings m JOIN "user" u ON u.id = m.created_by
       WHERE m.archived_at IS NULL ORDER BY m.created_at DESC LIMIT ?`,
      per,
    ),
    all<Row>(
      db,
      `SELECT a.id, a.due_date, a.created_at AS at, ${M}, ${E} FROM club_assignments a JOIN "user" u ON u.id = a.created_by
       JOIN book_editions e ON e.id = a.edition_id WHERE a.archived_at IS NULL ORDER BY a.created_at DESC LIMIT ?`,
      per,
    ),
  ]);
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
      link: "/recommendations",
      createdAt: String(r.at),
    })),
    ...clubBooks.map((r) => ({
      id: `cb-${r.id}`,
      kind: "club_book" as const,
      actor: mapMember(r, "m_"),
      edition: mapEdition(r, "e_"),
      summary: `added to the ${r.year} club list`,
      link: `/club?year=${r.year}`,
      createdAt: String(r.at),
    })),
    ...meetings.map((r) => ({
      id: `mt-${r.id}`,
      kind: "meeting" as const,
      actor: mapMember(r, "m_"),
      edition: null,
      summary: `scheduled “${String(r.title)}”`,
      link: "/club/meetings",
      createdAt: String(r.at),
    })),
    ...assignments.map((r) => ({
      id: `as-${r.id}`,
      kind: "assignment" as const,
      actor: mapMember(r, "m_"),
      edition: mapEdition(r, "e_"),
      summary: `set a reading assignment due ${String(r.due_date)} for`,
      link: "/club",
      createdAt: String(r.at),
    })),
  ];
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}

dashboardRoutes.get("/dashboard", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const year = currentYear();
  const today = nowIso().slice(0, 10);
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const [personal, clubGoal, clubDone, reading, meetings, assignments, activity, unreadMessages, unreadNotifications] = await Promise.all([
    personalGoal(db, user.id, year),
    loadClubGoal(db, year),
    first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM club_annual_books WHERE year = ? AND status = 'completed' AND archived_at IS NULL", year),
    loadUserBooks(db, user.id, "ub.user_id = ? AND ub.status = 'reading'", [user.id], { limit: 12 }),
    loadMeetings(db, "m.archived_at IS NULL AND m.starts_at >= ?", [since], "m.starts_at", 1),
    loadAssignments(db, "a.archived_at IS NULL AND a.due_date >= ?", [today], "a.due_date", 5),
    loadActivity(db, user.id, 20),
    totalUnread(c.env, user.id),
    first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", user.id),
  ]);
  const data: DashboardData = {
    personalGoal: personal,
    clubGoal,
    clubCompleted: Number(clubDone?.n ?? 0),
    currentlyReading: reading,
    nextMeeting: meetings[0] ?? null,
    currentAssignments: assignments,
    activity,
    unreadMessages,
    unreadNotifications: Number(unreadNotifications?.n ?? 0),
  };
  return c.json(data);
});

dashboardRoutes.get("/activity", async (c) => {
  const limit = queryInt(c, "limit", 50, 1, 100);
  return c.json(await loadActivity(c.env.DB, c.get("user").id, limit));
});
