import type { BookFormat } from "../../shared/constants";
import type { EditionSummary, MemberSummary } from "../../shared/types";
import { parseJsonArray } from "./util";

export type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (typeof v === "number" ? v : v === null || v === undefined ? null : Number(v));

/** SQL select list for a member summary from the "user" table aliased as `u`. */
export const memberCols = (u: string, p: string) =>
  `${u}.id AS ${p}id, ${u}.username AS ${p}username, ${u}.name AS ${p}name, ${u}.image AS ${p}image`;

export function mapMember(row: Row, p: string): MemberSummary {
  return {
    id: String(row[`${p}id`]),
    username: String(row[`${p}username`] ?? ""),
    displayName: String(row[`${p}name`] ?? ""),
    avatarUrl: str(row[`${p}image`]),
  };
}

export function mapMemberOrNull(row: Row, p: string): MemberSummary | null {
  return row[`${p}id`] ? mapMember(row, p) : null;
}

/** SQL select list for an edition summary from book_editions aliased as `e`. */
export const editionCols = (e: string, p: string) =>
  [
    "id",
    "book_id",
    "title",
    "subtitle",
    "authors",
    "cover_url",
    "isbn13",
    "published_year",
    "format",
    "page_count",
  ]
    .map((c) => `${e}.${c} AS ${p}${c}`)
    .join(", ");

export function mapEdition(row: Row, p: string): EditionSummary {
  return {
    id: String(row[`${p}id`]),
    bookId: String(row[`${p}book_id`]),
    title: String(row[`${p}title`]),
    subtitle: str(row[`${p}subtitle`]),
    authors: parseJsonArray(row[`${p}authors`]),
    coverUrl: str(row[`${p}cover_url`]),
    isbn13: str(row[`${p}isbn13`]),
    publishedYear: num(row[`${p}published_year`]),
    format: (str(row[`${p}format`]) ?? "unknown") as BookFormat,
    pageCount: num(row[`${p}page_count`]),
  };
}

export function mapEditionOrNull(row: Row, p: string): EditionSummary | null {
  return row[`${p}id`] ? mapEdition(row, p) : null;
}

export const auditCols = (t: string) =>
  `${t}.version, ${t}.created_at, ${t}.updated_at, ${memberCols("cu", "cu_")}, ${memberCols("uu", "uu_")}`;
export const auditJoins = (t: string) =>
  `LEFT JOIN "user" cu ON cu.id = ${t}.created_by LEFT JOIN "user" uu ON uu.id = ${t}.updated_by`;

export function mapAudit(row: Row) {
  return {
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    createdBy: mapMemberOrNull(row, "cu_"),
    updatedBy: mapMemberOrNull(row, "uu_"),
  };
}

export { num, str };
