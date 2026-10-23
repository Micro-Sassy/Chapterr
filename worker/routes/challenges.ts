import { Hono } from "hono";
import type { ChallengeKind } from "../../shared/constants";
import { challengeProgressSchema, challengeSchema, challengeUpdateSchema, idSchema } from "../../shared/schemas";
import type { Challenge, ChallengeParticipant } from "../../shared/types";
import type { AppEnv, Env } from "../env";
import { hasRole } from "../lib/club";
import { all, first, placeholders, run } from "../lib/db";
import { ApiError, badRequest, forbidden, notFound } from "../lib/errors";
import { parseBody, parseWith } from "../lib/http";
import { mapMember, mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { notifyUsers, type WaitUntil } from "../lib/notify";
import { longestStreakWithin } from "../lib/streaks";
import { newId, nowIso } from "../lib/util";
import { updateVersioned } from "../lib/versioned";

/**
 * Reading challenges. Personal challenges (/api/challenges) belong to one
 * member; club challenges (/api/clubs/:clubId/challenges) can be joined by
 * any member and show a leaderboard. Progress is computed from the member's
 * library, reading log and streaks; "custom" challenges track manual progress.
 */
export const clubChallengeRoutes = new Hono<AppEnv>();
export const challengeRoutes = new Hono<AppEnv>();

interface ChallengeRow extends Row {
  id: string;
  club_id: string | null;
  owner_id: string;
  title: string;
  description: string | null;
  kind: ChallengeKind;
  target: number;
  genre_id: string | null;
  starts_on: string;
  ends_on: string;
  version: number;
  created_at: string;
}

interface ParticipantRow extends Row {
  challenge_id: string;
  user_id: string;
  manual_progress: number;
  completed_at: string | null;
}

const CHALLENGE_SELECT = `SELECT ch.id, ch.club_id, ch.owner_id, ch.title, ch.description, ch.kind, ch.target, ch.genre_id, ch.starts_on, ch.ends_on,
    ch.version, ch.created_at, ${memberCols("o", "o_")}
  FROM challenges ch LEFT JOIN "user" o ON o.id = ch.owner_id`;

// --- Progress --------------------------------------------------------------------------

/** Progress of each participant toward one challenge, computed in a handful of grouped queries. */
async function computeProgress(db: D1Database, ch: ChallengeRow, participants: ParticipantRow[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = participants.map((p) => p.user_id);
  if (ids.length === 0) return out;
  const ph = placeholders(ids.length);
  switch (ch.kind) {
    case "custom":
      for (const p of participants) out.set(p.user_id, Number(p.manual_progress));
      break;
    case "books": {
      const rows = await all<{ user_id: string; n: number }>(
        db,
        `SELECT user_id, COUNT(*) AS n FROM user_books WHERE user_id IN (${ph}) AND status = 'finished'
           AND substr(finished_at, 1, 10) BETWEEN ? AND ? GROUP BY user_id`,
        ...ids,
        ch.starts_on,
        ch.ends_on,
      );
      for (const r of rows) out.set(r.user_id, Number(r.n));
      break;
    }
    case "pages": {
      const rows = await all<{ user_id: string; n: number }>(
        db,
        `SELECT user_id, SUM(pages) AS n FROM reading_log WHERE user_id IN (${ph}) AND day BETWEEN ? AND ? GROUP BY user_id`,
        ...ids,
        ch.starts_on,
        ch.ends_on,
      );
      for (const r of rows) out.set(r.user_id, Number(r.n ?? 0));
      break;
    }
    case "genre": {
      if (!ch.genre_id) break;
      const rows = await all<{ user_id: string; n: number }>(
        db,
        `SELECT ub.user_id, COUNT(DISTINCT e.book_id) AS n FROM user_books ub JOIN book_editions e ON e.id = ub.edition_id
          WHERE ub.user_id IN (${ph}) AND ub.status = 'finished' AND substr(ub.finished_at, 1, 10) BETWEEN ? AND ?
            AND EXISTS (SELECT 1 FROM book_genres bg WHERE bg.book_id = e.book_id AND bg.genre_id = ?)
          GROUP BY ub.user_id`,
        ...ids,
        ch.starts_on,
        ch.ends_on,
        ch.genre_id,
      );
      for (const r of rows) out.set(r.user_id, Number(r.n));
      break;
    }
    case "streak": {
      const rows = await all<{ user_id: string; day: string }>(
        db,
        `SELECT user_id, day FROM reading_log WHERE user_id IN (${ph}) AND (pages > 0 OR minutes > 0) AND day BETWEEN ? AND ? ORDER BY user_id, day`,
        ...ids,
        ch.starts_on,
        ch.ends_on,
      );
      const byUser = new Map<string, string[]>();
      for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.day]);
      for (const [u, days] of byUser) out.set(u, longestStreakWithin(days, ch.starts_on, ch.ends_on));
      break;
    }
  }
  for (const id of ids) if (!out.has(id)) out.set(id, 0);
  return out;
}

/**
 * Load challenges with participants and progress. Marks newly completed
 * participants (completed_at) and, for club challenges, tells the club.
 */
async function loadChallenges(env: Env, viewerId: string, where: string, params: (string | number | null)[], ctx?: WaitUntil): Promise<Challenge[]> {
  const rows = await all<ChallengeRow>(env.DB, `${CHALLENGE_SELECT} WHERE ch.archived_at IS NULL AND (${where}) ORDER BY ch.ends_on, ch.created_at`, ...params);
  if (rows.length === 0) return [];
  const parts = await all<ParticipantRow>(
    env.DB,
    `SELECT p.challenge_id, p.user_id, p.manual_progress, p.completed_at, ${memberCols("u", "u_")}
       FROM challenge_participants p JOIN "user" u ON u.id = p.user_id WHERE p.challenge_id IN (${placeholders(rows.length)}) ORDER BY p.joined_at`,
    ...rows.map((r) => r.id),
  );
  const now = nowIso();
  const completions: D1PreparedStatement[] = [];
  const notices: Promise<unknown>[] = [];
  const result: Challenge[] = [];
  for (const ch of rows) {
    const mine = parts.filter((p) => p.challenge_id === ch.id);
    const progress = await computeProgress(env.DB, ch, mine);
    const participants: ChallengeParticipant[] = mine.map((p) => {
      const value = progress.get(p.user_id) ?? 0;
      let completedAt = p.completed_at;
      if (!completedAt && value >= Number(ch.target)) {
        completedAt = now;
        completions.push(env.DB.prepare("UPDATE challenge_participants SET completed_at = ? WHERE challenge_id = ? AND user_id = ? AND completed_at IS NULL").bind(now, ch.id, p.user_id));
        if (ch.club_id) {
          notices.push(
            notifyUsers(env, "club", {
              kind: "challenge_update",
              clubId: ch.club_id,
              title: `${String(p.u_name ?? "A member")} completed “${ch.title}”`,
              link: `/c/${ch.club_id}/challenges`,
              actorId: p.user_id,
            }),
          );
        }
      }
      return { ...mapMember(p, "u_"), progress: value, completedAt };
    });
    participants.sort((a, b) => b.progress - a.progress || (a.completedAt ?? "9").localeCompare(b.completedAt ?? "9") || a.displayName.localeCompare(b.displayName));
    const me = participants.find((p) => p.id === viewerId);
    result.push({
      id: ch.id,
      clubId: ch.club_id,
      owner: mapMemberOrNull(ch, "o_"),
      title: ch.title,
      description: ch.description,
      kind: ch.kind,
      target: Number(ch.target),
      genreId: ch.genre_id,
      startsOn: ch.starts_on,
      endsOn: ch.ends_on,
      joined: !!me,
      myProgress: me?.progress ?? 0,
      participants,
      version: Number(ch.version),
      createdAt: ch.created_at,
    });
  }
  if (completions.length) {
    const work = (async () => {
      await env.DB.batch(completions);
      await Promise.allSettled(notices);
    })();
    if (ctx) ctx.waitUntil(work);
    else await work.catch((err: unknown) => console.error("challenge completion failed", err instanceof Error ? err.message : err));
  }
  return result;
}

async function loadOne(env: Env, viewerId: string, id: string, clubId: string | null, ctx?: WaitUntil): Promise<Challenge> {
  const [ch] = await loadChallenges(env, viewerId, clubId ? "ch.id = ? AND ch.club_id = ?" : "ch.id = ? AND ch.club_id IS NULL AND ch.owner_id = ?", [id, clubId ?? viewerId], ctx);
  if (!ch) throw notFound("Challenge not found");
  return ch;
}

async function validateGenre(env: Env, input: { kind: ChallengeKind; genreId: string | null }, clubId: string | null, userId: string): Promise<void> {
  if (input.kind === "genre") {
    if (!input.genreId) throw badRequest("Pick a genre for a genre challenge", { genreId: ["Required"] });
    // The genre must belong to this club, or (personal) to a club the member belongs to.
    const ok = clubId
      ? await first(env.DB, "SELECT 1 FROM genres WHERE id = ? AND club_id = ? AND archived_at IS NULL", input.genreId, clubId)
      : await first(env.DB, "SELECT 1 FROM genres g JOIN club_members m ON m.club_id = g.club_id AND m.user_id = ? WHERE g.id = ? AND g.archived_at IS NULL", userId, input.genreId);
    if (!ok) throw notFound("Genre not found");
  }
}

async function insertChallenge(env: Env, clubId: string | null, ownerId: string, input: ReturnType<typeof challengeSchema.parse>): Promise<string> {
  const id = newId();
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO challenges (id, club_id, owner_id, title, description, kind, target, genre_id, starts_on, ends_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, clubId, ownerId, input.title, input.description, input.kind, input.target, input.kind === "genre" ? input.genreId : null, input.startsOn, input.endsOn, now, now),
    env.DB.prepare("INSERT INTO challenge_participants (challenge_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, ownerId, now),
  ]);
  return id;
}

async function updateChallenge(env: Env, id: string, userId: string, clubId: string | null, body: unknown): Promise<void> {
  const input = parseWith(challengeUpdateSchema, body);
  await validateGenre(env, input, clubId, userId);
  await updateVersioned({
    db: env.DB,
    table: "challenges",
    id,
    expectedVersion: input.expectedVersion,
    userId,
    label: "Challenge",
    set: {
      title: input.title,
      description: input.description,
      kind: input.kind,
      target: input.target,
      genre_id: input.kind === "genre" ? input.genreId : null,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
    },
    where: clubId ? { club_id: clubId } : { owner_id: userId },
    load: () => first(env.DB, "SELECT id FROM challenges WHERE id = ? AND archived_at IS NULL", id),
  });
  // Targets may have changed: let completion be re-evaluated.
  await run(env.DB, "UPDATE challenge_participants SET completed_at = NULL WHERE challenge_id = ?", id);
}

// --- Personal ----------------------------------------------------------------------------

challengeRoutes.get("/", async (c) => {
  const user = c.get("user");
  return c.json(await loadChallenges(c.env, user.id, "ch.club_id IS NULL AND ch.owner_id = ?", [user.id], c.executionCtx));
});

challengeRoutes.post("/", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, challengeSchema);
  await validateGenre(c.env, input, null, user.id);
  const count = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM challenges WHERE owner_id = ? AND club_id IS NULL AND archived_at IS NULL", user.id);
  if (Number(count?.n ?? 0) >= 20) throw new ApiError(409, "limit_reached", "You can have up to 20 personal challenges. Archive one first.");
  const id = await insertChallenge(c.env, null, user.id, input);
  return c.json(await loadOne(c.env, user.id, id, null), 201);
});

challengeRoutes.get("/:id", async (c) => c.json(await loadOne(c.env, c.get("user").id, parseWith(idSchema, c.req.param("id")), null, c.executionCtx)));

challengeRoutes.put("/:id", async (c) => {
  const user = c.get("user");
  const id = parseWith(idSchema, c.req.param("id"));
  await loadOne(c.env, user.id, id, null);
  await updateChallenge(c.env, id, user.id, null, await c.req.json().catch(() => ({})));
  return c.json(await loadOne(c.env, user.id, id, null, c.executionCtx));
});

challengeRoutes.put("/:id/progress", async (c) => {
  const user = c.get("user");
  const id = parseWith(idSchema, c.req.param("id"));
  const ch = await loadOne(c.env, user.id, id, null);
  if (ch.kind !== "custom") throw badRequest("Progress on this challenge is computed from your reading");
  const { progress } = await parseBody(c, challengeProgressSchema);
  await run(c.env.DB, "UPDATE challenge_participants SET manual_progress = ?, completed_at = NULL WHERE challenge_id = ? AND user_id = ?", progress, id, user.id);
  return c.json(await loadOne(c.env, user.id, id, null, c.executionCtx));
});

challengeRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = parseWith(idSchema, c.req.param("id"));
  const res = await run(c.env.DB, "UPDATE challenges SET archived_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND club_id IS NULL AND archived_at IS NULL", nowIso(), nowIso(), id, user.id);
  if (res.meta.changes === 0) throw notFound("Challenge not found");
  return c.json({ ok: true });
});

// --- Club ----------------------------------------------------------------------------------

clubChallengeRoutes.get("/", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  return c.json(await loadChallenges(c.env, user.id, "ch.club_id = ?", [club.id], c.executionCtx));
});

clubChallengeRoutes.post("/", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const input = await parseBody(c, challengeSchema);
  await validateGenre(c.env, input, club.id, user.id);
  const count = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM challenges WHERE club_id = ? AND archived_at IS NULL", club.id);
  if (Number(count?.n ?? 0) >= 30) throw new ApiError(409, "limit_reached", "This club already has 30 challenges. Archive one first.");
  const id = await insertChallenge(c.env, club.id, user.id, input);
  c.executionCtx.waitUntil(
    notifyUsers(c.env, "club", {
      kind: "challenge_update",
      clubId: club.id,
      title: `New challenge: ${input.title}`,
      body: `${user.name} started a club challenge. Join in from the Challenges page.`,
      link: `/c/${club.id}/challenges`,
      actorId: user.id,
    }),
  );
  return c.json(await loadOne(c.env, user.id, id, club.id), 201);
});

clubChallengeRoutes.get("/:id", async (c) =>
  c.json(await loadOne(c.env, c.get("user").id, parseWith(idSchema, c.req.param("id")), c.get("club").id, c.executionCtx)),
);

function canManage(c: { get(key: "user"): { id: string }; get(key: "membership"): { role: "owner" | "admin" | "member" } }, ownerId: string | null): boolean {
  return ownerId === c.get("user").id || hasRole(c.get("membership").role, "admin");
}

clubChallengeRoutes.put("/:id", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const id = parseWith(idSchema, c.req.param("id"));
  const existing = await loadOne(c.env, user.id, id, club.id);
  if (!canManage(c, existing.owner?.id ?? null)) throw forbidden("Only the challenge's creator or a club admin can edit it");
  await updateChallenge(c.env, id, user.id, club.id, await c.req.json().catch(() => ({})));
  return c.json(await loadOne(c.env, user.id, id, club.id, c.executionCtx));
});

clubChallengeRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const id = parseWith(idSchema, c.req.param("id"));
  const existing = await loadOne(c.env, user.id, id, club.id);
  if (!canManage(c, existing.owner?.id ?? null)) throw forbidden("Only the challenge's creator or a club admin can archive it");
  await run(c.env.DB, "UPDATE challenges SET archived_at = ?, updated_at = ? WHERE id = ? AND club_id = ?", nowIso(), nowIso(), id, club.id);
  return c.json({ ok: true });
});

clubChallengeRoutes.post("/:id/join", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const id = parseWith(idSchema, c.req.param("id"));
  await loadOne(c.env, user.id, id, club.id);
  await run(c.env.DB, "INSERT OR IGNORE INTO challenge_participants (challenge_id, user_id, joined_at) VALUES (?, ?, ?)", id, user.id, nowIso());
  return c.json(await loadOne(c.env, user.id, id, club.id, c.executionCtx));
});

clubChallengeRoutes.post("/:id/leave", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const id = parseWith(idSchema, c.req.param("id"));
  await loadOne(c.env, user.id, id, club.id);
  await run(c.env.DB, "DELETE FROM challenge_participants WHERE challenge_id = ? AND user_id = ?", id, user.id);
  return c.json(await loadOne(c.env, user.id, id, club.id, c.executionCtx));
});

clubChallengeRoutes.put("/:id/progress", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const id = parseWith(idSchema, c.req.param("id"));
  const ch = await loadOne(c.env, user.id, id, club.id);
  if (ch.kind !== "custom") throw badRequest("Progress on this challenge is computed from your reading");
  if (!ch.joined) throw new ApiError(409, "not_joined", "Join the challenge first");
  const { progress } = await parseBody(c, challengeProgressSchema);
  await run(c.env.DB, "UPDATE challenge_participants SET manual_progress = ?, completed_at = NULL WHERE challenge_id = ? AND user_id = ?", progress, id, user.id);
  return c.json(await loadOne(c.env, user.id, id, club.id, c.executionCtx));
});
