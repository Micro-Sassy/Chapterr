import type { BookFormat } from "../../shared/constants";
import { normalizeIsbn } from "../../shared/isbn";
import { clip, ProviderError, safeCoverUrl, yearFrom, type CatalogHit, type NormalizedEdition } from "./types";

const BASE = "https://www.googleapis.com/books/v1/volumes";

interface GoogleVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    language?: string;
    printType?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { smallThumbnail?: string; thumbnail?: string; small?: string; medium?: string; large?: string };
  };
  saleInfo?: { isEbook?: boolean };
}

function isbns(v: GoogleVolume) {
  const ids = v.volumeInfo?.industryIdentifiers ?? [];
  const i13 = ids.find((i) => i.type === "ISBN_13")?.identifier;
  const i10 = ids.find((i) => i.type === "ISBN_10")?.identifier;
  const n = normalizeIsbn(i13 ?? i10 ?? null);
  return { isbn13: n.isbn13, isbn10: n.isbn10 ?? (i10 ? normalizeIsbn(i10).isbn10 : null) };
}

function format(v: GoogleVolume): BookFormat {
  return v.saleInfo?.isEbook ? "ebook" : "unknown";
}

function stripHtml(value: string | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function call<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(6000),
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (res.status === 404) throw new ProviderError("Not found");
  if (!res.ok) throw new ProviderError(`Google Books HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function searchGoogleBooks(query: string, apiKey: string): Promise<CatalogHit[]> {
  const params = new URLSearchParams({ q: query, maxResults: "20", printType: "books", key: apiKey });
  const data = await call<{ items?: GoogleVolume[] }>(`${BASE}?${params}`);
  return (data.items ?? [])
    .filter((v) => v.volumeInfo?.title)
    .map((v) => {
      const info = v.volumeInfo!;
      const { isbn13, isbn10 } = isbns(v);
      return {
        provider: "google_books" as const,
        providerId: v.id,
        title: clip(info.title, 300)!,
        subtitle: clip(info.subtitle, 300),
        authors: (info.authors ?? []).map((a) => clip(a, 150)).filter((a): a is string => !!a).slice(0, 20),
        publishedYear: yearFrom(info.publishedDate),
        publisher: clip(info.publisher, 200),
        isbn13,
        isbn10,
        pageCount: info.pageCount && info.pageCount > 0 ? info.pageCount : null,
        coverUrl: safeCoverUrl(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
        format: format(v),
      };
    });
}

export async function getGoogleVolume(id: string, apiKey: string | undefined): Promise<NormalizedEdition> {
  const params = new URLSearchParams(apiKey ? { key: apiKey } : {});
  const v = await call<GoogleVolume>(`${BASE}/${encodeURIComponent(id)}?${params}`);
  const info = v.volumeInfo;
  if (!info?.title) throw new ProviderError("Volume has no title");
  const { isbn13, isbn10 } = isbns(v);
  const links = info.imageLinks ?? {};
  return {
    title: clip(info.title, 300)!,
    subtitle: clip(info.subtitle, 300),
    authors: (info.authors ?? []).map((a) => clip(a, 150)).filter((a): a is string => !!a).slice(0, 20),
    isbn13,
    isbn10,
    publisher: clip(info.publisher, 200),
    publishedDate: clip(info.publishedDate, 20),
    publishedYear: yearFrom(info.publishedDate),
    pageCount: info.pageCount && info.pageCount > 0 ? info.pageCount : null,
    format: format(v),
    language: clip(info.language, 20),
    description: clip(stripHtml(info.description), 10_000),
    coverUrl: safeCoverUrl(links.thumbnail ?? links.smallThumbnail),
    coverUrlLarge: safeCoverUrl(links.medium ?? links.large ?? links.small ?? links.thumbnail),
    googleBooksId: v.id,
    openLibraryId: null,
    openLibraryWorkId: null,
    goodreadsId: null,
    source: "google_books",
  };
}

export async function findGoogleByIsbn(isbn13: string, apiKey: string): Promise<NormalizedEdition | null> {
  const params = new URLSearchParams({ q: `isbn:${isbn13}`, maxResults: "1", key: apiKey });
  const data = await call<{ items?: GoogleVolume[] }>(`${BASE}?${params}`);
  const first = data.items?.[0];
  return first ? getGoogleVolume(first.id, apiKey) : null;
}
