import { Hono } from "hono";
import { READING_STATUSES } from "../../shared/constants";
import {
  personalGoalSchema,
  progressUpdateSchema,
  quoteSchema,
  quoteUpdateSchema,
  reactionSchema,
  recommendationSchema,
  recommendationUpdateSchema,
  reviewSchema,
  reviewUpdateSchema,
  userBookSchema,
  yearSchema,
} from "../../shared/schemas";
import type { GoalProgress, Quote, Recommendation, Review } from "../../shared/types";
import type { AppEnv } from "../env";
import { visibleInClubSql } from "../lib/club";
import { all, first, run } from "../lib/db";
import { requireEdition } from "../lib/editions";
import { ApiError, badRequest, forbidden, notFound } from "../lib/errors";
import { parseBody, parseWith } from "../lib/http";
import { finishedCount, loadQuotes, loadReviews, loadUserBooks } from "../lib/loaders";
import { editionCols, mapEdition, mapMember, mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { emailClubUpdate, notifyUsers } from "../lib/notify";
import { makePage, pageQuery, timeCursor } from "../lib/paging";
import { logReadingToday } from "../lib/streaks";
import { currentYear, newId, nowIso } from "../lib/util";
import { enforceRateLimit } from "../security/rate-limit";

/**
 * Personal data. Every mutation is scoped with `AND user_id = <session user>`
 * in SQL, so a member can never change another member's records even with a
 * guessed id. Reads apply the visibility rule: private items are owner-only;
 * "club" items are visible to members who share at least one club with the
 * owner (visibleToViewerSql in the loaders).
 *
 * `clubReviewRoutes`, `clubQuoteRoutes` and `recommendationRoutes` are mounted
 * under /api/clubs/:clubId behind requireClubMember.
 */
export const libraryRoutes = new Hono<AppEnv>();
export const reviewRoutes = new Hono<AppEnv>();
export const quoteRoutes = new Hono<AppEnv>();
export const goalRoutes = new Hono<AppEnv>();
export const recommendationRoutes = new Hono<AppEnv>();
export const clubReviewRoutes = new Hono<AppEnv>();
export const clubQuoteRoutes = new Hono<AppEnv>();

async function ownedOr404(db: D1Database, table: string, id: string, userId: string, clubId?: string): Promise<Row> {
  const row = await first<Row>(db, `SELECT * FROM ${table} WHERE id = ?${clubId ? " AND club_id = ?" : ""}`, ...(clubId ? [id, clubId] : [id]));
  if (!row) throw notFound();
  if (row.user_id !== userId) throw forbidden("You can only change your own items");
  return row;
}

// ---------------------------------------------------------------------------
// Library (user_books)
// ---------------------------------------------------------------------------

libraryRoutes.get("/", async (c) => {
  const user = c.get("user");
  const status = c.req.query("status");
  if (status && !(READING_STATUSES as readonly string[]).includes(status)) throw badRequest("Invalid status");
  const books = await loadUserBooks(
    c.env.DB,
    user.id,
    status ? "ub.user_id = ? AND ub.status = ?" : "ub.user_id = ?",
    status ? [user.id, status] : [user.id],
    { order: status === "finished" ? "ub.finished_at DESC, ub.updated_at DESC" : "ub.updated_at DESC", limit: 5000 },
  );
  return c.json(books);
});

libraryRoutes.get("/editions/:editionId", async (c) => {
  const user = c.get("user");
  const [book] = await loadUserBooks(c.env.DB, user.id, "ub.user_id = ? AND ub.edition_id = ?", [user.id, c.req.param("editionId")]);
  return c.json(book ?? null);
});

/** Create or update the member's shelf entry for an edition. */
/**
 * One-tap "Add to library" from search results: shelves the edition as
 * To Be Read with the member's default visibility. Never changes an existing
 * shelf entry (so a finished book is not reset).
 */
libraryRoutes.post("/editions/:editionId/quick-add", async (c) => {
  const user = c.get("user");
  const editionId = c.req.param("editionId");
  await requireEdition(c.env.DB, editionId);
  const now = nowIso();
  const res = await run(
    c.env.DB,
    `INSERT INTO user_books (id, user_id, edition_id, status, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 'tbr', COALESCE((SELECT default_visibility FROM profiles WHERE user_id = ?), 'club'), ?, ?)
     ON CONFLICT (user_id, edition_id) DO NOTHING`,
    newId(),
    user.id,
    editionId,
    user.id,
    now,
    now,
  );
  const [book] = await loadUserBooks(c.env.DB, user.id, "ub.user_id = ? AND ub.edition_id = ?", [user.id, editionId]);
  return c.json({ added: (res.meta.changes ?? 0) > 0, book }, (res.meta.changes ?? 0) > 0 ? 201 : 200);
});

libraryRoutes.put("/editions/:editionId", async (c) => {
  const user = c.get("user");
  const editionId = c.req.param("editionId");
  const input = await parseBody(c, userBookSchema);
  if (input.editionId !== editionId) throw badRequest("Edition mismatch");
  await requireEdition(c.env.DB, editionId);
  const existing = await first<{ started_at: string | null; finished_at: string | null }>(
    c.env.DB,
    "SELECT started_at, finished_at FROM user_books WHERE user_id = ? AND edition_id = ?",
    user.id,
    editionId,
  );
  const now = nowIso();
  const today = now.slice(0, 10);
  // Sensible defaults: starting a book stamps today's date; finishing stamps the finish date.
  const startedAt = input.startedAt ?? existing?.started_at ?? (input.status === "reading" ? today : null);
  const finishedAt = input.status === "finished" ? (input.finishedAt ?? existing?.finished_at ?? today) : null;
  const progress = input.status === "finished" ? 100 : input.progressPercent;
  await run(
    c.env.DB,
    `INSERT INTO user_books (id, user_id, edition_id, status, started_at, finished_at, current_page, progress_percent, visibility, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, edition_id) DO UPDATE SET
       status = excluded.status, started_at = excluded.started_at, finished_at = excluded.finished_at,
       current_page = excluded.current_page, progress_percent = excluded.progress_percent,
       visibility = excluded.visibility, notes = excluded.notes, updated_at = excluded.updated_at`,
    newId(),
    user.id,
    editionId,
    input.status,
    startedAt,
    finishedAt,
    input.currentPage,
    progress,
    input.visibility,
    input.notes,
    now,
    now,
  );
  const [book] = await loadUserBooks(c.env.DB, user.id, "ub.user_id = ? AND ub.edition_id = ?", [user.id, editionId]);
  return c.json(book);
});

libraryRoutes.patch("/:id/progress", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = await parseBody(c, progressUpdateSchema);
  await ownedOr404(c.env.DB, "user_books", id, user.id);
  const before = await first<{ current_page: number | null; edition_id: string }>(
    c.env.DB,
    "SELECT current_page, edition_id FROM user_books WHERE id = ? AND user_id = ?",
    id,
    user.id,
  );
  await run(
    c.env.DB,
    "UPDATE user_books SET current_page = ?, progress_percent = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    input.currentPage,
    input.progressPercent,
    nowIso(),
    id,
    user.id,
  );
  // Moving forward in a book counts as reading today (streaks, recaps).
  if (before && input.currentPage !== null && input.currentPage > (before.current_page ?? 0)) {
    await logReadingToday(c.env.DB, user.id, before.edition_id, input.currentPage - (before.current_page ?? 0), c.req.query("today")).catch(() => undefined);
  }
  const [book] = await loadUserBooks(c.env.DB, user.id, "ub.id = ?", [id]);
  return c.json(book);
});

libraryRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await ownedOr404(c.env.DB, "user_books", id, user.id);
  await run(c.env.DB, "DELETE FROM user_books WHERE id = ? AND user_id = ?", id, user.id);
  return c.json({ ok: true });
});

libraryRoutes.get("/stats", async (c) => {
  const user = c.get("user");
  const year = parseWith(yearSchema, c.req.query("year") ?? currentYear());
  const counts = await all<{ status: string; n: number }>(
    c.env.DB,
    "SELECT status, COUNT(*) AS n FROM user_books WHERE user_id = ? GROUP BY status",
    user.id,
  );
  const monthly = await all<{ month: string; n: number }>(
    c.env.DB,
    `SELECT substr(finished_at, 6, 2) AS month, COUNT(*) AS n FROM user_books
     WHERE user_id = ? AND status = 'finished' AND substr(finished_at, 1, 4) = ? GROUP BY month ORDER BY month`,
    user.id,
    String(year),
  );
  const pages = await first<{ pages: number | null }>(
    c.env.DB,
    `SELECT SUM(e.page_count) AS pages FROM user_books ub JOIN book_editions e ON e.id = ub.edition_id
     WHERE ub.user_id = ? AND ub.status = 'finished' AND substr(ub.finished_at, 1, 4) = ?`,
    user.id,
    String(year),
  );
  return c.json({
    year,
    byStatus: Object.fromEntries(counts.map((r) => [r.status, Number(r.n)])),
    finishedByMonth: monthly.map((m) => ({ month: Number(m.month), count: Number(m.n) })),
    pagesRead: Number(pages?.pages ?? 0),
  });
});

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

reviewRoutes.get("/", async (c) => {
  const user = c.get("user");
  const scope = c.req.query("scope") ?? "club";
  const editionId = c.req.query("editionId");
  const clauses: string[] = [];
  const params: string[] = [];
  if (scope === "mine") {
    clauses.push("r.user_id = ?");
    params.push(user.id);
  }
  if (editionId) {
    clauses.push("r.edition_id = ?");
    params.push(editionId);
  }
  const reviews = await loadReviews(c.env.DB, user.id, clauses.length ? clauses.join(" AND ") : "1 = 1", params, { limit: 200 });
  return c.json(reviews);
});

/** Club reviews feed (paged): club-visible reviews by members of this club, plus the viewer's own. */
clubReviewRoutes.get("/", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const { cursor, limit } = pageQuery(c);
  if (cursor && !timeCursor(cursor)) throw badRequest("Invalid cursor");
  const where = `${visibleInClubSql("r")}${cursor ? " AND r.created_at < ?" : ""}`;
  const params = cursor ? [clubId, user.id, cursor] : [clubId, user.id];
  const rows = await loadReviews(c.env.DB, user.id, where, params, { limit: limit + 1, order: "r.created_at DESC" });
  return c.json(makePage<Review>(rows, limit, (r) => r.createdAt));
});

reviewRoutes.post("/", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, reviewSchema);
  await enforceRateLimit(c.env, "review-create", user.id, { window: 60 * 60, max: 30 });
  await requireEdition(c.env.DB, input.editionId);
  const existing = await first<{ id: string }>(c.env.DB, "SELECT id FROM reviews WHERE user_id = ? AND edition_id = ?", user.id, input.editionId);
  if (existing) throw new ApiError(409, "duplicate", "You already reviewed this edition — edit your existing review instead", { current: { id: existing.id } });
  const id = newId();
  const now = nowIso();
  await run(
    c.env.DB,
    "INSERT INTO reviews (id, user_id, edition_id, body, sentiment, visibility, contains_spoilers, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    user.id,
    input.editionId,
    input.body,
    input.sentiment,
    input.visibility,
    Number(input.containsSpoilers),
    now,
    now,
  );
  const [review] = await loadReviews(c.env.DB, user.id, "r.id = ?", [id]);
  return c.json(review, 201);
});

reviewRoutes.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = await parseBody(c, reviewUpdateSchema);
  await ownedOr404(c.env.DB, "reviews", id, user.id);
  await run(
    c.env.DB,
    "UPDATE reviews SET body = ?, sentiment = ?, visibility = ?, contains_spoilers = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    input.body,
    input.sentiment,
    input.visibility,
    Number(input.containsSpoilers),
    nowIso(),
    id,
    user.id,
  );
  const [review] = await loadReviews(c.env.DB, user.id, "r.id = ?", [id]);
  return c.json(review);
});

reviewRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await ownedOr404(c.env.DB, "reviews", id, user.id);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM reviews WHERE id = ? AND user_id = ?").bind(id, user.id),
    c.env.DB.prepare("UPDATE share_links SET revoked_at = ? WHERE resource_type = 'review' AND resource_id = ? AND revoked_at IS NULL").bind(
      nowIso(),
      id,
    ),
  ]);
  return c.json({ ok: true });
});

/** Reactions are the reacting member's own records; the review must be visible to them. */
reviewRoutes.post("/:id/reactions", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const { reaction } = await parseBody(c, reactionSchema);
  const [review] = await loadReviews(c.env.DB, user.id, "r.id = ?", [id]);
  if (!review) throw notFound("Review not found");
  const res = await run(
    c.env.DB,
    "INSERT OR IGNORE INTO review_reactions (review_id, user_id, reaction, created_at) VALUES (?, ?, ?, ?)",
    id,
    user.id,
    reaction,
    nowIso(),
  );
  if (res.meta.changes > 0 && !review.isOwn) {
    c.executionCtx.waitUntil(
      notifyUsers(c.env, [review.author.id], {
        kind: "review_reaction",
        clubId: null,
        title: `${user.name} reacted to your review of ${review.edition.title}`,
        link: `/books/${review.edition.id}#review-${review.id}`,
        actorId: user.id,
      }),
    );
  }
  const [updated] = await loadReviews(c.env.DB, user.id, "r.id = ?", [id]);
  return c.json(updated);
});

reviewRoutes.delete("/:id/reactions/:reaction", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const { reaction } = parseWith(reactionSchema, { reaction: c.req.param("reaction") });
  await run(c.env.DB, "DELETE FROM review_reactions WHERE review_id = ? AND user_id = ? AND reaction = ?", id, user.id, reaction);
  const [updated] = await loadReviews(c.env.DB, user.id, "r.id = ?", [id]);
  if (!updated) throw notFound("Review not found");
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

quoteRoutes.get("/", async (c) => {
  const user = c.get("user");
  const scope = c.req.query("scope") ?? "club";
  const editionId = c.req.query("editionId");
  const clauses: string[] = [];
  const params: string[] = [];
  if (scope === "mine") {
    clauses.push("q.user_id = ?");
    params.push(user.id);
  }
  if (editionId) {
    clauses.push("q.edition_id = ?");
    params.push(editionId);
  }
  return c.json(await loadQuotes(c.env.DB, user.id, clauses.length ? clauses.join(" AND ") : "1 = 1", params, 300));
});

/** Club quotes feed (paged): same visibility rule as reviews. */
clubQuoteRoutes.get("/", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const { cursor, limit } = pageQuery(c);
  if (cursor && !timeCursor(cursor)) throw badRequest("Invalid cursor");
  const where = `${visibleInClubSql("q")}${cursor ? " AND q.created_at < ?" : ""}`;
  const params = cursor ? [clubId, user.id, cursor] : [clubId, user.id];
  const rows = await loadQuotes(c.env.DB, user.id, where, params, limit + 1);
  return c.json(makePage<Quote>(rows, limit, (q) => q.createdAt));
});

quoteRoutes.post("/", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, quoteSchema);
  await enforceRateLimit(c.env, "quote-create", user.id, { window: 60 * 60, max: 30 });
  await requireEdition(c.env.DB, input.editionId);
  const id = newId();
  const now = nowIso();
  await run(
    c.env.DB,
    "INSERT INTO quotes (id, user_id, edition_id, text, location, note, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    user.id,
    input.editionId,
    input.text,
    input.location,
    input.note,
    input.visibility,
    now,
    now,
  );
  const [quote] = await loadQuotes(c.env.DB, user.id, "q.id = ?", [id]);
  return c.json(quote, 201);
});

quoteRoutes.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = await parseBody(c, quoteUpdateSchema);
  await ownedOr404(c.env.DB, "quotes", id, user.id);
  await run(
    c.env.DB,
    "UPDATE quotes SET text = ?, location = ?, note = ?, visibility = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    input.text,
    input.location,
    input.note,
    input.visibility,
    nowIso(),
    id,
    user.id,
  );
  const [quote] = await loadQuotes(c.env.DB, user.id, "q.id = ?", [id]);
  return c.json(quote);
});

quoteRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await ownedOr404(c.env.DB, "quotes", id, user.id);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM quotes WHERE id = ? AND user_id = ?").bind(id, user.id),
    c.env.DB.prepare("UPDATE share_links SET revoked_at = ? WHERE resource_type = 'quote' AND resource_id = ? AND revoked_at IS NULL").bind(
      nowIso(),
      id,
    ),
  ]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Personal annual goals
// ---------------------------------------------------------------------------

export async function personalGoal(db: D1Database, userId: string, year: number): Promise<GoalProgress> {
  const goal = await first<{ target: number }>(db, "SELECT target FROM personal_reading_goals WHERE user_id = ? AND year = ?", userId, year);
  return { year, target: goal ? Number(goal.target) : null, completed: await finishedCount(db, userId, year) };
}

goalRoutes.get("/", async (c) => {
  const user = c.get("user");
  const year = parseWith(yearSchema, c.req.query("year") ?? currentYear());
  return c.json(await personalGoal(c.env.DB, user.id, year));
});

goalRoutes.get("/history", async (c) => {
  const user = c.get("user");
  const rows = await all<{ year: number; target: number }>(
    c.env.DB,
    "SELECT year, target FROM personal_reading_goals WHERE user_id = ? ORDER BY year DESC",
    user.id,
  );
  const result: GoalProgress[] = [];
  for (const r of rows) result.push({ year: r.year, target: r.target, completed: await finishedCount(c.env.DB, user.id, r.year) });
  return c.json(result);
});

goalRoutes.put("/", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, personalGoalSchema);
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO personal_reading_goals (id, user_id, year, target, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, year) DO UPDATE SET target = excluded.target, updated_at = excluded.updated_at`,
    newId(),
    user.id,
    input.year,
    input.target,
    now,
    now,
  );
  return c.json(await personalGoal(c.env.DB, user.id, input.year));
});

goalRoutes.delete("/:year", async (c) => {
  const user = c.get("user");
  const year = parseWith(yearSchema, c.req.param("year"));
  await run(c.env.DB, "DELETE FROM personal_reading_goals WHERE user_id = ? AND year = ?", user.id, year);
  return c.json(await personalGoal(c.env.DB, user.id, year));
});

// ---------------------------------------------------------------------------
// Recommendations (inside a club; mounted at /api/clubs/:clubId/recommendations)
// ---------------------------------------------------------------------------

export async function loadRecommendations(
  db: D1Database,
  clubId: string,
  viewerId: string,
  where: string,
  params: string[],
  limit = 100,
): Promise<Recommendation[]> {
  // Visible to: the whole club when recipient is NULL; otherwise only sender and recipient.
  const rows = await all<Row>(
    db,
    `SELECT r.*, ${memberCols("s", "s_")}, ${memberCols("t", "t_")}, ${editionCols("e", "e_")}
     FROM recommendations r
     JOIN "user" s ON s.id = r.user_id
     LEFT JOIN "user" t ON t.id = r.recipient_user_id
     JOIN book_editions e ON e.id = r.edition_id
     WHERE r.club_id = ? AND (r.recipient_user_id IS NULL OR r.recipient_user_id = ? OR r.user_id = ?) AND (${where})
     ORDER BY r.created_at DESC LIMIT ${limit}`,
    clubId,
    viewerId,
    viewerId,
    ...params,
  );
  return rows.map((r) => ({
    id: String(r.id),
    clubId: String(r.club_id),
    recommender: mapMember(r, "s_"),
    recipient: mapMemberOrNull(r, "t_"),
    edition: mapEdition(r, "e_"),
    note: (r.note as string | null) ?? null,
    isOwn: r.user_id === viewerId,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

recommendationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const scope = c.req.query("scope") ?? "all";
  const where =
    scope === "received" ? "r.recipient_user_id = ?" : scope === "sent" ? "r.user_id = ?" : scope === "club" ? "r.recipient_user_id IS NULL" : "1 = 1";
  const params = scope === "received" || scope === "sent" ? [user.id] : [];
  return c.json(await loadRecommendations(c.env.DB, clubId, user.id, where, params, 200));
});

recommendationRoutes.post("/", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const input = await parseBody(c, recommendationSchema);
  await enforceRateLimit(c.env, "recommendation-create", `${club.id}:${user.id}`, { window: 60 * 60, max: 30 });
  await requireEdition(c.env.DB, input.editionId);
  if (input.recipientUserId) {
    if (input.recipientUserId === user.id) throw badRequest("You cannot recommend a book to yourself");
    // The recipient must be a member of this club.
    const recipient = await first<{ id: string }>(
      c.env.DB,
      'SELECT u.id FROM "user" u JOIN club_members m ON m.user_id = u.id AND m.club_id = ? WHERE u.id = ? AND u."emailVerified" = 1',
      club.id,
      input.recipientUserId,
    );
    if (!recipient) throw notFound("Member not found");
  }
  const id = newId();
  const now = nowIso();
  await run(
    c.env.DB,
    "INSERT INTO recommendations (id, club_id, user_id, edition_id, recipient_user_id, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    club.id,
    user.id,
    input.editionId,
    input.recipientUserId,
    input.note,
    now,
    now,
  );
  const [rec] = await loadRecommendations(c.env.DB, club.id, user.id, "r.id = ?", [id]);
  if (rec) {
    const title = `${user.name} recommended ${rec.edition.title}${rec.recipient ? " to you" : ` to ${club.name}`}`;
    const path = `/c/${club.id}/recommend`;
    c.executionCtx.waitUntil(
      Promise.all([
        notifyUsers(c.env, rec.recipient ? [rec.recipient.id] : "club", {
          kind: "recommendation",
          clubId: club.id,
          title,
          body: rec.note,
          link: path,
          actorId: user.id,
        }),
        emailClubUpdate(c.env, {
          clubId: club.id,
          clubName: club.name,
          actorId: user.id,
          heading: "New book recommendation",
          lines: [title + ".", ...(rec.note ? [`“${rec.note}”`] : [])],
          path,
          preference: "email_recommendations",
          onlyUserIds: rec.recipient ? [rec.recipient.id] : undefined,
        }),
      ]),
    );
  }
  return c.json(rec, 201);
});

recommendationRoutes.put("/:id", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("id");
  const input = await parseBody(c, recommendationUpdateSchema);
  await ownedOr404(c.env.DB, "recommendations", id, user.id, clubId);
  await run(c.env.DB, "UPDATE recommendations SET note = ?, updated_at = ? WHERE id = ? AND user_id = ? AND club_id = ?", input.note, nowIso(), id, user.id, clubId);
  const [rec] = await loadRecommendations(c.env.DB, clubId, user.id, "r.id = ?", [id]);
  return c.json(rec);
});

recommendationRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("id");
  await ownedOr404(c.env.DB, "recommendations", id, user.id, clubId);
  await run(c.env.DB, "DELETE FROM recommendations WHERE id = ? AND user_id = ? AND club_id = ?", id, user.id, clubId);
  return c.json({ ok: true });
});
