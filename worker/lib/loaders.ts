import { REVIEW_REACTIONS, type ReviewReaction, type Sentiment, type Visibility } from "../../shared/constants";
import type { Quote, ReactionCount, Review, UserBook } from "../../shared/types";
import { visibleToViewerSql } from "./club";
import { all, bool, placeholders } from "./db";
import { editionCols, mapEdition, mapMember, memberCols, type Row } from "./mappers";

/**
 * Visibility rule for personal content: the owner sees everything; other
 * members see "club" items only when they share at least one club with the
 * owner (visibleToViewerSql, which binds the viewer id twice). Every loader
 * below takes the viewer id and applies this rule in SQL.
 */
const visibleTo = visibleToViewerSql;

// --- Reviews -------------------------------------------------------------------------

const REVIEW_SELECT = `SELECT r.id, r.user_id, r.body, r.sentiment, r.visibility, r.contains_spoilers, r.created_at, r.updated_at,
  ${memberCols("u", "m_")}, ${editionCols("e", "e_")}
  FROM reviews r JOIN "user" u ON u.id = r.user_id JOIN book_editions e ON e.id = r.edition_id`;

async function reactionsFor(db: D1Database, reviewIds: string[], viewerId: string): Promise<Map<string, ReactionCount[]>> {
  const map = new Map<string, ReactionCount[]>();
  if (reviewIds.length === 0) return map;
  const rows = await all<{ review_id: string; reaction: ReviewReaction; n: number; mine: number }>(
    db,
    `SELECT review_id, reaction, COUNT(*) AS n, MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine
     FROM review_reactions WHERE review_id IN (${placeholders(reviewIds.length)}) GROUP BY review_id, reaction`,
    viewerId,
    ...reviewIds,
  );
  for (const id of reviewIds) {
    map.set(
      id,
      REVIEW_REACTIONS.map((reaction) => {
        const r = rows.find((x) => x.review_id === id && x.reaction === reaction);
        return { reaction, count: r ? Number(r.n) : 0, mine: r ? bool(r.mine) : false };
      }),
    );
  }
  return map;
}

export async function loadReviews(
  db: D1Database,
  viewerId: string,
  where: string,
  params: (string | number)[],
  opts: { limit?: number; order?: string } = {},
): Promise<Review[]> {
  const rows = await all<Row>(
    db,
    `${REVIEW_SELECT} WHERE ${visibleTo("r")} AND (${where}) ORDER BY ${opts.order ?? "r.updated_at DESC"} LIMIT ${opts.limit ?? 100}`,
    viewerId,
    viewerId,
    ...params,
  );
  const reactions = await reactionsFor(
    db,
    rows.map((r) => String(r.id)),
    viewerId,
  );
  return rows.map((r) => ({
    id: String(r.id),
    author: mapMember(r, "m_"),
    edition: mapEdition(r, "e_"),
    body: String(r.body),
    sentiment: r.sentiment as Sentiment,
    visibility: r.visibility as Visibility,
    containsSpoilers: bool(r.contains_spoilers),
    reactions: reactions.get(String(r.id)) ?? [],
    isOwn: r.user_id === viewerId,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

// --- Quotes ------------------------------------------------------------------------------

export async function loadQuotes(
  db: D1Database,
  viewerId: string,
  where: string,
  params: (string | number)[],
  limit = 100,
): Promise<Quote[]> {
  const rows = await all<Row>(
    db,
    `SELECT q.id, q.user_id, q.text, q.location, q.note, q.visibility, q.created_at, q.updated_at,
       ${memberCols("u", "m_")}, ${editionCols("e", "e_")}
     FROM quotes q JOIN "user" u ON u.id = q.user_id JOIN book_editions e ON e.id = q.edition_id
     WHERE ${visibleTo("q")} AND (${where}) ORDER BY q.created_at DESC LIMIT ${limit}`,
    viewerId,
    viewerId,
    ...params,
  );
  return rows.map((r) => {
    const own = r.user_id === viewerId;
    return {
      id: String(r.id),
      author: mapMember(r, "m_"),
      edition: mapEdition(r, "e_"),
      text: String(r.text),
      location: (r.location as string | null) ?? null,
      // A quote's personal note is only shown to its owner.
      note: own ? ((r.note as string | null) ?? null) : null,
      visibility: r.visibility as Visibility,
      isOwn: own,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  });
}

// --- Personal library ----------------------------------------------------------------------

export async function loadUserBooks(
  db: D1Database,
  viewerId: string,
  where: string,
  params: (string | number)[],
  opts: { limit?: number; order?: string } = {},
): Promise<UserBook[]> {
  const rows = await all<Row>(
    db,
    `SELECT ub.*, ${editionCols("e", "e_")} FROM user_books ub JOIN book_editions e ON e.id = ub.edition_id
     WHERE ${visibleTo("ub")} AND (${where}) ORDER BY ${opts.order ?? "ub.updated_at DESC"} LIMIT ${opts.limit ?? 500}`,
    viewerId,
    viewerId,
    ...params,
  );
  return rows.map((r) => mapUserBook(r, viewerId));
}

export function mapUserBook(r: Row, viewerId: string): UserBook {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    edition: mapEdition(r, "e_"),
    status: r.status as UserBook["status"],
    startedAt: (r.started_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
    currentPage: r.current_page === null || r.current_page === undefined ? null : Number(r.current_page),
    progressPercent: r.progress_percent === null || r.progress_percent === undefined ? null : Number(r.progress_percent),
    visibility: r.visibility as Visibility,
    // Personal notes never leave the owner's account.
    notes: r.user_id === viewerId ? ((r.notes as string | null) ?? null) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Number of books a member finished in a calendar year. */
export async function finishedCount(db: D1Database, userId: string, year: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND status = 'finished' AND substr(finished_at, 1, 4) = ?")
    .bind(userId, String(year))
    .first<{ n: number }>();
  return row ? Number(row.n) : 0;
}
