import type { BookFormat, ReadingStatus, Sentiment } from "./constants";
import { normalizeIsbn } from "./isbn";
import type { ImportRow } from "./schemas";

/**
 * Parse RFC 4180 CSV text (quoted fields, escaped quotes, embedded newlines,
 * optional UTF-8 BOM, CRLF or LF line endings) into rows of string cells.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (ch === "\r" && input[i + 1] === "\n") i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

const REQUIRED_COLUMNS = ["Title", "Author", "Exclusive Shelf"] as const;

export interface GoodreadsParseError {
  line: number;
  title: string;
  message: string;
}

export interface GoodreadsParseResult {
  rows: ImportRow[];
  errors: GoodreadsParseError[];
  stats: Record<ReadingStatus, number> & { reviews: number };
}

/** Goodreads wraps ISBNs as ="0439023483" to stop spreadsheets mangling them. */
export function unwrapGoodreadsValue(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  const match = /^="(.*)"$/.exec(trimmed);
  return (match ? match[1]! : trimmed).trim();
}

/** Goodreads dates look like 2023/05/14 (sometimes 2023-05-14). */
export function parseGoodreadsDate(value: string | undefined): string | null {
  const v = unwrapGoodreadsValue(value);
  if (!v) return null;
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(v);
  if (!m) return null;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
}

export function mapGoodreadsShelf(shelf: string): ReadingStatus {
  const s = shelf.trim().toLowerCase();
  if (s === "read") return "finished";
  if (s === "currently-reading") return "reading";
  if (s === "to-read") return "tbr";
  if (["did-not-finish", "dnf", "abandoned", "gave-up", "did-not-finish-dnf"].includes(s)) return "abandoned";
  return "tbr";
}

export function mapGoodreadsRating(value: string | undefined): Sentiment | null {
  const n = Number(unwrapGoodreadsValue(value));
  switch (n) {
    case 5:
      return "loved";
    case 4:
      return "liked";
    case 3:
      return "mixed";
    case 2:
      return "disliked";
    case 1:
      return "hated";
    default:
      return null;
  }
}

export function mapGoodreadsBinding(value: string | undefined): BookFormat {
  const v = unwrapGoodreadsValue(value).toLowerCase();
  if (!v) return "unknown";
  if (v.includes("hardcover") || v.includes("hardback") || v.includes("library binding")) return "hardcover";
  if (v.includes("paperback") || v.includes("mass market")) return "paperback";
  if (v.includes("kindle") || v.includes("ebook") || v.includes("nook") || v.includes("digital")) return "ebook";
  if (v.includes("audio") || v.includes("audible") || v.includes("mp3") || v.includes("cd")) return "audiobook";
  return "other";
}

/** Goodreads reviews contain simple HTML (<br/>, <i>, <b>). Convert to plain text. */
export function goodreadsReviewToText(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const text = cleanText(v, false)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Remove control characters; optionally collapse newlines for single-line fields. */
export function cleanText(value: string, singleLine = true): string {
  const stripped = value.replace(CONTROL_CHARS, "");
  return (singleLine ? stripped.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ") : stripped.replace(/\r\n?/g, "\n")).trim();
}

function splitAuthors(primary: string, additional: string): string[] {
  const names = [primary, ...additional.split(",")].map((a) => cleanText(a)).filter(Boolean);
  return Array.from(new Set(names)).slice(0, 20);
}

function positiveInt(value: string | undefined, max: number): number | null {
  const v = unwrapGoodreadsValue(value);
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= max ? n : null;
}

/**
 * Convert a Goodreads "Export Library" CSV into validated import rows. Rows
 * that cannot be understood are reported in `errors` rather than dropped silently.
 */
export function parseGoodreadsCsv(text: string): GoodreadsParseResult {
  const table = parseCsv(text);
  const stats = { tbr: 0, reading: 0, finished: 0, abandoned: 0, reviews: 0 };
  const errors: GoodreadsParseError[] = [];
  const rows: ImportRow[] = [];
  if (table.length === 0) {
    return { rows, errors: [{ line: 0, title: "", message: "The file is empty." }], stats };
  }
  const header = table[0]!.map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      rows,
      errors: [
        {
          line: 1,
          title: "",
          message: `This does not look like a Goodreads library export (missing ${missing.join(", ")}).`,
        },
      ],
      stats,
    };
  }
  const col = (name: string) => header.indexOf(name);
  const get = (cells: string[], name: string) => {
    const idx = col(name);
    return idx >= 0 ? (cells[idx] ?? "") : "";
  };

  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const line = r + 1;
    const title = cleanText(get(cells, "Title")).slice(0, 300);
    const author = get(cells, "Author");
    if (!title) {
      errors.push({ line, title: "", message: "Missing title" });
      continue;
    }
    const authors = splitAuthors(author, get(cells, "Additional Authors")).map((a) => a.slice(0, 150));
    if (authors.length === 0) {
      errors.push({ line, title, message: "Missing author" });
      continue;
    }
    const isbnA = normalizeIsbn(unwrapGoodreadsValue(get(cells, "ISBN13")));
    const isbnB = normalizeIsbn(unwrapGoodreadsValue(get(cells, "ISBN")));
    const isbn13 = isbnA.isbn13 ?? isbnB.isbn13;
    const isbn10 = isbnA.isbn10 ?? isbnB.isbn10;
    const status = mapGoodreadsShelf(get(cells, "Exclusive Shelf") || "to-read");
    const review = goodreadsReviewToText(get(cells, "My Review"));
    const shelves = get(cells, "Bookshelves")
      .split(",")
      .map((s) => cleanText(s))
      .filter(Boolean)
      .map((s) => s.slice(0, 80))
      .slice(0, 50);
    const yearRaw = positiveInt(get(cells, "Year Published"), 2200) ?? positiveInt(get(cells, "Original Publication Year"), 2200);
    const privateNotes = cleanText(get(cells, "Private Notes"), false) || null;
    const goodreadsId = unwrapGoodreadsValue(get(cells, "Book Id"));
    const row: ImportRow = {
      goodreadsId: /^\d{1,20}$/.test(goodreadsId) ? goodreadsId : null,
      title,
      authors,
      isbn13,
      isbn10,
      publisher: cleanText(unwrapGoodreadsValue(get(cells, "Publisher"))).slice(0, 200) || null,
      publishedYear: yearRaw,
      pageCount: positiveInt(get(cells, "Number of Pages"), 50_000),
      format: mapGoodreadsBinding(get(cells, "Binding")),
      status,
      dateAdded: parseGoodreadsDate(get(cells, "Date Added")),
      dateRead: status === "finished" ? parseGoodreadsDate(get(cells, "Date Read")) : null,
      sentiment: mapGoodreadsRating(get(cells, "My Rating")),
      review: review ? review.slice(0, 20_000) : null,
      containsSpoilers: unwrapGoodreadsValue(get(cells, "Spoiler")).toLowerCase() === "true",
      privateNotes: privateNotes ? privateNotes.slice(0, 10_000) : null,
      shelves,
    };
    stats[status]++;
    if (row.review || row.sentiment) stats.reviews++;
    rows.push(row);
  }
  return { rows, errors, stats };
}
