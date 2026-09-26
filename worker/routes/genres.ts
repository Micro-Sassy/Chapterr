import { Hono } from "hono";
import { genreSchema, genreUpdateSchema, versionSchema } from "../../shared/schemas";
import type { Genre } from "../../shared/types";
import type { AppEnv } from "../env";
import { all, first, run } from "../lib/db";
import { ApiError, badRequest } from "../lib/errors";
import { parseBody } from "../lib/http";
import { editionCols, mapEdition, type Row } from "../lib/mappers";
import { newId, nowIso, slugify } from "../lib/util";
import { updateVersioned } from "../lib/versioned";

/** Shared club genres/tags: any member can create, rename, archive and restore. */
export const genreRoutes = new Hono<AppEnv>();

function mapGenre(r: Row): Genre {
  return {
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    version: Number(r.version),
    archivedAt: (r.archived_at as string | null) ?? null,
    bookCount: r.book_count === undefined ? undefined : Number(r.book_count),
  };
}

async function loadGenre(db: D1Database, id: string): Promise<Genre | null> {
  const r = await first<Row>(
    db,
    "SELECT g.*, (SELECT COUNT(*) FROM book_genres bg WHERE bg.genre_id = g.id) AS book_count FROM genres g WHERE g.id = ?",
    id,
  );
  return r ? mapGenre(r) : null;
}

genreRoutes.get("/", async (c) => {
  const includeArchived = c.req.query("archived") === "1";
  const rows = await all<Row>(
    c.env.DB,
    `SELECT g.*, (SELECT COUNT(*) FROM book_genres bg WHERE bg.genre_id = g.id) AS book_count FROM genres g
     ${includeArchived ? "" : "WHERE g.archived_at IS NULL"} ORDER BY g.name COLLATE NOCASE`,
  );
  return c.json(rows.map(mapGenre));
});

genreRoutes.post("/", async (c) => {
  const user = c.get("user");
  const { name } = await parseBody(c, genreSchema);
  const slug = slugify(name);
  if (!slug) throw badRequest("Genre name needs at least one letter or number", { name: ["Invalid name"] });
  const existing = await first<Row>(c.env.DB, "SELECT * FROM genres WHERE slug = ?", slug);
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
    "INSERT INTO genres (id, name, slug, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    name,
    slug,
    user.id,
    user.id,
    now,
    now,
  );
  return c.json(await loadGenre(c.env.DB, id), 201);
});

genreRoutes.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = await parseBody(c, genreUpdateSchema);
  const slug = slugify(input.name);
  if (!slug) throw badRequest("Genre name needs at least one letter or number", { name: ["Invalid name"] });
  const clash = await first<{ id: string }>(c.env.DB, "SELECT id FROM genres WHERE slug = ? AND id <> ?", slug, id);
  if (clash) throw new ApiError(409, "duplicate", "Another genre already has that name", { fields: { name: ["Already exists"] } });
  const genre = await updateVersioned({
    db: c.env.DB,
    table: "genres",
    id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Genre",
    set: { name: input.name, slug },
    load: () => loadGenre(c.env.DB, id),
  });
  return c.json(genre);
});

for (const action of ["archive", "restore"] as const) {
  genreRoutes.post(`/:id/${action}`, async (c) => {
    const user = c.get("user");
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
      load: () => loadGenre(c.env.DB, id),
    });
    return c.json(genre);
  });
}

genreRoutes.get("/:id/books", async (c) => {
  const rows = await all<Row>(
    c.env.DB,
    `SELECT ${editionCols("e", "e_")} FROM book_genres bg JOIN book_editions e ON e.book_id = bg.book_id
     WHERE bg.genre_id = ? GROUP BY e.book_id ORDER BY e.title COLLATE NOCASE LIMIT 200`,
    c.req.param("id"),
  );
  return c.json(rows.map((r) => mapEdition(r, "e_")));
});
