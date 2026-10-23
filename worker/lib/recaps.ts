import type { ClubWrapped, EditionSummary, MemberSummary, MonthlyRecap } from "../../shared/types";
import type { Env } from "../env";
import { all, first, run } from "./db";
import { editionCols, mapEdition, mapMember, mapMemberOrNull, memberCols, type Row } from "./mappers";
import { computeStreak, longestStreakWithin } from "./streaks";
import { nowIso } from "./util";

/**
 * Monthly recaps (personal and club) and the yearly Club Wrapped. Everything
 * is computed from existing tables and cached in recap_cache for six hours;
 * the client draws the shareable graphic from this JSON.
 */

const CACHE_TTL_MS = 6 * 3600_000;

async function cached<T>(env: Env, scope: string, period: string, compute: () => Promise<T>): Promise<T> {
  const row = await first<{ data: string; computed_at: string }>(env.DB, "SELECT data, computed_at FROM recap_cache WHERE scope = ? AND period = ?", scope, period);
  if (row && Date.parse(row.computed_at) > Date.now() - CACHE_TTL_MS) {
    try {
      return JSON.parse(row.data) as T;
    } catch {
      // fall through and recompute
    }
  }
  const data = await compute();
  await run(
    env.DB,
    `INSERT INTO recap_cache (scope, period, data, computed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (scope, period) DO UPDATE SET data = excluded.data, computed_at = excluded.computed_at`,
    scope,
    period,
    JSON.stringify(data),
    nowIso(),
  );
  return data;
}

/** Drop cached recaps for a scope (after edits that would make them stale). */
export async function invalidateRecaps(env: Env, scope: string): Promise<void> {
  await run(env.DB, "DELETE FROM recap_cache WHERE scope = ?", scope);
}

/** [first day, last day] of a YYYY-MM month. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1] ?? month} ${y}`;
}

function n(v: unknown): number {
  return Number(v ?? 0) || 0;
}

// --- Personal monthly recap ------------------------------------------------------------

export async function userMonthlyRecap(env: Env, userId: string, month: string): Promise<MonthlyRecap> {
  return cached(env, `user:${userId}`, month, async () => {
    const { from, to } = monthBounds(month);
    const db = env.DB;
    const [finished, log, days, genre, meetings, quotes, reviews] = await Promise.all([
      all<Row>(
        db,
        `SELECT ${editionCols("e", "e_")} FROM user_books ub JOIN book_editions e ON e.id = ub.edition_id
          WHERE ub.user_id = ? AND ub.status = 'finished' AND substr(ub.finished_at, 1, 10) BETWEEN ? AND ? ORDER BY ub.finished_at`,
        userId,
        from,
        to,
      ),
      first<{ pages: number | null; minutes: number | null }>(
        db,
        "SELECT SUM(pages) AS pages, SUM(minutes) AS minutes FROM reading_log WHERE user_id = ? AND day BETWEEN ? AND ?",
        userId,
        from,
        to,
      ),
      all<{ day: string }>(db, "SELECT day FROM reading_log WHERE user_id = ? AND (pages > 0 OR minutes > 0) AND day BETWEEN ? AND ?", userId, from, to),
      first<{ name: string }>(
        db,
        `SELECT g.name, COUNT(*) AS n FROM user_books ub
           JOIN book_editions e ON e.id = ub.edition_id
           JOIN book_genres bg ON bg.book_id = e.book_id
           JOIN club_members cm ON cm.club_id = bg.club_id AND cm.user_id = ub.user_id
           JOIN genres g ON g.id = bg.genre_id AND g.archived_at IS NULL
          WHERE ub.user_id = ? AND ub.status = 'finished' AND substr(ub.finished_at, 1, 10) BETWEEN ? AND ?
          GROUP BY g.name ORDER BY n DESC, g.name LIMIT 1`,
        userId,
        from,
        to,
      ),
      first<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM meeting_attendance a JOIN club_meetings m ON m.id = a.meeting_id
          WHERE a.user_id = ? AND a.present = 1 AND substr(m.starts_at, 1, 10) BETWEEN ? AND ?`,
        userId,
        from,
        to,
      ),
      first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM quotes WHERE user_id = ? AND substr(created_at, 1, 10) BETWEEN ? AND ?", userId, from, to),
      first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND substr(created_at, 1, 10) BETWEEN ? AND ?", userId, from, to),
    ]);
    const books = finished.map((r) => ({ edition: mapEdition(r, "e_"), by: null }));
    const pagesRead = n(log?.pages);
    const streakBest = computeStreak(
      days.map((d) => d.day),
      to,
    ).longest;
    return {
      period: month,
      scope: "user",
      booksFinished: books,
      pagesRead,
      minutesRead: n(log?.minutes),
      streakBest,
      topGenre: genre?.name ?? null,
      meetingsAttended: n(meetings?.n),
      quotesSaved: n(quotes?.n),
      reviewsWritten: n(reviews?.n),
      headline: personalHeadline(month, books.length, pagesRead, streakBest),
    };
  });
}

function personalHeadline(month: string, books: number, pages: number, streak: number): string {
  const label = monthLabel(month);
  if (books === 0 && pages === 0) return `A quiet ${label}. Every shelf has its pauses.`;
  const parts: string[] = [];
  if (books > 0) parts.push(`${books} book${books === 1 ? "" : "s"} finished`);
  if (pages > 0) parts.push(`${pages.toLocaleString("en-US")} pages`);
  if (streak >= 3) parts.push(`a ${streak}-day streak`);
  return `${label}: ${parts.join(", ")}.`;
}

// --- Club monthly recap --------------------------------------------------------------------

export async function clubMonthlyRecap(env: Env, clubId: string, month: string): Promise<MonthlyRecap> {
  return cached(env, `club:${clubId}`, month, async () => {
    const { from, to } = monthBounds(month);
    const db = env.DB;
    const [finished, log, memberDays, genre, meetings, quotes, reviews, club] = await Promise.all([
      all<Row>(
        db,
        `SELECT ${editionCols("e", "e_")}, ${memberCols("u", "m_")} FROM club_annual_books b
           JOIN book_editions e ON e.id = b.edition_id LEFT JOIN "user" u ON u.id = b.updated_by
          WHERE b.club_id = ? AND b.archived_at IS NULL AND b.status = 'completed' AND substr(b.completed_at, 1, 10) BETWEEN ? AND ?
          ORDER BY b.completed_at`,
        clubId,
        from,
        to,
      ),
      first<{ pages: number | null; minutes: number | null }>(
        db,
        `SELECT SUM(l.pages) AS pages, SUM(l.minutes) AS minutes FROM reading_log l
           JOIN club_members cm ON cm.user_id = l.user_id AND cm.club_id = ? WHERE l.day BETWEEN ? AND ?`,
        clubId,
        from,
        to,
      ),
      all<{ user_id: string; day: string }>(
        db,
        `SELECT l.user_id, l.day FROM reading_log l JOIN club_members cm ON cm.user_id = l.user_id AND cm.club_id = ?
          WHERE (l.pages > 0 OR l.minutes > 0) AND l.day BETWEEN ? AND ? ORDER BY l.user_id, l.day`,
        clubId,
        from,
        to,
      ),
      first<{ name: string }>(
        db,
        `SELECT g.name, COUNT(*) AS n FROM club_annual_books b
           JOIN book_editions e ON e.id = b.edition_id
           JOIN book_genres bg ON bg.book_id = e.book_id AND bg.club_id = b.club_id
           JOIN genres g ON g.id = bg.genre_id AND g.archived_at IS NULL
          WHERE b.club_id = ? AND b.archived_at IS NULL AND b.status = 'completed' AND substr(b.completed_at, 1, 10) BETWEEN ? AND ?
          GROUP BY g.name ORDER BY n DESC, g.name LIMIT 1`,
        clubId,
        from,
        to,
      ),
      first<{ n: number }>(
        db,
        "SELECT COUNT(*) AS n FROM club_meetings WHERE club_id = ? AND archived_at IS NULL AND substr(starts_at, 1, 10) BETWEEN ? AND ? AND starts_at <= ?",
        clubId,
        from,
        to,
        nowIso(),
      ),
      first<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM quotes q JOIN club_members cm ON cm.user_id = q.user_id AND cm.club_id = ?
          WHERE q.visibility = 'club' AND substr(q.created_at, 1, 10) BETWEEN ? AND ?`,
        clubId,
        from,
        to,
      ),
      first<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM reviews r JOIN club_members cm ON cm.user_id = r.user_id AND cm.club_id = ?
          WHERE r.visibility = 'club' AND substr(r.created_at, 1, 10) BETWEEN ? AND ?`,
        clubId,
        from,
        to,
      ),
      first<{ name: string }>(db, "SELECT name FROM clubs WHERE id = ?", clubId),
    ]);
    const books = finished.map((r) => ({ edition: mapEdition(r, "e_"), by: mapMemberOrNull(r, "m_") }));
    let streakBest = 0;
    const byUser = new Map<string, string[]>();
    for (const d of memberDays) byUser.set(d.user_id, [...(byUser.get(d.user_id) ?? []), d.day]);
    for (const days of byUser.values()) streakBest = Math.max(streakBest, longestStreakWithin(days, from, to));
    const pagesRead = n(log?.pages);
    const meetingsHeld = n(meetings?.n);
    return {
      period: month,
      scope: "club",
      booksFinished: books,
      pagesRead,
      minutesRead: n(log?.minutes),
      streakBest,
      topGenre: genre?.name ?? null,
      meetingsAttended: meetingsHeld,
      quotesSaved: n(quotes?.n),
      reviewsWritten: n(reviews?.n),
      headline: clubHeadline(club?.name ?? "The club", month, books.length, pagesRead, meetingsHeld),
    };
  });
}

function clubHeadline(clubName: string, month: string, books: number, pages: number, meetings: number): string {
  const label = monthLabel(month);
  const parts: string[] = [];
  if (books > 0) parts.push(`finished ${books} book${books === 1 ? "" : "s"}`);
  if (meetings > 0) parts.push(`met ${meetings} time${meetings === 1 ? "" : "s"}`);
  if (pages > 0) parts.push(`read ${pages.toLocaleString("en-US")} pages together`);
  if (parts.length === 0) return `${clubName} took ${label} slowly. Good books deserve it.`;
  return `${clubName} ${parts.join(", ")} in ${label}.`;
}

// --- Club Wrapped -----------------------------------------------------------------------------

export async function clubWrapped(env: Env, clubId: string, year: number): Promise<ClubWrapped> {
  return cached(env, `club:${clubId}`, String(year), async () => {
    const db = env.DB;
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const now = nowIso();
    const [club, members, books, meetings, attendance, loved, reviewer, memberDays, busiest, reacted, polls, votes] = await Promise.all([
      first<{ name: string }>(db, "SELECT name FROM clubs WHERE id = ?", clubId),
      first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM club_members WHERE club_id = ?", clubId),
      all<Row>(
        db,
        `SELECT ${editionCols("e", "e_")} FROM club_annual_books b JOIN book_editions e ON e.id = b.edition_id
          WHERE b.club_id = ? AND b.archived_at IS NULL AND b.status = 'completed'
            AND COALESCE(substr(b.completed_at, 1, 4), CAST(b.year AS TEXT)) = ? ORDER BY b.completed_at, b.position`,
        clubId,
        String(year),
      ),
      first<{ n: number }>(
        db,
        "SELECT COUNT(*) AS n FROM club_meetings WHERE club_id = ? AND archived_at IS NULL AND substr(starts_at, 1, 4) = ? AND starts_at <= ?",
        clubId,
        String(year),
        now,
      ),
      first<{ marked: number; present: number }>(
        db,
        `SELECT COUNT(DISTINCT a.meeting_id) AS marked, SUM(a.present) AS present
           FROM meeting_attendance a JOIN club_meetings m ON m.id = a.meeting_id
          WHERE m.club_id = ? AND m.archived_at IS NULL AND substr(m.starts_at, 1, 4) = ?`,
        clubId,
        String(year),
      ),
      first<Row>(
        db,
        `SELECT ${editionCols("e", "e_")}, COUNT(*) AS loved FROM reviews r
           JOIN club_members cm ON cm.user_id = r.user_id AND cm.club_id = ?
           JOIN book_editions e ON e.id = r.edition_id
          WHERE r.visibility = 'club' AND r.sentiment = 'loved' AND substr(r.created_at, 1, 4) = ?
            AND e.book_id IN (SELECT e2.book_id FROM club_annual_books b JOIN book_editions e2 ON e2.id = b.edition_id WHERE b.club_id = ? AND b.archived_at IS NULL)
          GROUP BY e.id ORDER BY loved DESC, e.title LIMIT 1`,
        clubId,
        String(year),
        clubId,
      ),
      first<Row>(
        db,
        `SELECT ${memberCols("u", "m_")}, COUNT(*) AS reviews FROM reviews r
           JOIN club_members cm ON cm.user_id = r.user_id AND cm.club_id = ? JOIN "user" u ON u.id = r.user_id
          WHERE r.visibility = 'club' AND substr(r.created_at, 1, 4) = ? GROUP BY u.id ORDER BY reviews DESC, u.name LIMIT 1`,
        clubId,
        String(year),
      ),
      all<{ user_id: string; day: string }>(
        db,
        `SELECT l.user_id, l.day FROM reading_log l JOIN club_members cm ON cm.user_id = l.user_id AND cm.club_id = ?
          WHERE (l.pages > 0 OR l.minutes > 0) AND l.day BETWEEN ? AND ? ORDER BY l.user_id, l.day`,
        clubId,
        from,
        to,
      ),
      first<{ month: string; n: number }>(
        db,
        `SELECT substr(m.created_at, 1, 7) AS month, COUNT(*) AS n FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE c.club_id = ? AND c.kind = 'club' AND m.deleted_at IS NULL AND substr(m.created_at, 1, 4) = ?
          GROUP BY month ORDER BY n DESC, month LIMIT 1`,
        clubId,
        String(year),
      ),
      first<Row>(
        db,
        `SELECT m.body, COUNT(mr.user_id) AS reactions, ${memberCols("u", "m_")} FROM messages m
           JOIN conversations c ON c.id = m.conversation_id AND c.club_id = ? AND c.kind = 'club' AND c.room_id IS NULL
           JOIN message_reactions mr ON mr.message_id = m.id
           LEFT JOIN "user" u ON u.id = m.sender_id
          WHERE m.deleted_at IS NULL AND m.body IS NOT NULL AND substr(m.created_at, 1, 4) = ?
          GROUP BY m.id ORDER BY reactions DESC, m.created_at LIMIT 1`,
        clubId,
        String(year),
      ),
      first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM polls WHERE club_id = ? AND archived_at IS NULL AND substr(created_at, 1, 4) = ?", clubId, String(year)),
      first<{ n: number }>(
        db,
        "SELECT COUNT(*) AS n FROM poll_votes v JOIN polls p ON p.id = v.poll_id WHERE p.club_id = ? AND substr(v.created_at, 1, 4) = ?",
        clubId,
        String(year),
      ),
    ]);
    const booksRead: EditionSummary[] = books.map((r) => mapEdition(r, "e_"));
    const memberCount = n(members?.n);
    const marked = n(attendance?.marked);
    const attendanceRate = marked > 0 && memberCount > 0 ? Math.min(1, Math.round((n(attendance?.present) / (marked * memberCount)) * 100) / 100) : null;

    let longestStreak: { member: MemberSummary; days: number } | null = null;
    const byUser = new Map<string, string[]>();
    for (const d of memberDays) byUser.set(d.user_id, [...(byUser.get(d.user_id) ?? []), d.day]);
    let bestUser: string | null = null;
    let bestDays = 0;
    for (const [userId, days] of byUser) {
      const len = longestStreakWithin(days, from, to);
      if (len > bestDays) {
        bestDays = len;
        bestUser = userId;
      }
    }
    if (bestUser) {
      const u = await first<Row>(db, `SELECT ${memberCols("u", "m_")} FROM "user" u WHERE u.id = ?`, bestUser);
      if (u) longestStreak = { member: mapMember(u, "m_"), days: bestDays };
    }
    const excerpt = reacted?.body ? String(reacted.body) : null;
    return {
      year,
      clubName: club?.name ?? "",
      booksRead,
      pagesRead: booksRead.reduce((sum, e) => sum + (e.pageCount ?? 0), 0),
      meetings: n(meetings?.n),
      attendanceRate,
      mostLovedBook: loved?.e_id ? { edition: mapEdition(loved, "e_"), loved: n(loved.loved) } : null,
      topReviewer: reviewer?.m_id ? { member: mapMember(reviewer, "m_"), reviews: n(reviewer.reviews) } : null,
      longestStreak,
      busiestMonth: busiest?.month ? { month: busiest.month, messages: n(busiest.n) } : null,
      mostReacted: excerpt ? { excerpt: excerpt.length > 140 ? `${excerpt.slice(0, 137)}...` : excerpt, author: mapMemberOrNull(reacted!, "m_"), reactions: n(reacted!.reactions) } : null,
      polls: { held: n(polls?.n), votesCast: n(votes?.n) },
      members: memberCount,
    };
  });
}
