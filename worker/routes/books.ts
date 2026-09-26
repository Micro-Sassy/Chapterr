import { Hono } from "hono";
import { normalizeIsbn } from "../../shared/isbn";
import {
  bookGenresSchema,
  bookSearchSchema,
  editionUpdateSchema,
  manualEditionSchema,
  providerEditionSchema,
} from "../../shared/schemas";
import type { BookSearchResponse, CatalogResult, EditionSummary } from "../../shared/types";
import type { AppEnv } from "../env";
import { all, first, placeholders } from "../lib/db";
import { getEditionDetail, genresForBook, searchText, upsertEdition } from "../lib/editions";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { parseBody, parseWith } from "../lib/http";
import { editionCols, mapEdition, type Row } from "../lib/mappers";
import { escapeLike, nowIso } from "../lib/util";
import { updateVersioned } from "../lib/versioned";
import { fetchProviderEdition, searchCatalog } from "../providers/catalog";
import { ProviderError, type NormalizedEdition } from "../providers/types";
import { enforceRateLimit } from "../security/rate-limit";

export const bookRoutes = new Hono<AppEnv>();

async function localSearch(db: D1Database, q: string): Promise<EditionSummary[]> {
  const { isbn13 } = normalizeIsbn(q);
  if (isbn13) {
    const rows = await all<Row>(db, `SELECT ${editionCols("e", "e_")} FROM book_editions e WHERE e.isbn13 = ?`, isbn13);
    return rows.map((r) => mapEdition(r, "e_"));
  }
  const terms = q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  if (terms.length === 0) return [];
  const where = terms.map(() => "e.search_text LIKE ? ESCAPE '\\'").join(" AND ");
  const rows = await all<Row>(
    db,
    `SELECT ${editionCols("e", "e_")} FROM book_editions e WHERE ${where} ORDER BY e.updated_at DESC LIMIT 20`,
    ...terms.map((t) => `%${escapeLike(t)}%`),
  );
  return rows.map((r) => mapEdition(r, "e_"));
}

bookRoutes.get("/search", async (c) => {
  const { q } = parseWith(bookSearchSchema, { q: c.req.query("q") ?? "" });
  const user = c.get("user");
  await enforceRateLimit(c.env, "book-search", user.id, { window: 60, max: 30 });
  const [local, catalog] = await Promise.all([localSearch(c.env.DB, q), searchCatalog(c.env, q)]);
  // Mark catalogue hits we already store, so the UI links to them instead of duplicating.
  const isbns = catalog.hits.map((h) => h.isbn13).filter((v): v is string => !!v);
  const providerIds = catalog.hits.map((h) => h.providerId);
  const known = new Map<string, string>();
  if (isbns.length || providerIds.length) {
    const rows = await all<{ id: string; isbn13: string | null; google_books_id: string | null; openlibrary_edition_id: string | null }>(
      c.env.DB,
      `SELECT id, isbn13, google_books_id, openlibrary_edition_id FROM book_editions
       WHERE isbn13 IN (${placeholders(Math.max(isbns.length, 1))})
          OR google_books_id IN (${placeholders(providerIds.length || 1)})
          OR openlibrary_edition_id IN (${placeholders(providerIds.length || 1)})`,
      ...(isbns.length ? isbns : [""]),
      ...(providerIds.length ? providerIds : [""]),
      ...(providerIds.length ? providerIds : [""]),
    );
    for (const r of rows) {
      if (r.isbn13) known.set(`isbn:${r.isbn13}`, r.id);
      if (r.google_books_id) known.set(`gb:${r.google_books_id}`, r.id);
      if (r.openlibrary_edition_id) known.set(`ol:${r.openlibrary_edition_id}`, r.id);
    }
  }
  const results: CatalogResult[] = catalog.hits.map((h) => ({
    ...h,
    existingEditionId:
      (h.isbn13 && known.get(`isbn:${h.isbn13}`)) ||
      known.get(h.provider === "google_books" ? `gb:${h.providerId}` : `ol:${h.providerId}`) ||
      null,
  }));
  const body: BookSearchResponse = { local, catalog: results, provider: catalog.provider, providerError: catalog.error };
  return c.json(body);
});

bookRoutes.post("/editions/provider", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, providerEditionSchema);
  await enforceRateLimit(c.env, "book-add", user.id, { window: 60, max: 30 });
  let data: NormalizedEdition;
  try {
    data = await fetchProviderEdition(c.env, input.provider, input.providerId);
  } catch (err) {
    if (err instanceof ProviderError && err.message === "Not found") throw notFound("That book could not be found in the catalogue");
    throw new ApiError(502, "provider_error", "The book catalogue is unavailable right now. Try again, or add the book manually.");
  }
  const { id, created } = await upsertEdition(c.env.DB, data, user.id);
  return c.json(await getEditionDetail(c.env.DB, id), created ? 201 : 200);
});

function manualToNormalized(input: ReturnType<typeof manualEditionSchema.parse>): NormalizedEdition {
  const { isbn13, isbn10 } = normalizeIsbn(input.isbn);
  const year = input.publishedDate ? /(\d{4})/.exec(input.publishedDate)?.[1] : undefined;
  return {
    title: input.title,
    subtitle: input.subtitle,
    authors: input.authors,
    isbn13,
    isbn10,
    publisher: input.publisher,
    publishedDate: input.publishedDate,
    publishedYear: year ? Number(year) : null,
    pageCount: input.pageCount,
    format: input.format,
    language: input.language,
    description: input.description,
    coverUrl: input.coverUrl,
    coverUrlLarge: input.coverUrl,
    googleBooksId: null,
    openLibraryId: null,
    openLibraryWorkId: null,
    goodreadsId: null,
    source: "manual",
  };
}

bookRoutes.post("/editions", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, manualEditionSchema);
  await enforceRateLimit(c.env, "book-add", user.id, { window: 60, max: 30 });
  const normalized = manualToNormalized(input);
  if (normalized.isbn13) {
    const existing = await first<{ id: string }>(c.env.DB, "SELECT id FROM book_editions WHERE isbn13 = ?", normalized.isbn13);
    if (existing) {
      throw new ApiError(409, "duplicate_isbn", "An edition with this ISBN is already in the catalogue", { current: { id: existing.id } });
    }
  }
  const { id } = await upsertEdition(c.env.DB, normalized, user.id);
  return c.json(await getEditionDetail(c.env.DB, id), 201);
});

bookRoutes.get("/editions/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const edition = await getEditionDetail(c.env.DB, id);
  const [clubStats, otherEditions] = await Promise.all([
    all<{ status: string; n: number }>(
      c.env.DB,
      "SELECT status, COUNT(*) AS n FROM user_books WHERE edition_id = ? AND (visibility = 'club' OR user_id = ?) GROUP BY status",
      id,
      user.id,
    ),
    all<Row>(
      c.env.DB,
      `SELECT ${editionCols("e", "e_")} FROM book_editions e WHERE e.book_id = ? AND e.id <> ? ORDER BY e.published_year DESC LIMIT 20`,
      edition.bookId,
      id,
    ),
  ]);
  return c.json({
    edition,
    clubStats: Object.fromEntries(clubStats.map((s) => [s.status, s.n])),
    otherEditions: otherEditions.map((r) => mapEdition(r, "e_")),
  });
});

/** Catalogue metadata is shared club data: any member may correct it (with conflict detection). */
bookRoutes.put("/editions/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = await parseBody(c, editionUpdateSchema);
  const n = manualToNormalized(input);
  if (n.isbn13) {
    const dup = await first<{ id: string }>(c.env.DB, "SELECT id FROM book_editions WHERE isbn13 = ? AND id <> ?", n.isbn13, id);
    if (dup) throw new ApiError(409, "duplicate_isbn", "Another edition already uses this ISBN", { current: { id: dup.id } });
  }
  const detail = await updateVersioned({
    db: c.env.DB,
    table: "book_editions",
    id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Book",
    set: {
      title: n.title,
      subtitle: n.subtitle,
      authors: JSON.stringify(n.authors),
      isbn13: n.isbn13,
      isbn10: n.isbn10,
      publisher: n.publisher,
      published_date: n.publishedDate,
      published_year: n.publishedYear,
      page_count: n.pageCount,
      format: n.format,
      language: n.language,
      description: n.description,
      cover_url: n.coverUrl,
      search_text: searchText(n),
    },
    load: () => getEditionDetail(c.env.DB, id).catch(() => null),
  });
  return c.json(detail);
});

/** Replace the club's genre tags on a work (shared data; any member). */
bookRoutes.put("/works/:bookId/genres", async (c) => {
  const user = c.get("user");
  const bookId = c.req.param("bookId");
  const { genreIds } = await parseBody(c, bookGenresSchema);
  const book = await first<{ id: string }>(c.env.DB, "SELECT id FROM books WHERE id = ?", bookId);
  if (!book) throw notFound("Book not found");
  const unique = Array.from(new Set(genreIds));
  if (unique.length) {
    const found = await all<{ id: string }>(
      c.env.DB,
      `SELECT id FROM genres WHERE archived_at IS NULL AND id IN (${placeholders(unique.length)})`,
      ...unique,
    );
    if (found.length !== unique.length) throw badRequest("One or more genres no longer exist");
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM book_genres WHERE book_id = ?").bind(bookId),
    ...unique.map((g) =>
      c.env.DB.prepare("INSERT INTO book_genres (book_id, genre_id, created_by, created_at) VALUES (?, ?, ?, ?)").bind(bookId, g, user.id, now),
    ),
  ]);
  return c.json(await genresForBook(c.env.DB, bookId));
});

/** Recently added editions (for browsing the club catalogue). */
bookRoutes.get("/recent", async (c) => {
  const rows = await all<Row>(c.env.DB, `SELECT ${editionCols("e", "e_")} FROM book_editions e ORDER BY e.created_at DESC LIMIT 30`);
  return c.json(rows.map((r) => mapEdition(r, "e_")));
});
