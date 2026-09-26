type Param = string | number | null | ArrayBuffer | Uint8Array;

export async function all<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results;
}

export async function first<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function run(db: D1Database, sql: string, ...params: Param[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

export function stmt(db: D1Database, sql: string, ...params: Param[]): D1PreparedStatement {
  return db.prepare(sql).bind(...params);
}

/** Build "?, ?, ?" for an IN clause. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export const bool = (v: unknown): boolean => v === 1 || v === true || v === "1";
