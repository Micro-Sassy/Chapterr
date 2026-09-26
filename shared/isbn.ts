/** Strip everything except digits and a trailing X. */
export function cleanIsbn(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.toUpperCase().replace(/[^0-9X]/g, "");
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = isbn[i]!;
    const value = ch === "X" ? 10 : Number(ch);
    sum += value * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(isbn[12]);
}

export function isbn10To13(isbn10: string): string | null {
  if (!isValidIsbn10(isbn10)) return null;
  const core = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

export function isbn13To10(isbn13: string): string | null {
  if (!isValidIsbn13(isbn13) || !isbn13.startsWith("978")) return null;
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return `${core}${check === 10 ? "X" : String(check)}`;
}

/**
 * Normalise any ISBN-ish input into a valid ISBN-13 and (when derivable) ISBN-10.
 * Returns null values when the input is not a valid ISBN.
 */
export function normalizeIsbn(raw: string | null | undefined): { isbn13: string | null; isbn10: string | null } {
  const cleaned = cleanIsbn(raw);
  if (cleaned.length === 13 && isValidIsbn13(cleaned)) {
    return { isbn13: cleaned, isbn10: isbn13To10(cleaned) };
  }
  if (cleaned.length === 10 && isValidIsbn10(cleaned)) {
    return { isbn13: isbn10To13(cleaned), isbn10: cleaned };
  }
  return { isbn13: null, isbn10: null };
}

export function looksLikeIsbn(query: string): boolean {
  const cleaned = cleanIsbn(query);
  return (cleaned.length === 13 && isValidIsbn13(cleaned)) || (cleaned.length === 10 && isValidIsbn10(cleaned));
}
