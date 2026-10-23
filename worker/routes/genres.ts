import { Hono } from "hono";
import { bookGenresSchema, genreSchema, genreUpdateSchema, versionSchema } from "../../shared/schemas";
import type { Genre } from "../../shared/types";
import type { AppEnv } from "../env";
import { all, first, placeholders, run } from "../lib/db";
import { genresForBookInClub } from "../lib/editions";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { parseBody } from "../lib/http";
import { editionCols, mapEdition, type Row } from "../lib/mappers";
import { newId, nowIso, slugify } from "../lib/util";
import { updateVersioned } from "../lib/versioned";

/**
 * Club genres/tags, mounted at /api/clubs/:clubId/genres (plus
 * PUT /api/clubs/:clubId/works/:bookId/genres). Each club curates its own
 * labels; any member can create, rename, archive and restore them.
 */
export const genreRoutes = new Hono<AppEnv>();
export const bookGenreRoutes = new Hono<AppEnv>();

function mapGenre(r: Row): Genre {
  return {
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    version: Number(r.version),
    archivedAt: (r.archived_at as string | null) ?? null,
    bookCount: r.book_count === undefined ? undefined : Number(r.book_count),
    clubId: String(r.club_id),
  };
}

const GENRE_SELECT = "SELECT g.*, (SELECT COUNT(*) FROM book_genres bg WHERE bg.genre_id = g.id) AS book_count FROM genres g";

async function loadGenre(db: D1Database, clubId: string, id: string): Promise<Genre | null> {
  const r = await first<Row>(db, `${GENRE_SELECT} WHERE g.club_id = ? AND g.id = ?`, clubId, id);
  return r ? mapGenre(r) : null;
}

genreRoutes.get("/", async (c) => {
  const includeArchived = c.req.query("archived") === "1";
  const rows = await all<Row>(
    c.env.DB,
    `${GENRE_SELECT} WHERE g.club_id = ? ${includeArchived ? "" : "AND g.archived_at IS NULL"} ORDER BY g.name COLLATE NOCASE`,
    c.get("club").id,
  );
  return c.json(rows.map(mapGenre));
});

genreRoutes.post("/", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const { name } = await parseBody(c, genreSchema);
  const slug = slugify(name);
  if (!slug) throw badRequest("Genre name needs at least one letter or number", { name: ["Invalid name"] });
  const existing = await first<Row>(c.env.DB, "SELECT * FROM genres WHERE club_id = ? AND slug = ?", clubId, slug);
  if (existing) {
    throw new ApiError(409, "duplicate", `“${String(existing.name)}” already exists${existing.archived_at ? " (archived)" : ""}`, {
      current: mapGenre(existing),
      fields: { name: ["Already exists"] },
    });
  }
  const id = newId();
  const now = nowIso();
  await run(
    c.env.DB,
    "INSERT INTO genres (id, club_id, name, slug, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    clubId,
    name,
    slug,
    user.id,
    user.id,
    now,
    now,
  );
  return c.json(await loadGenre(c.env.DB, clubId, id), 201);
});

genreRoutes.put("/:id", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const id = c.req.param("id");
  const input = await parseBody(c, genreUpdateSchema);
  const slug = slugify(input.name);
  if (!slug) throw badRequest("Genre name needs at least one letter or number", { name: ["Invalid name"] });
  const clash = await first<{ id: string }>(c.env.DB, "SELECT id FROM genres WHERE club_id = ? AND slug = ? AND id <> ?", clubId, slug, id);
  if (clash) throw new ApiError(409, "duplicate", "Another genre already has that name", { fields: { name: ["Already exists"] } });
  const genre = await updateVersioned({
    db: c.env.DB,
    table: "genres",
    id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Genre",
    set: { name: input.name, slug },
    where: { club_id: clubId },
    load: () => loadGenre(c.env.DB, clubId, id),
  });
  return c.json(genre);
});

for (const action of ["archive", "restore"] as const) {
  genreRoutes.post(`/:id/${action}`, async (c) => {
    const user = c.get("user");
    const clubId = c.get("club").id;
    const id = c.req.param("id");
    const { expectedVersion } = await parseBody(c, versionSchema);
    const genre = await updateVersioned({
      db: c.env.DB,
      table: "genres",
      id,
      expectedVersion,
      userId: user.id,
      label: "Genre",
      set: { archived_at: action === "archive" ? nowIso() : null },
      where: { club_id: clubId },
      load: () => loadGenre(c.env.DB, clubId, id),
    });
    return c.json(genre);
  });
}

genreRoutes.get("/:id/books", async (c) => {
  const clubId = c.get("club").id;
  const rows = await all<Row>(
    c.env.DB,
    `SELECT ${editionCols("e", "e_")} FROM book_genres bg JOIN genres g ON g.id = bg.genre_id JOIN book_editions e ON e.book_id = bg.book_id
     WHERE bg.club_id = ? AND bg.genre_id = ? AND g.club_id = ? GROUP BY e.book_id ORDER BY e.title COLLATE NOCASE LIMIT 200`,
    clubId,
    c.req.param("id"),
    clubId,
  );
  return c.json(rows.map((r) => mapEdition(r, "e_")));
});

/** Replace this club's genre tags on a work (shared data; any member). */
bookGenreRoutes.put("/:bookId/genres", async (c) => {
  const user = c.get("user");
  const clubId = c.get("club").id;
  const bookId = c.req.param("bookId");
  const { genreIds } = await parseBody(c, bookGenresSchema);
  const book = await first<{ id: string }>(c.env.DB, "SELECT id FROM books WHERE id = ?", bookId);
  if (!book) throw notFound("Book not found");
  const unique = Array.from(new Set(genreIds));
  if (unique.length) {
    const found = await all<{ id: string }>(
      c.env.DB,
      `SELECT id FROM genres WHERE club_id = ? AND archived_at IS NULL AND id IN (${placeholders(unique.length)})`,
      clubId,
      ...unique,
    );
    if (found.length !== unique.length) throw badRequest("One or more genres no longer exist");
  }
  const now = nowIso();
  await c.env.DB.batch([
    // Archived genres are hidden from the picker, so keep their existing tags.
    c.env.DB.prepare(
      "DELETE FROM book_genres WHERE club_id = ? AND book_id = ? AND genre_id IN (SELECT id FROM genres WHERE club_id = ? AND archived_at IS NULL)",
    ).bind(clubId, bookId, clubId),
    ...unique.map((g) =>
      c.env.DB.prepare("INSERT INTO book_genres (club_id, book_id, genre_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)").bind(clubId, bookId, g, user.id, now),
    ),
  ]);
  return c.json(await genresForBookInClub(c.env.DB, clubId, bookId));
});
