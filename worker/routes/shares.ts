import { Hono } from "hono";
import { READING_STATUS_LABELS, type ReadingStatus, type ShareResourceType } from "../../shared/constants";
import { shareCreateSchema } from "../../shared/schemas";
import type { PublicEdition, PublicShare, ShareLink, ShareLinkCreated } from "../../shared/types";
import type { AppEnv, Env } from "../env";
import { all, bool, first, run } from "../lib/db";
import { badRequest, notFound } from "../lib/errors";
import { parseBody } from "../lib/http";
import { type Row } from "../lib/mappers";
import { newId, newToken, nowIso, parseJsonArray, sha256Hex } from "../lib/util";
import { enforceRateLimit } from "../security/rate-limit";
import { clientIp, requireTurnstile } from "../security/turnstile";

/**
 * Public share links. A member explicitly creates a link for one review,
 * one quote, one of their reading lists, or the club's annual list. The link
 * carries a 256-bit random token; only its SHA-256 hash is stored. Links can
 * expire and be revoked. Chats and messages are not a shareable type.
 *
 * What a share reveals is deliberately minimal: the content itself, the
 * author's display name, and public book metadata. Never emails, usernames,
 * private notes or anything marked private.
 */
export const shareRoutes = new Hono<AppEnv>();
export const publicRoutes = new Hono<AppEnv>();

function mapShare(r: Row, label: string): ShareLink {
  return {
    id: String(r.id),
    resourceType: r.resource_type as ShareResourceType,
    resourceId: (r.resource_id as string | null) ?? null,
    year: r.year === null || r.year === undefined ? null : Number(r.year),
    status: (r.status as ReadingStatus | null) ?? null,
    label,
    createdAt: String(r.created_at),
    expiresAt: (r.expires_at as string | null) ?? null,
    revokedAt: (r.revoked_at as string | null) ?? null,
    viewCount: Number(r.view_count ?? 0),
    lastViewedAt: (r.last_viewed_at as string | null) ?? null,
  };
}

async function describe(db: D1Database, r: Row): Promise<string> {
  switch (r.resource_type) {
    case "review":
    case "quote": {
      const table = r.resource_type === "review" ? "reviews" : "quotes";
      const row = await first<{ title: string }>(
        db,
        `SELECT e.title FROM ${table} t JOIN book_editions e ON e.id = t.edition_id WHERE t.id = ?`,
        String(r.resource_id),
      );
      return `${r.resource_type === "review" ? "Review" : "Quote"}: ${row?.title ?? "(deleted)"}`;
    }
    case "reading_list":
      return `My ${r.status ? READING_STATUS_LABELS[r.status as ReadingStatus].toLowerCase() : "reading"} list${r.year ? ` (${r.year})` : ""}`;
    case "club_list":
      return `Club reading list ${r.year}`;
    default:
      return "Shared item";
  }
}

shareRoutes.get("/", async (c) => {
  const user = c.get("user");
  const rows = await all<Row>(c.env.DB, "SELECT * FROM share_links WHERE created_by = ? ORDER BY created_at DESC LIMIT 200", user.id);
  const out: ShareLink[] = [];
  for (const r of rows) out.push(mapShare(r, await describe(c.env.DB, r)));
  return c.json(out);
});

shareRoutes.post("/", async (c) => {
  const user = c.get("user");
  // Link creation is abuse-sensitive (it publishes content), so it is Turnstile-protected and rate limited.
  await requireTurnstile(c.env, c.req.header("x-turnstile-token"), clientIp(c.req.raw));
  await enforceRateLimit(c.env, "share-create", user.id, { window: 60 * 60, max: 30 });
  const input = await parseBody(c, shareCreateSchema);

  let resourceId: string | null = null;
  let year: number | null = null;
  let status: ReadingStatus | null = null;
  if (input.resourceType === "review" || input.resourceType === "quote") {
    if (!input.resourceId) throw badRequest("Choose what to share");
    const table = input.resourceType === "review" ? "reviews" : "quotes";
    // Members can only publish their own reviews and quotes.
    const owned = await first<{ id: string }>(c.env.DB, `SELECT id FROM ${table} WHERE id = ? AND user_id = ?`, input.resourceId, user.id);
    if (!owned) throw notFound(`${input.resourceType === "review" ? "Review" : "Quote"} not found`);
    resourceId = owned.id;
  } else if (input.resourceType === "reading_list") {
    // A member's own list; resource_id is always the creator.
    resourceId = user.id;
    status = input.status ?? "finished";
    year = input.year;
  } else {
    // Club annual list (shared club data, any member may share it).
    if (!input.year) throw badRequest("Choose a year");
    year = input.year;
  }

  const token = newToken();
  const id = newId();
  const now = nowIso();
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000).toISOString() : null;
  await run(
    c.env.DB,
    `INSERT INTO share_links (id, token_hash, created_by, resource_type, resource_id, year, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    await sha256Hex(token),
    user.id,
    input.resourceType,
    resourceId,
    year,
    status,
    expiresAt,
    now,
  );
  const row = await first<Row>(c.env.DB, "SELECT * FROM share_links WHERE id = ?", id);
  const created: ShareLinkCreated = {
    ...mapShare(row!, await describe(c.env.DB, row!)),
    url: `${c.env.PUBLIC_APP_URL.replace(/\/+$/, "")}/s/${token}`,
  };
  return c.json(created, 201);
});

shareRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const res = await run(
    c.env.DB,
    "UPDATE share_links SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND created_by = ?",
    nowIso(),
    c.req.param("id"),
    user.id,
  );
  if (res.meta.changes === 0) throw notFound("Share link not found");
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Public (unauthenticated) read of a share link
// ---------------------------------------------------------------------------

function publicEdition(r: Row, p = "e_"): PublicEdition {
  return {
    title: String(r[`${p}title`]),
    subtitle: (r[`${p}subtitle`] as string | null) ?? null,
    authors: parseJsonArray(r[`${p}authors`]),
    coverUrl: (r[`${p}cover_url`] as string | null) ?? null,
    isbn13: (r[`${p}isbn13`] as string | null) ?? null,
    publishedYear: r[`${p}published_year`] === null ? null : Number(r[`${p}published_year`]),
  };
}

const PUB_EDITION = "e.title AS e_title, e.subtitle AS e_subtitle, e.authors AS e_authors, e.cover_url AS e_cover_url, e.isbn13 AS e_isbn13, e.published_year AS e_published_year";

export async function resolvePublicShare(env: Env, token: string): Promise<PublicShare | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const link = await first<Row>(env.DB, "SELECT * FROM share_links WHERE token_hash = ?", await sha256Hex(token));
  if (!link || link.revoked_at) return null;
  if (link.expires_at && String(link.expires_at) < nowIso()) return null;

  let share: PublicShare | null = null;
  switch (link.resource_type) {
    case "review": {
      const r = await first<Row>(
        env.DB,
        `SELECT r.body, r.sentiment, r.contains_spoilers, r.created_at, u.name AS author, ${PUB_EDITION}
         FROM reviews r JOIN "user" u ON u.id = r.user_id JOIN book_editions e ON e.id = r.edition_id
         WHERE r.id = ? AND r.user_id = ?`,
        String(link.resource_id),
        String(link.created_by),
      );
      if (r)
        share = {
          type: "review",
          author: String(r.author),
          edition: publicEdition(r),
          body: String(r.body),
          sentiment: r.sentiment as never,
          containsSpoilers: bool(r.contains_spoilers),
          createdAt: String(r.created_at),
        };
      break;
    }
    case "quote": {
      const r = await first<Row>(
        env.DB,
        `SELECT q.text, q.location, q.created_at, u.name AS author, ${PUB_EDITION}
         FROM quotes q JOIN "user" u ON u.id = q.user_id JOIN book_editions e ON e.id = q.edition_id
         WHERE q.id = ? AND q.user_id = ?`,
        String(link.resource_id),
        String(link.created_by),
      );
      if (r)
        share = {
          type: "quote",
          author: String(r.author),
          edition: publicEdition(r),
          text: String(r.text),
          location: (r.location as string | null) ?? null,
          createdAt: String(r.created_at),
        };
      break;
    }
    case "reading_list": {
      const owner = await first<{ name: string }>(env.DB, 'SELECT name FROM "user" WHERE id = ?', String(link.created_by));
      if (!owner) break;
      const status = (link.status as ReadingStatus | null) ?? "finished";
      const year = link.year ? String(link.year) : null;
      // Only items the member marked as club-visible are ever included; private items stay private.
      const rows = await all<Row>(
        env.DB,
        `SELECT ub.status, ub.finished_at, ${PUB_EDITION} FROM user_books ub JOIN book_editions e ON e.id = ub.edition_id
         WHERE ub.user_id = ? AND ub.status = ? AND ub.visibility = 'club' ${year ? "AND substr(ub.finished_at, 1, 4) = ?" : ""}
         ORDER BY COALESCE(ub.finished_at, ub.updated_at) DESC LIMIT 500`,
        ...(year ? [String(link.created_by), status, year] : [String(link.created_by), status]),
      );
      share = {
        type: "reading_list",
        owner: owner.name,
        title: `${READING_STATUS_LABELS[status]}${year ? ` in ${year}` : ""}`,
        items: rows.map((r) => ({ edition: publicEdition(r), status: r.status as ReadingStatus, finishedAt: (r.finished_at as string | null) ?? null })),
      };
      break;
    }
    case "club_list": {
      const year = Number(link.year);
      const goal = await first<{ target: number }>(env.DB, "SELECT target FROM club_annual_goals WHERE year = ?", year);
      const rows = await all<Row>(
        env.DB,
        `SELECT b.status, b.position, ${PUB_EDITION} FROM club_annual_books b JOIN book_editions e ON e.id = b.edition_id
         WHERE b.year = ? AND b.archived_at IS NULL ORDER BY b.position`,
        year,
      );
      share = {
        type: "club_list",
        title: `Teel Ridge Book Club — ${year} reading list`,
        year,
        goal: goal ? Number(goal.target) : null,
        items: rows.map((r) => ({ edition: publicEdition(r), status: r.status as never, position: Number(r.position) })),
      };
      break;
    }
  }
  if (share) {
    await run(env.DB, "UPDATE share_links SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?", nowIso(), String(link.id)).catch(
      () => undefined,
    );
  }
  return share;
}

publicRoutes.get("/shares/:token", async (c) => {
  // Public endpoint: rate limited per IP to slow token guessing and scraping.
  await enforceRateLimit(c.env, "public-share", clientIp(c.req.raw) ?? "unknown", { window: 60, max: 60 });
  const share = await resolvePublicShare(c.env, c.req.param("token"));
  if (!share) throw notFound("This link is invalid, has expired, or was turned off by its owner.");
  c.header("Cache-Control", "no-store");
  return c.json(share);
});
