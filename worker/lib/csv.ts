/**
 * Small RFC 4180 CSV helpers: a tolerant parser for member-supplied invite
 * lists and a strict serialiser for exports. No dependencies.
 */

/** Parse CSV text into rows of cells. Handles quoted cells, doubled quotes, CRLF and a trailing newline. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  // Strip a UTF-8 BOM.
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop rows that are entirely blank.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface InviteRow {
  /** 1-based line number in the original file (after blank lines are dropped). */
  row: number;
  email: string;
  name: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Interpret a parsed CSV as an invite list: columns `email[,name]`, header row
 * optional (detected when the first row has no "@" or names the column). A row
 * whose first cell is not an email is reported in `invalid`.
 */
export function parseInviteCsv(text: string): { rows: InviteRow[]; invalid: { row: number; value: string; reason: string }[] } {
  const parsed = parseCsv(text);
  const rows: InviteRow[] = [];
  const invalid: { row: number; value: string; reason: string }[] = [];
  let emailCol = 0;
  let nameCol: number | null = 1;
  let start = 0;
  const head = parsed[0];
  if (head) {
    const lower = head.map((c) => c.trim().toLowerCase());
    const headerLike = !lower.some((c) => c.includes("@"));
    if (headerLike) {
      start = 1;
      const e = lower.findIndex((c) => c === "email" || c === "e-mail" || c === "email address");
      const n = lower.findIndex((c) => c === "name" || c === "full name" || c === "display name");
      if (e >= 0) emailCol = e;
      nameCol = n >= 0 ? n : head.length > 1 ? (emailCol === 0 ? 1 : 0) : null;
    }
  }
  for (let i = start; i < parsed.length; i++) {
    const cells = parsed[i]!;
    const lineNo = i + 1;
    const rawEmail = (cells[emailCol] ?? "").trim().replace(/^<|>$/g, "");
    const email = rawEmail.toLowerCase();
    if (!email) {
      invalid.push({ row: lineNo, value: rawEmail, reason: "Missing email" });
      continue;
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      invalid.push({ row: lineNo, value: rawEmail, reason: "Not a valid email address" });
      continue;
    }
    const name = nameCol === null ? null : (cells[nameCol] ?? "").trim().slice(0, 60) || null;
    rows.push({ row: lineNo, email, name });
  }
  return { rows, invalid };
}

/** Quote a cell when needed. Cells starting with = + - @ are prefixed with a quote so spreadsheets never run them as formulas. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
