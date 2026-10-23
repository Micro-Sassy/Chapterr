import { WAVE2_LIMITS } from "@shared/constants";

export interface InviteRow {
  /** 1-based line number in the pasted text. */
  row: number;
  email: string;
  name: string;
  valid: boolean;
  reason: string | null;
}

export interface InviteCsvPreview {
  rows: InviteRow[];
  valid: number;
  invalid: number;
  duplicates: number;
  /** True when the first line looked like a header and was skipped. */
  hadHeader: boolean;
  tooMany: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Split one CSV line on commas, honouring double quotes. Also accepts tabs and semicolons. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t" || ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Preview a bulk-invite CSV (columns: email[,name]) before sending. Blank lines are
 * skipped; a header row is detected and dropped; duplicates and bad addresses are
 * flagged, not removed, so the admin can see what will be skipped.
 */
export function parseInviteCsv(text: string): InviteCsvPreview {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const rows: InviteRow[] = [];
  const seen = new Set<string>();
  let hadHeader = false;
  let duplicates = 0;
  lines.forEach((raw, idx) => {
    if (!raw.trim()) return;
    const cells = splitCsvLine(raw);
    // Name-first columns ("Jane Doe, jane@x.com") are accepted too.
    const emailIdx = cells.findIndex((c) => c.includes("@"));
    const email = (emailIdx >= 0 ? cells[emailIdx]! : cells[0]!).replace(/^<|>$/g, "").toLowerCase();
    const name = cells.filter((_, i) => i !== emailIdx).find((c) => c) ?? "";
    if (rows.length === 0 && idx === 0 && !hadHeader && !email.includes("@") && /e-?mail|address/i.test(raw)) {
      hadHeader = true;
      return;
    }
    let reason: string | null = null;
    if (!email) reason = "No email address";
    else if (!EMAIL_RE.test(email)) reason = "Not a valid email address";
    else if (seen.has(email)) {
      reason = "Repeated in this list";
      duplicates++;
    }
    if (!reason) seen.add(email);
    rows.push({ row: idx + 1, email, name, valid: !reason, reason });
  });
  const valid = rows.filter((r) => r.valid).length;
  return { rows, valid, invalid: rows.length - valid, duplicates, hadHeader, tooMany: valid > WAVE2_LIMITS.bulkInviteRowsMax };
}

/** Rebuild a clean CSV (email,name) from the valid rows, which is what the API receives. */
export function toInviteCsv(preview: InviteCsvPreview): string {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return preview.rows
    .filter((r) => r.valid)
    .map((r) => (r.name ? `${r.email},${quote(r.name)}` : r.email))
    .join("\n");
}
