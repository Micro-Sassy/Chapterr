import type { BookFormat } from "../../shared/constants";
import type { CatalogResult } from "../../shared/types";

/** Metadata for one edition, normalised from any provider. */
export interface NormalizedEdition {
  title: string;
  subtitle: string | null;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  publisher: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  format: BookFormat;
  language: string | null;
  description: string | null;
  coverUrl: string | null;
  coverUrlLarge: string | null;
  googleBooksId: string | null;
  openLibraryId: string | null;
  openLibraryWorkId: string | null;
  goodreadsId: string | null;
  source: "google_books" | "open_library" | "manual" | "goodreads";
}

export type CatalogHit = Omit<CatalogResult, "existingEditionId">;

export class ProviderError extends Error {}

export function yearFrom(date: string | null | undefined): number | null {
  const m = date ? /(\d{4})/.exec(date) : null;
  return m ? Number(m[1]) : null;
}

/** Only allow https cover URLs; upgrade http:// Google thumbnails. */
export function safeCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const upgraded = url.replace(/^http:\/\//, "https://");
  try {
    const u = new URL(upgraded);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}
