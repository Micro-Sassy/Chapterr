import { Hono } from "hono";
import { importBatchSchema, type ImportRow } from "../../shared/schemas";
import type { ImportRecord, ImportResult } from "../../shared/types";
import type { AppEnv } from "../env";
import { all, first, run } from "../lib/db";
import { upsertEdition } from "../lib/editions";
import { badRequest, notFound } from "../lib/errors";
import { parseBody } from "../lib/http";
import { type Row } from "../lib/mappers";
import { newId, nowIso } from "../lib/util";
import type { NormalizedEdition } from "../providers/types";
import { enforceRateLimit } from "../security/rate-limit";

/**
 * Goodreads import. The browser parses the Goodreads "Export Library" CSV
 * (shared/goodreads.ts) and uploads validated rows in small batches; the
 * Worker re-validates every row with Zod and writes only to the signed-in
 * member's own records. No Goodreads scraping or API calls are involved.
 */
export const importRoutes = new Hono<AppEnv>();

function rowToEdition(row: ImportRow): NormalizedEdition {
  return {
    title: row.title,
    subtitle: null,
    authors: row.authors,
    isbn13: row.isbn13,
    isbn10: row.isbn10,
    publisher: row.publisher,
    publishedDate: row.publishedYear ? String(row.publishedYear) : null,
    publishedYear: row.publishedYear,
    pageCount: row.pageCount,
    format: row.format,
    language: null,
    description: null,
    // Open Library serves covers by ISBN for free; the UI falls back gracefully when none exists.
    coverUrl: row.isbn13 ? `https://covers.openlibrary.org/b/isbn/${row.isbn13}-M.jpg?default=false` : null,
    coverUrlLarge: row.isbn13 ? `https://covers.openlibrary.org/b/isbn/${row.isbn13}-L.jpg?default=false` : null,
    googleBooksId: null,
    openLibraryId: null,
    openLibraryWorkId: null,
    goodreadsId: row.goodreadsId,
    source: "goodreads",
  };
}

importRoutes.post("/goodreads/batch", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env, "import-batch", user.id, { window: 60 * 60, max: 400 });
  const input = await parseBody(c, importBatchSchema);
  const db = c.env.DB;
  const now = nowIso();

  let importId = input.importId;
  if (importId) {
    const existing = await first<{ id: string; status: string }>(db, "SELECT id, status FROM imports WHERE id = ? AND user_id = ?", importId, user.id);
    if (!existing) throw notFound("Import not found");
    if (existing.status !== "running") throw badRequest("This import has already finished");
  } else {
    importId = newId();
    await run(db, "INSERT INTO imports (id, user_id, source, status, total_rows, created_at) VALUES (?, ?, 'goodreads', 'running', ?, ?)", importId, user.id, input.totalRows, now);
  }

  const result: ImportResult = { importId, created: 0, updated: 0, skipped: 0, errors: [] };
  for (const [index, row] of input.rows.entries()) {
    try {
      const { id: editionId } = await upsertEdition(db, rowToEdition(row), user.id);
      const existing = await first<{ id: string; notes: string | null; started_at: string | null }>(
        db,
        "SELECT id, notes, started_at FROM user_books WHERE user_id = ? AND edition_id = ?",
        user.id,
        editionId,
      );
      const finishedAt = row.status === "finished" ? (row.dateRead ?? row.dateAdded) : null;
      const startedAt = row.status === "reading" ? (existing?.started_at ?? row.dateAdded) : (existing?.started_at ?? null);
      const statements: D1PreparedStatement[] = [];
      if (existing) {
        statements.push(
          db
            .prepare(
              `UPDATE user_books SET status = ?, finished_at = ?, started_at = ?, notes = COALESCE(notes, ?), shelves = ?,
                 progress_percent = CASE WHEN ? = 'finished' THEN 100 ELSE progress_percent END, updated_at = ?
               WHERE id = ? AND user_id = ?`,
            )
            .bind(row.status, finishedAt, startedAt, row.privateNotes, JSON.stringify(row.shelves), row.status, now, existing.id, user.id),
        );
        result.updated++;
      } else {
        statements.push(
          db
            .prepare(
              `INSERT INTO user_books (id, user_id, edition_id, status, started_at, finished_at, progress_percent, visibility, notes, shelves, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              newId(),
              user.id,
              editionId,
              row.status,
              startedAt,
              finishedAt,
              row.status === "finished" ? 100 : null,
              input.visibility,
              row.privateNotes,
              JSON.stringify(row.shelves),
              row.dateAdded ? `${row.dateAdded}T12:00:00.000Z` : now,
              now,
            ),
        );
        result.created++;
      }
      if (input.importReviews && (row.review || row.sentiment)) {
        // Existing reviews in the app are never overwritten by an import.
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO reviews (id, user_id, edition_id, body, sentiment, visibility, contains_spoilers, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(newId(), user.id, editionId, row.review ?? "", row.sentiment ?? "mixed", input.visibility, Number(row.containsSpoilers), now, now),
        );
      }
      await db.batch(statements);
    } catch (err) {
      result.skipped++;
      result.errors.push({ row: index, title: row.title, message: err instanceof Error ? "Could not import this row" : "Unknown error" });
      console.error("import row failed", err instanceof Error ? err.message : err);
    }
  }

  await run(
    db,
    `UPDATE imports SET created_count = created_count + ?, updated_count = updated_count + ?, skipped_count = skipped_count + ?,
       error_count = error_count + ?, status = CASE WHEN ? = 1 THEN 'completed' ELSE status END,
       completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END
     WHERE id = ? AND user_id = ?`,
    result.created,
    result.updated,
    result.skipped,
    result.errors.length,
    Number(input.isFinalBatch),
    Number(input.isFinalBatch),
    nowIso(),
    importId,
    user.id,
  );
  return c.json(result);
});

importRoutes.get("/", async (c) => {
  const rows = await all<Row>(c.env.DB, "SELECT * FROM imports WHERE user_id = ? ORDER BY created_at DESC LIMIT 20", c.get("user").id);
  const records: ImportRecord[] = rows.map((r) => ({
    id: String(r.id),
    source: "goodreads",
    status: r.status as ImportRecord["status"],
    totalRows: Number(r.total_rows),
    created: Number(r.created_count),
    updated: Number(r.updated_count),
    skipped: Number(r.skipped_count),
    errorCount: Number(r.error_count),
    createdAt: String(r.created_at),
    completedAt: (r.completed_at as string | null) ?? null,
  }));
  return c.json(records);
});
