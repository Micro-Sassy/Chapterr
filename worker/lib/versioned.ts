import { run } from "./db";
import { conflict, notFound } from "./errors";
import { nowIso } from "./util";

type Param = string | number | null;

/**
 * Optimistic-concurrency update for shared club records. The UPDATE only
 * applies when the stored version still equals the version the member was
 * looking at; otherwise a 409 is returned with the latest copy so the UI can
 * show what changed.
 */
export async function updateVersioned<T>(opts: {
  db: D1Database;
  table: string;
  id: string;
  expectedVersion: number;
  set: Record<string, Param>;
  userId: string;
  load: () => Promise<T | null>;
  label: string;
  /** Extra equality conditions, e.g. `{ club_id: clubId }` so a record can only be changed inside its own club. */
  where?: Record<string, Param>;
}): Promise<T> {
  const cols = Object.keys(opts.set);
  const assignments = cols.map((c) => `${c} = ?`).join(", ");
  const extraCols = Object.keys(opts.where ?? {});
  const extra = extraCols.map((c) => ` AND ${c} = ?`).join("");
  const res = await run(
    opts.db,
    `UPDATE ${opts.table} SET ${assignments}${cols.length ? ", " : ""}version = version + 1, updated_by = ?, updated_at = ?
     WHERE id = ? AND version = ?${extra}`,
    ...cols.map((c) => opts.set[c]!),
    opts.userId,
    nowIso(),
    opts.id,
    opts.expectedVersion,
    ...extraCols.map((c) => opts.where![c]!),
  );
  const current = await opts.load();
  if (res.meta.changes === 0) {
    if (!current) throw notFound(`${opts.label} not found`);
    throw conflict(`Someone else updated this ${opts.label.toLowerCase()} while you were editing. Review the latest version and try again.`, current);
  }
  if (!current) throw notFound(`${opts.label} not found`);
  return current;
}
