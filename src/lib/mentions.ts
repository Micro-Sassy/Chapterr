import { createElement, type ReactNode } from "react";
import { Link } from "react-router";
import { clubPath } from "./club";

/**
 * Mentions are written as `@username` in a message body. Usernames follow the
 * account rules: letters, digits, dots, underscores and hyphens, 2 to 40 long.
 * A match must start at the beginning of the text or after whitespace or an
 * opening bracket so that email addresses are left alone.
 */
const MENTION_RE = /(^|[\s([{"'])@([a-z0-9][a-z0-9._-]{1,39})/gi;

export type MentionSegment = { type: "text"; text: string } | { type: "mention"; username: string; raw: string };

/** Split a body into plain text and mention segments (trailing punctuation stays in the text). */
export function parseMentions(body: string): MentionSegment[] {
  const out: MentionSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const lead = m[1] ?? "";
    const username = (m[2] ?? "").replace(/[._-]+$/, "");
    if (!username) continue;
    const start = (m.index ?? 0) + lead.length;
    const end = start + 1 + username.length;
    if (start > last) out.push({ type: "text", text: body.slice(last, start) });
    out.push({ type: "mention", username, raw: body.slice(start, end) });
    last = end;
  }
  if (last < body.length) out.push({ type: "text", text: body.slice(last) });
  return out;
}

/** Distinct usernames mentioned in a body, in order of first appearance. */
export function extractMentionUsernames(body: string): string[] {
  const seen = new Set<string>();
  for (const seg of parseMentions(body)) {
    if (seg.type === "mention") seen.add(seg.username.toLowerCase());
  }
  return [...seen];
}

/**
 * Render a body with each mention as a link to the member's profile in the club.
 * When `known` is given, only usernames in that set become links; others stay text.
 */
export function renderMentions(body: string, clubId: string | null, known?: ReadonlySet<string> | string[]): ReactNode[] {
  const knownSet = known ? new Set([...known].map((u) => u.toLowerCase())) : null;
  return parseMentions(body).map((seg, i) => {
    if (seg.type === "text") return seg.text;
    const isKnown = !knownSet || knownSet.has(seg.username.toLowerCase());
    if (!clubId || !isKnown) return createElement("span", { key: i, className: "font-medium" }, seg.raw);
    return createElement(
      Link,
      { key: i, to: clubPath(clubId, `members/${encodeURIComponent(seg.username)}`), className: "mention font-semibold underline decoration-line underline-offset-2 hover:decoration-current" },
      seg.raw,
    );
  });
}

/**
 * The `@query` the caret is currently inside, if any: used by the composer to
 * open the autocomplete. Returns the start index of the `@` and the typed query.
 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/[\s([{"']/.test(before.charAt(at - 1))) return null;
  const query = before.slice(at + 1);
  if (!/^[a-z0-9._-]{0,40}$/i.test(query)) return null;
  return { start: at, query };
}

/** Replace the `@query` at `start` with `@username ` and return the new text and caret. */
export function insertMention(text: string, start: number, caret: number, username: string): { text: string; caret: number } {
  const inserted = `@${username} `;
  const next = text.slice(0, start) + inserted + text.slice(caret);
  return { text: next, caret: start + inserted.length };
}
