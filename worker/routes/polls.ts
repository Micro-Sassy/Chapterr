import { Hono } from "hono";
import { pollApplySchema, pollCreateSchema, pollOptionsAddSchema, pollVoteSchema } from "../../shared/schemas";
import type { Page, Poll, PollOption } from "../../shared/types";
import type { Env } from "../env";
import type { AppEnv } from "../env";
import { hasRole, memberIdsOf } from "../lib/club";
import { all, bool, first, placeholders, run } from "../lib/db";
import { requireEdition } from "../lib/editions";
import { ApiError, badRequest, forbidden, notFound } from "../lib/errors";
import { parseBody, parseWith } from "../lib/http";
import { mapEditionOrNull, mapMember, mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { notifyUsers } from "../lib/notify";
import { makePage, pageQuery, timeCursor } from "../lib/paging";
import { safeZone } from "../lib/recurrence";
import { newId, nowIso } from "../lib/util";
import { enforceRateLimit } from "../security/rate-limit";

/**
 * Polls (docs/FEATURES-2.md §2): next book, meeting dates, anything.
 * Mounted at /api/clubs/:clubId/polls behind requireClubMember.
 */
export const pollRoutes = new Hono<AppEnv>();

const POLL_RATE = { window: 3600, max: 20 };

/**
 * System notices (cron) have no acting member. notifyUsers excludes the actor
 * from the recipients and looks the actor up by id, both of which are no-ops
 * for null; the notifications.actor_id column is nullable.
 */
const SYSTEM_ACTOR = null as unknown as string;

const POLL_SELECT = `SELECT p.id, p.club_id, p.kind, p.title, p.description, p.status, p.closes_at, p.allow_multiple, p.anonymous, p.allow_member_options,
  p.meeting_id, p.year, p.winner_option_id, p.applied_at, p.version, p.created_at, p.updated_at, p.created_by, ${memberCols("cu", "cu_")}
  FROM polls p LEFT JOIN "user" cu ON cu.id = p.created_by`;

const OPTION_SELECT = `SELECT o.id, o.poll_id, o.position, o.label, o.starts_at, o.ends_at, o.created_at, e.id AS e_id, e.book_id AS e_book_id, e.title AS e_title, e.subtitle AS e_subtitle,
  e.authors AS e_authors, e.cover_url AS e_cover_url, e.isbn13 AS e_isbn13, e.published_year AS e_published_year, e.format AS e_format, e.page_count AS e_page_count
  FROM poll_options o LEFT JOIN book_editions e ON e.id = o.edition_id`;

async function loadPolls(db: D1Database, clubId: string, where: string, params: (string | number)[], viewerId: string, limit = 50): Promise<Poll[]> {
  const rows = await all<Row>(db, `${POLL_SELECT} WHERE p.club_id = ? AND (${where}) ORDER BY p.created_at DESC LIMIT ${limit}`, clubId, ...params);
  if (rows.length === 0) return [];
  const pollIds = rows.map((r) => String(r.id));
  const [options, votes] = await Promise.all([
    all<Row>(db, `${OPTION_SELECT} WHERE o.poll_id IN (${placeholders(pollIds.length)}) ORDER BY o.position, o.created_at`, ...pollIds),
    all<Row>(
      db,
      `SELECT v.poll_id, v.option_id, v.user_id, ${memberCols("u", "m_")} FROM poll_votes v JOIN "user" u ON u.id = v.user_id WHERE v.poll_id IN (${placeholders(pollIds.length)}) ORDER BY v.created_at`,
      ...pollIds,
    ),
  ]);
  return rows.map((r) => {
    const id = String(r.id);
    const anonymous = bool(r.anonymous);
    const pollVotes = votes.filter((v) => v.poll_id === id);
    const opts: PollOption[] = options
      .filter((o) => o.poll_id === id)
      .map((o) => {
        const forOption = pollVotes.filter((v) => v.option_id === o.id);
        return {
          id: String(o.id),
          position: Number(o.position),
          label: String(o.label),
          edition: mapEditionOrNull(o, "e_"),
          startsAt: (o.starts_at as string | null) ?? null,
          endsAt: (o.ends_at as string | null) ?? null,
          votes: forOption.length,
          voters: anonymous ? [] : forOption.map((v) => mapMember(v, "m_")),
          mine: forOption.some((v) => v.user_id === viewerId),
        };
      });
    return {
      id,
      clubId: String(r.club_id),
      kind: r.kind as Poll["kind"],
      title: String(r.title),
      description: (r.description as string | null) ?? null,
      status: r.status as Poll["status"],
      closesAt: (r.closes_at as string | null) ?? null,
      allowMultiple: bool(r.allow_multiple),
      anonymous,
      allowMemberOptions: bool(r.allow_member_options),
      meetingId: (r.meeting_id as string | null) ?? null,
      year: r.year === null || r.year === undefined ? null : Number(r.year),
      options: opts,
      totalVoters: new Set(pollVotes.map((v) => String(v.user_id))).size,
      winnerOptionId: (r.winner_option_id as string | null) ?? null,
      appliedAt: (r.applied_at as string | null) ?? null,
      createdBy: mapMemberOrNull(r, "cu_"),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      version: Number(r.version),
    };
  });
}

async function requirePoll(db: D1Database, clubId: string, id: string, viewerId: string): Promise<Poll> {
  const [poll] = await loadPolls(db, clubId, "p.id = ? AND p.archived_at IS NULL", [id], viewerId, 1);
  if (!poll) throw notFound("Poll not found");
  return poll;
}

/** Most votes wins; ties go to the earliest option. Null when nobody voted. */
export function pollWinner(poll: Pick<Poll, "options">): string | null {
  let best: PollOption | null = null;
  for (const o of [...poll.options].sort((a, b) => a.position - b.position)) {
    if (o.votes > 0 && (!best || o.votes > best.votes)) best = o;
  }
  return best?.id ?? null;
}

async function insertOptions(db: D1Database, pollId: string, startPosition: number, options: { label: string; editionId: string | null; startsAt: string | null; endsAt: string | null }[], userId: string) {
  const now = nowIso();
  await db.batch(
    options.map((o, i) =>
      db
        .prepare("INSERT INTO poll_options (id, poll_id, position, label, edition_id, starts_at, ends_at, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(newId(), pollId, startPosition + i, o.label, o.editionId, o.startsAt ? new Date(o.startsAt).toISOString() : null, o.endsAt ? new Date(o.endsAt).toISOString() : null, userId, now),
    ),
  );
}

async function validateOptions(db: D1Database, kind: Poll["kind"], options: { label: string; editionId: string | null; startsAt: string | null }[]) {
  if (kind === "book") {
    for (const [i, o] of options.entries()) {
      if (!o.editionId) throw badRequest("Book polls need a book for every option", { [`options.${i}.editionId`]: ["Choose a book"] });
      await requireEdition(db, o.editionId);
    }
  }
  if (kind === "date") {
    for (const [i, o] of options.entries()) {
      if (!o.startsAt) throw badRequest("Date polls need a date and time for every option", { [`options.${i}.startsAt`]: ["Choose a date"] });
    }
  }
}

function assertOpen(poll: Poll) {
  if (poll.status !== "open") throw new ApiError(409, "poll_closed", "This poll is closed");
  if (poll.closesAt && Date.parse(poll.closesAt) <= Date.now()) throw new ApiError(409, "poll_closed", "This poll has closed");
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

pollRoutes.get("/", async (c) => {
  const clubId = c.get("club").id;
  const viewer = c.get("user").id;
  const status = c.req.query("status");
  const { cursor, limit } = pageQuery(c);
  const clauses = ["p.archived_at IS NULL"];
  const params: string[] = [];
  if (status === "open" || status === "closed") {
    clauses.push("p.status = ?");
    params.push(status);
  }
  const after = timeCursor(cursor);
  if (after) {
    clauses.push("p.created_at < ?");
    params.push(after);
  }
  const rows = await loadPolls(c.env.DB, clubId, clauses.join(" AND "), params, viewer, limit + 1);
  const page: Page<Poll> = makePage(rows, limit, (p) => p.createdAt);
  return c.json(page);
});

pollRoutes.get("/:id", async (c) => {
  return c.json(await requirePoll(c.env.DB, c.get("club").id, c.req.param("id"), c.get("user").id));
});

pollRoutes.post("/", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  await enforceRateLimit(c.env, "polls", user.id, POLL_RATE);
  const input = await parseBody(c, pollCreateSchema);
  await validateOptions(c.env.DB, input.kind, input.options);
  if (input.closesAt && Date.parse(input.closesAt) <= Date.now()) throw badRequest("The closing time must be in the future", { closesAt: ["Must be in the future"] });
  if (input.meetingId) {
    const m = await first<{ id: string }>(c.env.DB, "SELECT id FROM club_meetings WHERE id = ? AND club_id = ?", input.meetingId, club.id);
    if (!m) throw notFound("Meeting not found");
  }
  const id = newId();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO polls (id, club_id, kind, title, description, status, closes_at, allow_multiple, anonymous, allow_member_options, meeting_id, year, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    club.id,
    input.kind,
    input.title,
    input.description,
    input.closesAt ? new Date(input.closesAt).toISOString() : null,
    input.allowMultiple ? 1 : 0,
    input.anonymous ? 1 : 0,
    input.allowMemberOptions ? 1 : 0,
    input.kind === "date" ? input.meetingId : null,
    input.kind === "book" ? input.year : null,
    user.id,
    user.id,
    now,
    now,
  );
  await insertOptions(c.env.DB, id, 0, input.options, user.id);
  const poll = await requirePoll(c.env.DB, club.id, id, user.id);
  c.executionCtx.waitUntil(
    notifyUsers(c.env, "club", {
      kind: "poll_opened",
      clubId: club.id,
      title: `New poll: ${poll.title}`,
      body: poll.closesAt ? `Voting closes ${new Date(poll.closesAt).toUTCString()}` : `${poll.options.length} options`,
      link: `/c/${club.id}/polls/${id}`,
      actorId: user.id,
    }),
  );
  return c.json(poll, 201);
});

pollRoutes.post("/:id/options", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  await enforceRateLimit(c.env, "polls", user.id, POLL_RATE);
  const poll = await requirePoll(c.env.DB, clubId, c.req.param("id"), user.id);
  assertOpen(poll);
  const privileged = hasRole(c.get("membership").role, "admin") || poll.createdBy?.id === user.id;
  if (!poll.allowMemberOptions && !privileged) throw forbidden("Only the poll's creator or an admin can add options to this poll");
  const input = await parseBody(c, pollOptionsAddSchema);
  if (poll.options.length + input.options.length > 20) throw new ApiError(409, "too_many_options", "A poll can have at most 20 options");
  await validateOptions(c.env.DB, poll.kind, input.options);
  await insertOptions(c.env.DB, poll.id, poll.options.length, input.options, user.id);
  await run(c.env.DB, "UPDATE polls SET version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?", user.id, nowIso(), poll.id);
  return c.json(await requirePoll(c.env.DB, clubId, poll.id, user.id), 201);
});

/** Replaces the caller's votes. Single-choice polls accept one option; approval polls any number. */
pollRoutes.put("/:id/vote", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  await enforceRateLimit(c.env, "polls", user.id, POLL_RATE);
  const poll = await requirePoll(c.env.DB, clubId, c.req.param("id"), user.id);
  assertOpen(poll);
  const input = await parseBody(c, pollVoteSchema);
  const ids = Array.from(new Set(input.optionIds));
  if (!poll.allowMultiple && ids.length > 1) throw badRequest("This poll allows one choice", { optionIds: ["Choose one option"] });
  const valid = new Set(poll.options.map((o) => o.id));
  for (const id of ids) if (!valid.has(id)) throw badRequest("Unknown option", { optionIds: ["Unknown option"] });
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?").bind(poll.id, user.id),
    ...ids.map((optionId) => c.env.DB.prepare("INSERT INTO poll_votes (poll_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?)").bind(poll.id, optionId, user.id, now)),
  ]);
  return c.json(await requirePoll(c.env.DB, clubId, poll.id, user.id));
});

async function closePoll(db: D1Database, poll: Poll, byUserId: string | null): Promise<string | null> {
  const winner = pollWinner(poll);
  await run(
    db,
    "UPDATE polls SET status = 'closed', winner_option_id = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND club_id = ? AND status = 'open'",
    winner,
    byUserId,
    nowIso(),
    poll.id,
    poll.clubId,
  );
  return winner;
}

pollRoutes.post("/:id/close", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const poll = await requirePoll(c.env.DB, clubId, c.req.param("id"), user.id);
  if (!hasRole(c.get("membership").role, "admin") && poll.createdBy?.id !== user.id) throw forbidden("Only the poll's creator or an admin can close it");
  if (poll.status === "open") {
    await closePoll(c.env.DB, poll, user.id);
    const closed = await requirePoll(c.env.DB, clubId, poll.id, user.id);
    const winner = closed.options.find((o) => o.id === closed.winnerOptionId);
    c.executionCtx.waitUntil(
      notifyUsers(c.env, "club", {
        kind: "poll_closed",
        clubId,
        title: `Poll closed: ${poll.title}`,
        body: winner ? `Winner: ${winner.label}` : "No votes were cast",
        link: `/c/${clubId}/polls/${poll.id}`,
        actorId: user.id,
      }),
    );
    return c.json(closed);
  }
  return c.json(poll);
});

pollRoutes.post("/:id/apply", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  if (!hasRole(c.get("membership").role, "admin")) throw forbidden("Only club admins can apply a poll result");
  let poll = await requirePoll(c.env.DB, club.id, c.req.param("id"), user.id);
  // The body is optional: an empty request applies the result with the poll's own year/title.
  const raw = await c.req.text();
  const input = raw.trim() ? parseWith(pollApplySchema, JSON.parse(raw) as unknown) : { year: null, title: null };
  if (poll.appliedAt) throw new ApiError(409, "already_applied", "This poll's result has already been applied", { current: poll });
  if (poll.status === "open") {
    await closePoll(c.env.DB, poll, user.id);
    poll = await requirePoll(c.env.DB, club.id, poll.id, user.id);
  }
  const winner = poll.options.find((o) => o.id === poll.winnerOptionId);
  if (!winner) throw new ApiError(409, "no_votes", "Nobody voted, so there is no result to apply");
  const now = nowIso();
  let link = `/c/${club.id}/polls/${poll.id}`;
  let title = `Poll result applied: ${poll.title}`;
  let body: string | null = winner.label;
  let kind: "poll_closed" | "club_meeting" = "poll_closed";

  if (poll.kind === "book") {
    if (!winner.edition) throw new ApiError(409, "no_edition", "The winning option has no book attached");
    const year = input.year ?? poll.year ?? new Date().getUTCFullYear();
    const dup = await first<{ id: string }>(
      c.env.DB,
      "SELECT id FROM club_annual_books WHERE club_id = ? AND year = ? AND edition_id = ? AND archived_at IS NULL",
      club.id,
      year,
      winner.edition.id,
    );
    if (!dup) {
      const max = await first<{ p: number | null }>(c.env.DB, "SELECT MAX(position) AS p FROM club_annual_books WHERE club_id = ? AND year = ?", club.id, year);
      await run(
        c.env.DB,
        `INSERT INTO club_annual_books (id, club_id, year, edition_id, position, status, completed_at, note, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'planned', NULL, ?, ?, ?, ?, ?)`,
        newId(),
        club.id,
        year,
        winner.edition.id,
        (max?.p ?? -1) + 1,
        `Chosen by poll: ${poll.title}`,
        user.id,
        user.id,
        now,
        now,
      );
    }
    title = `Next book: ${winner.edition.title}`;
    body = `Added to the ${year} list from the poll "${poll.title}"`;
    link = `/c/${club.id}`;
    await run(c.env.DB, "UPDATE polls SET applied_at = ?, year = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?", now, year, user.id, now, poll.id);
  } else if (poll.kind === "date") {
    if (!winner.startsAt) throw new ApiError(409, "no_date", "The winning option has no date attached");
    const zone = safeZone((await first<{ timezone: string }>(c.env.DB, "SELECT timezone FROM clubs WHERE id = ?", club.id))?.timezone, "America/Chicago");
    let meetingId = poll.meetingId;
    const existing = meetingId ? await first<{ id: string }>(c.env.DB, "SELECT id FROM club_meetings WHERE id = ? AND club_id = ?", meetingId, club.id) : null;
    if (existing) {
      await run(
        c.env.DB,
        "UPDATE club_meetings SET starts_at = ?, ends_at = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND club_id = ?",
        winner.startsAt,
        winner.endsAt,
        user.id,
        now,
        existing.id,
        club.id,
      );
    } else {
      meetingId = newId();
      await run(
        c.env.DB,
        `INSERT INTO club_meetings (id, club_id, title, starts_at, ends_at, details, timezone, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        meetingId,
        club.id,
        input.title ?? poll.title,
        winner.startsAt,
        winner.endsAt,
        poll.description,
        zone,
        user.id,
        user.id,
        now,
        now,
      );
    }
    kind = "club_meeting";
    title = existing ? `Meeting rescheduled: ${input.title ?? poll.title}` : `Meeting scheduled: ${input.title ?? poll.title}`;
    body = `Chosen by poll: ${winner.label}`;
    link = `/c/${club.id}/meetings/${meetingId}`;
    await run(c.env.DB, "UPDATE polls SET applied_at = ?, meeting_id = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?", now, meetingId, user.id, now, poll.id);
  } else {
    await run(c.env.DB, "UPDATE polls SET applied_at = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?", now, user.id, now, poll.id);
  }
  c.executionCtx.waitUntil(notifyUsers(c.env, "club", { kind, clubId: club.id, title, body, link, actorId: user.id }));
  return c.json(await requirePoll(c.env.DB, club.id, poll.id, user.id));
});

pollRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const poll = await requirePoll(c.env.DB, clubId, c.req.param("id"), user.id);
  if (!hasRole(c.get("membership").role, "admin") && poll.createdBy?.id !== user.id) throw forbidden("Only the poll's creator or an admin can remove it");
  await run(c.env.DB, "UPDATE polls SET archived_at = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND club_id = ?", nowIso(), user.id, nowIso(), poll.id, clubId);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Cron: close polls past their closing time (called from runMeetingReminders)
// ---------------------------------------------------------------------------

export async function closeExpiredPolls(env: Env, now: Date): Promise<number> {
  const due = await all<{ id: string; club_id: string }>(
    env.DB,
    "SELECT p.id, p.club_id FROM polls p JOIN clubs c ON c.id = p.club_id AND c.archived_at IS NULL WHERE p.status = 'open' AND p.archived_at IS NULL AND p.closes_at IS NOT NULL AND p.closes_at <= ? LIMIT 200",
    now.toISOString(),
  );
  let closed = 0;
  for (const row of due) {
    const [poll] = await loadPolls(env.DB, row.club_id, "p.id = ?", [row.id], "", 1);
    if (!poll) continue;
    await closePoll(env.DB, poll, null);
    closed++;
    const winner = poll.options.find((o) => o.id === pollWinner(poll));
    const recipients = await memberIdsOf(env.DB, row.club_id);
    await notifyUsers(env, recipients, {
      kind: "poll_closed",
      clubId: row.club_id,
      title: `Poll closed: ${poll.title}`,
      body: winner ? `Winner: ${winner.label}` : "No votes were cast",
      link: `/c/${row.club_id}/polls/${poll.id}`,
      actorId: SYSTEM_ACTOR,
    }).catch((err) => console.error("poll_closed notification failed", err instanceof Error ? err.message : err));
  }
  return closed;
}
