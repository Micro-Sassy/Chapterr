import type { EditionDetail, Genre } from "../../shared/types";
import type { NormalizedEdition } from "../providers/types";
import { all, first, run } from "./db";
import { notFound } from "./errors";
import { mapEdition, type Row } from "./mappers";
import { newId, nowIso, parseJsonArray } from "./util";

export function workKey(title: string, author: string | undefined): string {
  const norm = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/^(the|a|an)\s+/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${norm(title.split(":")[0] ?? title)}|${norm(author ?? "")}`;
}

export function searchText(e: { title: string; subtitle: string | null; authors: string[]; isbn13?: string | null }): string {
  return [e.title, e.subtitle ?? "", e.authors.join(" "), e.isbn13 ?? ""].join(" ").toLowerCase();
}

/**
 * Links that help a member find this exact edition at retailers or libraries.
 * These are plain search URLs built from the ISBN — no scraping, no affiliate APIs.
 */
export function retailerLinks(isbn13: string | null, title: string, authors: string[]): { label: string; url: string }[] {
  const q = encodeURIComponent(isbn13 ?? `${title} ${authors[0] ?? ""}`.trim());
  const links = [
    { label: "Amazon", url: `https://www.amazon.com/s?k=${q}` },
    { label: "Bookshop.org", url: `https://bookshop.org/search?keywords=${q}` },
    { label: "WorldCat (libraries)", url: `https://search.worldcat.org/search?q=${isbn13 ? `bn:${isbn13}` : q}` },
    { label: "Open Library", url: `https://openlibrary.org/search?q=${q}` },
  ];
  if (isbn13) links.splice(1, 0, { label: "GetTextbooks", url: `https://www.gettextbooks.com/isbn/${isbn13}/` });
  return links;
}

/** Find an already-stored edition matching any strong identifier. */
export async function findExistingEdition(db: D1Database, e: Partial<NormalizedEdition>): Promise<string | null> {
  const checks: [string, string | null | undefined][] = [
    ["isbn13", e.isbn13],
    ["google_books_id", e.googleBooksId],
    ["openlibrary_edition_id", e.openLibraryId],
    ["goodreads_book_id", e.goodreadsId],
  ];
  for (const [col, val] of checks) {
    if (!val) continue;
    const row = await first<{ id: string }>(db, `SELECT id FROM book_editions WHERE ${col} = ? LIMIT 1`, val);
    if (row) return row.id;
  }
  if (e.isbn10) {
    const row = await first<{ id: string }>(db, "SELECT id FROM book_editions WHERE isbn10 = ? LIMIT 1", e.isbn10);
    if (row) return row.id;
  }
  return null;
}

async function findOrCreateWork(db: D1Database, e: NormalizedEdition, userId: string | null): Promise<string> {
  if (e.openLibraryWorkId) {
    const row = await first<{ id: string }>(db, "SELECT id FROM books WHERE openlibrary_work_id = ?", e.openLibraryWorkId);
    if (row) return row.id;
  }
  const key = workKey(e.title, e.authors[0]);
  const byKey = await first<{ id: string; openlibrary_work_id: string | null }>(
    db,
    "SELECT id, openlibrary_work_id FROM books WHERE work_key = ? ORDER BY created_at LIMIT 1",
    key,
  );
  if (byKey) {
    if (!byKey.openlibrary_work_id && e.openLibraryWorkId) {
      await run(db, "UPDATE books SET openlibrary_work_id = ? WHERE id = ? AND openlibrary_work_id IS NULL", e.openLibraryWorkId, byKey.id).catch(
        () => undefined,
      );
    }
    return byKey.id;
  }
  const id = newId();
  const now = nowIso();
  await run(
    db,
    "INSERT INTO books (id, title, primary_author, work_key, openlibrary_work_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    e.title,
    e.authors[0] ?? null,
    key,
    e.openLibraryWorkId,
    userId,
    now,
    now,
  );
  return id;
}

/**
 * Store an edition (deduplicated by ISBN-13 / provider ids) and return its id.
 * Missing fields on an existing record are filled in, but existing values are
 * never overwritten by imports.
 */
export async function upsertEdition(db: D1Database, e: NormalizedEdition, userId: string | null): Promise<{ id: string; created: boolean }> {
  const existing = await findExistingEdition(db, e);
  const now = nowIso();
  if (existing) {
    await run(
      db,
      `UPDATE book_editions SET
         isbn13 = COALESCE(isbn13, ?), isbn10 = COALESCE(isbn10, ?), publisher = COALESCE(publisher, ?),
         published_date = COALESCE(published_date, ?), published_year = COALESCE(published_year, ?),
         page_count = COALESCE(page_count, ?), language = COALESCE(language, ?), description = COALESCE(description, ?),
         cover_url = COALESCE(cover_url, ?), cover_url_large = COALESCE(cover_url_large, ?),
         google_books_id = COALESCE(google_books_id, ?), openlibrary_edition_id = COALESCE(openlibrary_edition_id, ?),
         goodreads_book_id = COALESCE(goodreads_book_id, ?),
         format = CASE WHEN format = 'unknown' THEN ? ELSE format END
       WHERE id = ?`,
      e.isbn13,
      e.isbn10,
      e.publisher,
      e.publishedDate,
      e.publishedYear,
      e.pageCount,
      e.language,
      e.description,
      e.coverUrl,
      e.coverUrlLarge,
      e.googleBooksId,
      e.openLibraryId,
      e.goodreadsId,
      e.format,
      existing,
    ).catch(async () => {
      // A unique identifier may belong to another row; fall back to leaving the record as-is.
    });
    return { id: existing, created: false };
  }
  const bookId = await findOrCreateWork(db, e, userId);
  const id = newId();
  await run(
    db,
    `INSERT INTO book_editions (id, book_id, isbn13, isbn10, title, subtitle, authors, publisher, published_date, published_year,
       format, language, page_count, description, cover_url, cover_url_large, google_books_id, openlibrary_edition_id,
       goodreads_book_id, source, search_text, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    bookId,
    e.isbn13,
    e.isbn10,
    e.title,
    e.subtitle,
    JSON.stringify(e.authors),
    e.publisher,
    e.publishedDate,
    e.publishedYear,
    e.format,
    e.language,
    e.pageCount,
    e.description,
    e.coverUrl,
    e.coverUrlLarge,
    e.googleBooksId,
    e.openLibraryId,
    e.goodreadsId,
    e.source,
    searchText(e),
    userId,
    userId,
    now,
    now,
  );
  return { id, created: true };
}

export async function requireEdition(db: D1Database, id: string): Promise<void> {
  const row = await first<{ id: string }>(db, "SELECT id FROM book_editions WHERE id = ?", id);
  if (!row) throw notFound("Book edition not found");
}

/** A work's genre tags inside one club. */
export async function genresForBookInClub(db: D1Database, clubId: string, bookId: string): Promise<Genre[]> {
  const rows = await all<Row>(
    db,
    `SELECT g.id, g.name, g.slug, g.version, g.archived_at, g.club_id FROM book_genres bg JOIN genres g ON g.id = bg.genre_id
     WHERE bg.club_id = ? AND bg.book_id = ? AND g.archived_at IS NULL ORDER BY g.name COLLATE NOCASE`,
    clubId,
    bookId,
  );
  return rows.map(mapGenreRow);
}

/** A work's genre tags across every club the viewer belongs to (book detail page). */
export async function genresForBook(db: D1Database, viewerId: string, bookId: string): Promise<Genre[]> {
  const rows = await all<Row>(
    db,
    `SELECT g.id, g.name, g.slug, g.version, g.archived_at, g.club_id, c.name AS club_name
       FROM book_genres bg
       JOIN genres g ON g.id = bg.genre_id
       JOIN clubs c ON c.id = bg.club_id AND c.archived_at IS NULL
       JOIN club_members m ON m.club_id = bg.club_id AND m.user_id = ?
      WHERE bg.book_id = ? AND g.archived_at IS NULL ORDER BY c.name COLLATE NOCASE, g.name COLLATE NOCASE`,
    viewerId,
    bookId,
  );
  return rows.map(mapGenreRow);
}

function mapGenreRow(r: Row): Genre {
  return {
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    version: Number(r.version),
    archivedAt: (r.archived_at as string | null) ?? null,
    clubId: String(r.club_id),
    ...(r.club_name ? { clubName: String(r.club_name) } : {}),
  };
}

export async function getEditionDetail(db: D1Database, id: string, viewerId: string): Promise<EditionDetail> {
  const row = await first<Row>(db, "SELECT e.*, e.id AS e_id, e.book_id AS e_book_id, e.title AS e_title, e.subtitle AS e_subtitle, e.authors AS e_authors, e.cover_url AS e_cover_url, e.isbn13 AS e_isbn13, e.published_year AS e_published_year, e.format AS e_format, e.page_count AS e_page_count FROM book_editions e WHERE e.id = ?", id);
  if (!row) throw notFound("Book edition not found");
  const summary = mapEdition(row, "e_");
  return {
    ...summary,
    isbn10: (row.isbn10 as string | null) ?? null,
    publisher: (row.publisher as string | null) ?? null,
    publishedDate: (row.published_date as string | null) ?? null,
    language: (row.language as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    coverUrlLarge: (row.cover_url_large as string | null) ?? null,
    googleBooksId: (row.google_books_id as string | null) ?? null,
    openLibraryId: (row.openlibrary_edition_id as string | null) ?? null,
    source: row.source as EditionDetail["source"],
    version: Number(row.version),
    genres: await genresForBook(db, viewerId, summary.bookId),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    retailerLinks: retailerLinks(summary.isbn13, summary.title, parseJsonArray(row.authors)),
  };
}
