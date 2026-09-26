import type { Env } from "../env";
import { isProduction } from "../env";
import { tooManyRequests } from "../lib/errors";
import { sha256Hex } from "../lib/util";

export interface RateRule {
  /** Window length in seconds. */
  window: number;
  /** Maximum requests per window. */
  max: number;
}

/**
 * Atomic fixed-window counter in D1. A single UPSERT...RETURNING statement
 * increments (or resets) the counter, so concurrent requests cannot all pass
 * a stale read.
 */
export async function consumeRateLimit(
  db: D1Database,
  key: string,
  rule: RateRule,
): Promise<{ allowed: boolean; retryAfter: number | null }> {
  const now = Date.now();
  const windowMs = rule.window * 1000;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start <= ?2 - ?3 THEN 1 ELSE rate_limits.count + 1 END,
         window_start = CASE WHEN rate_limits.window_start <= ?2 - ?3 THEN ?2 ELSE rate_limits.window_start END
       RETURNING count, window_start`,
    )
    .bind(key, now, windowMs)
    .first<{ count: number; window_start: number }>();
  if (!row) return { allowed: true, retryAfter: null };
  if (row.count > rule.max) {
    const retryAfter = Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000));
    return { allowed: false, retryAfter };
  }
  return { allowed: true, retryAfter: null };
}

/** Non-production environments get 10x headroom so local testing is not painful. */
export function scaleRule(env: Env, rule: RateRule): RateRule {
  return isProduction(env) ? rule : { window: rule.window, max: rule.max * 10 };
}

/** Throw a 429 when the key is over its limit. Identifiers are hashed before storage. */
export async function enforceRateLimit(env: Env, scope: string, identifier: string, rule: RateRule): Promise<void> {
  const key = `${scope}:${await sha256Hex(identifier.toLowerCase())}`;
  const result = await consumeRateLimit(env.DB, key, scaleRule(env, rule));
  if (!result.allowed) throw tooManyRequests(result.retryAfter ?? undefined);
}

/** Opportunistic cleanup of expired counters (called from the scheduled handler). */
export async function purgeRateLimits(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(Date.now() - 2 * 24 * 3600 * 1000).run();
}
