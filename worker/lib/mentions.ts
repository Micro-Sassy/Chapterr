import { MENTION_PATTERN } from "../../shared/schemas-chat";
import type { MemberSummary } from "../../shared/types";
import { all, placeholders } from "./db";
import { mapMember, memberCols, type Row } from "./mappers";

/** Distinct lowercase usernames written as `@username` in a message body. */
export function parseMentionTokens(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(MENTION_PATTERN)) {
    const name = m[2]?.toLowerCase();
    if (name) seen.add(name);
  }
  return Array.from(seen).slice(0, 50);
}

/**
 * Resolve `@username` tokens to members of this club (case-insensitive).
 * Tokens that match nobody in the club are ignored: a mention can never
 * reach a user outside the club.
 */
export async function resolveMentions(db: D1Database, clubId: string, body: string): Promise<MemberSummary[]> {
  const tokens = parseMentionTokens(body);
  if (tokens.length === 0) return [];
  const rows = await all<Row>(
    db,
    `SELECT ${memberCols("u", "m_")} FROM club_members cm JOIN "user" u ON u.id = cm.user_id
      WHERE cm.club_id = ? AND lower(u.username) IN (${placeholders(tokens.length)})`,
    clubId,
    ...tokens,
  );
  return rows.map((r) => mapMember(r, "m_"));
}

/** Load member summaries for a list of user ids who are (still) members of the club, preserving the id order. */
export async function loadMembersById(db: D1Database, clubId: string, ids: string[]): Promise<MemberSummary[]> {
  const unique = Array.from(new Set(ids)).filter(Boolean);
  if (unique.length === 0) return [];
  const rows = await all<Row>(
    db,
    `SELECT ${memberCols("u", "m_")} FROM "user" u JOIN club_members cm ON cm.user_id = u.id AND cm.club_id = ?
      WHERE u.id IN (${placeholders(unique.length)})`,
    clubId,
    ...unique,
  );
  const byId = new Map(rows.map((r) => [String(r.m_id), mapMember(r, "m_")]));
  return unique.map((id) => byId.get(id)).filter((m): m is MemberSummary => !!m);
}
