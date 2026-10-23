import type { EditionMapping, EditionMappings, ReadingRanges } from "../../shared/types";
import { all, first, run } from "./db";
import { nowIso } from "./util";

/**
 * Edition mappings (docs/FEATURES-2.md §7): a page range on an assignment is
 * translated proportionally into Kindle locations and audiobook time so
 * members on any format know where to stop.
 */

export interface MappingTotals {
  pageCount: number | null;
  kindleTotal: number | null;
  audioSeconds: number | null;
}

/** Seconds as h:mm:ss (e.g. 11:32:05). */
export function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Ranges for pages [from, to] of an edition with `pageCount` pages. Kindle
 * locations and audio time scale linearly with the page fraction; a range
 * starts where the previous page ends so consecutive assignments abut.
 */
export function computeRanges(fromPage: number | null, toPage: number | null, totals: MappingTotals): ReadingRanges {
  if (fromPage === null || toPage === null || fromPage < 1 || toPage < fromPage) return { pages: null, kindle: null, audio: null };
  const pages = { from: fromPage, to: toPage };
  const total = totals.pageCount && totals.pageCount > 0 ? Math.max(totals.pageCount, toPage) : null;
  if (!total) return { pages, kindle: null, audio: null };
  const startFraction = (fromPage - 1) / total;
  const endFraction = Math.min(1, toPage / total);
  const kindle = totals.kindleTotal
    ? { from: Math.max(1, Math.round(startFraction * totals.kindleTotal) + (fromPage > 1 ? 1 : 0)), to: Math.round(endFraction * totals.kindleTotal) }
    : null;
  const audio = totals.audioSeconds ? { from: formatHms(startFraction * totals.audioSeconds), to: formatHms(endFraction * totals.audioSeconds) } : null;
  return { pages, kindle, audio };
}

export function mapMappingRow(r: { kind: string; total: number; label: string | null; updated_at: string }): EditionMapping {
  return { kind: r.kind as EditionMapping["kind"], total: Number(r.total), label: r.label ?? null, updatedAt: String(r.updated_at) };
}

export async function loadMappings(db: D1Database, editionId: string): Promise<EditionMappings | null> {
  const edition = await first<{ id: string; page_count: number | null }>(db, "SELECT id, page_count FROM book_editions WHERE id = ?", editionId);
  if (!edition) return null;
  const rows = await all<{ kind: string; total: number; label: string | null; updated_at: string }>(
    db,
    "SELECT kind, total, label, updated_at FROM edition_mappings WHERE edition_id = ? ORDER BY kind",
    editionId,
  );
  return { editionId, pageCount: edition.page_count === null ? null : Number(edition.page_count), mappings: rows.map(mapMappingRow) };
}

export async function upsertMapping(db: D1Database, editionId: string, input: { kind: "kindle" | "audio"; total: number; label: string | null }, userId: string): Promise<void> {
  await run(
    db,
    `INSERT INTO edition_mappings (edition_id, kind, total, label, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (edition_id, kind) DO UPDATE SET total = excluded.total, label = excluded.label, updated_at = excluded.updated_at`,
    editionId,
    input.kind,
    input.total,
    input.label,
    userId,
    nowIso(),
  );
}
