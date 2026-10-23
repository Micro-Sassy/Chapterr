import type { BookFormat } from "../../shared/constants";
import { normalizeIsbn } from "../../shared/isbn";
import { clip, ProviderError, yearFrom, type CatalogHit, type NormalizedEdition } from "./types";

const BASE = "https://openlibrary.org";

function headers(appUrl: string) {
  // Open Library asks API clients to identify themselves.
  return { Accept: "application/json", "User-Agent": `Chapterr/1.0 (+${appUrl})` };
}

async function call<T>(url: string, appUrl: string): Promise<T> {
  // Catalogue data changes rarely: let Cloudflare's edge cache it for a day.
  const res = await fetch(url, {
    headers: headers(appUrl),
    redirect: "follow",
    signal: AbortSignal.timeout(6000),
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (res.status === 404) throw new ProviderError("Not found");
  if (!res.ok) throw new ProviderError(`Open Library HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function openLibraryCover(coverId: number | undefined | null, size: "M" | "L" = "M"): string | null {
  return coverId && coverId > 0 ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null;
}

/** Open Library can also look a cover up by ISBN; `default=false` makes a miss a 404 instead of a blank image. */
export function openLibraryIsbnCover(isbn13: string | null | undefined, size: "M" | "L" = "M"): string | null {
  return isbn13 ? `https://covers.openlibrary.org/b/isbn/${isbn13}-${size}.jpg?default=false` : null;
}

export function mapOpenLibraryFormat(value: string | undefined | null): BookFormat {
  const v = (value ?? "").toLowerCase();
  if (!v) return "unknown";
  if (v.includes("hard")) return "hardcover";
  if (v.includes("paper") || v.includes("mass market")) return "paperback";
  if (v.includes("ebook") || v.includes("e-book") || v.includes("kindle") || v.includes("electronic")) return "ebook";
  if (v.includes("audio")) return "audiobook";
  return "other";
}

interface SearchDoc {
  key: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  editions?: {
    docs?: {
      key: string;
      title?: string;
      subtitle?: string;
      cover_i?: number;
      publisher?: string[];
      publish_date?: string[];
      isbn?: string[];
      format?: string[];
      number_of_pages_median?: number;
    }[];
  };
}

const EDITION_FIELDS = [
  "key",
  "title",
  "subtitle",
  "author_name",
  "first_publish_year",
  "cover_i",
  "editions",
  "editions.key",
  "editions.title",
  "editions.subtitle",
  "editions.isbn",
  "editions.publisher",
  "editions.publish_date",
  "editions.cover_i",
  "editions.format",
].join(",");

export async function searchOpenLibrary(query: string, appUrl: string): Promise<CatalogHit[]> {
  const params = new URLSearchParams({ q: query, limit: "20", fields: EDITION_FIELDS });
  const data = await call<{ docs?: SearchDoc[] }>(`${BASE}/search.json?${params}`, appUrl);
  const hits: CatalogHit[] = [];
  for (const doc of data.docs ?? []) {
    const ed = doc.editions?.docs?.[0];
    if (!ed?.key) continue;
    const olid = ed.key.replace("/books/", "");
    if (!/^OL\d+M$/.test(olid)) continue;
    // Prefer an ISBN-13, fall back to converting an ISBN-10.
    const isbnList = ed.isbn ?? [];
    const i13 = isbnList.map((i) => normalizeIsbn(i)).find((n) => n.isbn13);
    const title = clip(ed.title ?? doc.title, 300);
    if (!title) continue;
    hits.push({
      provider: "open_library",
      providerId: olid,
      title,
      subtitle: clip(ed.subtitle ?? doc.subtitle, 300),
      authors: (doc.author_name ?? []).map((a) => clip(a, 150)).filter((a): a is string => !!a).slice(0, 20),
      publishedYear: yearFrom(ed.publish_date?.[0]) ?? doc.first_publish_year ?? null,
      publisher: clip(ed.publisher?.[0], 200),
      isbn13: i13?.isbn13 ?? null,
      isbn10: i13?.isbn10 ?? null,
      pageCount: null,
      coverUrl: openLibraryCover(ed.cover_i ?? doc.cover_i) ?? openLibraryIsbnCover(i13?.isbn13),
      format: mapOpenLibraryFormat(ed.format?.[0]),
    });
  }
  return hits;
}

interface OLEdition {
  key: string;
  title?: string;
  subtitle?: string;
  publishers?: string[];
  publish_date?: string;
  number_of_pages?: number;
  isbn_13?: string[];
  isbn_10?: string[];
  covers?: number[];
  works?: { key: string }[];
  physical_format?: string;
  languages?: { key: string }[];
  description?: string | { value?: string };
  authors?: { key: string }[];
}

interface OLWork {
  description?: string | { value?: string };
  authors?: { author?: { key: string } }[];
}

function text(value: string | { value?: string } | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : (value.value ?? null);
}

async function authorNames(keys: string[], appUrl: string): Promise<string[]> {
  const names = await Promise.all(
    keys.slice(0, 5).map(async (key) => {
      try {
        const a = await call<{ name?: string; personal_name?: string }>(`${BASE}${key}.json`, appUrl);
        return clip(a.name ?? a.personal_name, 150);
      } catch {
        return null;
      }
    }),
  );
  return names.filter((n): n is string => !!n);
}

async function normalizeEdition(ed: OLEdition, appUrl: string): Promise<NormalizedEdition> {
  const title = clip(ed.title, 300);
  if (!title) throw new ProviderError("Edition has no title");
  const workKey = ed.works?.[0]?.key ?? null;
  const isAuthorKey = (k: string) => /^\/authors\/OL\d+A$/.test(k);
  const editionAuthorKeys = (ed.authors?.map((a) => a.key) ?? []).filter(isAuthorKey);
  // Fetch the work (description, author fallback) and the edition's authors in parallel.
  const [work, editionAuthors] = await Promise.all([
    workKey ? call<OLWork>(`${BASE}${workKey}.json`, appUrl).catch(() => null) : Promise.resolve(null),
    editionAuthorKeys.length ? authorNames(editionAuthorKeys, appUrl) : Promise.resolve([] as string[]),
  ]);
  const authors = editionAuthors.length
    ? editionAuthors
    : await authorNames((work?.authors?.map((a) => a.author?.key).filter((k): k is string => !!k) ?? []).filter(isAuthorKey), appUrl);
  const n13 = normalizeIsbn(ed.isbn_13?.[0] ?? null);
  const n10 = normalizeIsbn(ed.isbn_10?.[0] ?? null);
  const coverId = ed.covers?.find((c) => c > 0);
  const lang = ed.languages?.[0]?.key?.replace("/languages/", "") ?? null;
  return {
    title,
    subtitle: clip(ed.subtitle, 300),
    authors: authors.length ? authors : ["Unknown author"],
    isbn13: n13.isbn13 ?? n10.isbn13,
    isbn10: n10.isbn10 ?? n13.isbn10,
    publisher: clip(ed.publishers?.[0], 200),
    publishedDate: clip(ed.publish_date, 20),
    publishedYear: yearFrom(ed.publish_date),
    pageCount: ed.number_of_pages && ed.number_of_pages > 0 ? ed.number_of_pages : null,
    format: mapOpenLibraryFormat(ed.physical_format),
    language: clip(lang, 20),
    description: clip(text(ed.description) ?? text(work?.description), 10_000),
    coverUrl: openLibraryCover(coverId, "M") ?? openLibraryIsbnCover(n13.isbn13 ?? n10.isbn13, "M"),
    coverUrlLarge: openLibraryCover(coverId, "L") ?? openLibraryIsbnCover(n13.isbn13 ?? n10.isbn13, "L"),
    googleBooksId: null,
    openLibraryId: ed.key.replace("/books/", ""),
    openLibraryWorkId: workKey ? workKey.replace("/works/", "") : null,
    goodreadsId: null,
    source: "open_library",
  };
}

export async function getOpenLibraryEdition(olid: string, appUrl: string): Promise<NormalizedEdition> {
  const ed = await call<OLEdition>(`${BASE}/books/${encodeURIComponent(olid)}.json`, appUrl);
  return normalizeEdition(ed, appUrl);
}

export async function findOpenLibraryByIsbn(isbn: string, appUrl: string): Promise<NormalizedEdition | null> {
  try {
    const ed = await call<OLEdition>(`${BASE}/isbn/${encodeURIComponent(isbn)}.json`, appUrl);
    return normalizeEdition(ed, appUrl);
  } catch (err) {
    if (err instanceof ProviderError && err.message === "Not found") return null;
    throw err;
  }
}
