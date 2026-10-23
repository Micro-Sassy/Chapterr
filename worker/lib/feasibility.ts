import type { Feasibility } from "../../shared/types";
import { nowIso } from "./util";

/**
 * "Can everyone get this book?" Free, keyless lookups: Open Library / Internet
 * Archive lending status, Google Books list price. Everything else is a search
 * link labelled best-effort. Results are cached for 24 hours in the Workers
 * cache; each upstream call has a short timeout and degrades to null.
 */

const TTL_SECONDS = 86_400;
const AVERAGE_PAGES_PER_HOUR = 40;

export interface FeasibilityEdition {
  id: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  pageCount: number | null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Chapterr/1.0 (+https://chapterr.io)" },
      signal: AbortSignal.timeout(4000),
      cf: { cacheTtl: TTL_SECONDS, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function buildLinks(edition: FeasibilityEdition) {
  const q = encodeURIComponent([edition.title, edition.authors[0] ?? ""].filter(Boolean).join(" "));
  return {
    worldcatUrl: edition.isbn13 ? `https://search.worldcat.org/isbn/${edition.isbn13}` : null,
    kindleSearchUrl: `https://www.amazon.com/s?k=${q}&i=digital-text`,
    libroFmUrl: `https://libro.fm/search?q=${q}`,
    audibleSearchUrl: `https://www.audible.com/search?keywords=${q}`,
    googleBooksUrl: edition.isbn13 ? `https://www.google.com/books/feeds/volumes?q=isbn:${edition.isbn13}` : null,
  };
}

interface OpenLibraryEdition {
  ocaid?: string;
}
interface ArchiveSearch {
  response?: { docs?: { identifier?: string }[] };
}
interface ArchiveAvailability {
  lending_status?: string;
  status?: string;
  is_lendable?: boolean;
  is_readable?: boolean;
  is_browsable?: boolean;
}
interface GoogleVolumes {
  items?: {
    volumeInfo?: { infoLink?: string; canonicalVolumeLink?: string };
    saleInfo?: { saleability?: string; listPrice?: { amount?: number; currencyCode?: string }; buyLink?: string };
  }[];
}

/** Internet Archive identifier for an ISBN: Open Library's `ocaid` first, then the archive.org search. */
async function archiveIdentifier(isbn13: string): Promise<string | null> {
  const ol = await getJson<OpenLibraryEdition>(`https://openlibrary.org/isbn/${isbn13}.json`);
  if (ol?.ocaid) return ol.ocaid;
  const search = await getJson<ArchiveSearch>(`https://archive.org/advancedsearch.php?q=isbn:${isbn13}&fl[]=identifier&rows=1&output=json`);
  const id = search?.response?.docs?.[0]?.identifier;
  return typeof id === "string" && id ? id : null;
}

async function lendability(identifier: string): Promise<boolean | null> {
  const data = await getJson<ArchiveAvailability>(`https://archive.org/services/loans/loan/?action=availability&identifier=${encodeURIComponent(identifier)}`);
  if (!data) return null;
  if (data.is_lendable === true || data.is_readable === true || data.is_browsable === true) return true;
  const status = (data.lending_status ?? data.status ?? "").toLowerCase();
  if (!status) return null;
  return /lendable|readable|browsable|available/.test(status);
}

function formatPrice(amount: number | undefined, currency: string | undefined): string | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/** Compute feasibility without the cache (exported for tests and the cached wrapper). */
export async function computeFeasibility(edition: FeasibilityEdition): Promise<Feasibility> {
  const links = buildLinks(edition);
  let openLibraryLendable: boolean | null = null;
  let archiveOrgUrl: string | null = null;
  let googleBooksPrice: string | null = null;
  let googleBooksUrl: string | null = null;
  if (edition.isbn13) {
    const [identifier, google] = await Promise.all([
      archiveIdentifier(edition.isbn13),
      getJson<GoogleVolumes>(`https://www.googleapis.com/books/v1/volumes?q=isbn:${edition.isbn13}&maxResults=1`),
    ]);
    if (identifier) {
      archiveOrgUrl = `https://archive.org/details/${encodeURIComponent(identifier)}`;
      openLibraryLendable = await lendability(identifier);
    }
    const item = google?.items?.[0];
    if (item) {
      googleBooksPrice = formatPrice(item.saleInfo?.listPrice?.amount, item.saleInfo?.listPrice?.currencyCode);
      googleBooksUrl = item.saleInfo?.buyLink ?? item.volumeInfo?.canonicalVolumeLink ?? item.volumeInfo?.infoLink ?? links.googleBooksUrl;
    }
  }
  const pageCount = edition.pageCount && edition.pageCount > 0 ? edition.pageCount : null;
  return {
    pageCount,
    estimatedHours: pageCount ? Math.round((pageCount / AVERAGE_PAGES_PER_HOUR) * 10) / 10 : null,
    library: { openLibraryLendable, archiveOrgUrl, worldcatUrl: links.worldcatUrl },
    ebook: { googleBooksPrice, googleBooksUrl, kindleSearchUrl: links.kindleSearchUrl, kindleUnlimited: "unknown" },
    audio: { libroFmUrl: links.libroFmUrl, audibleSearchUrl: links.audibleSearchUrl },
    checkedAt: nowIso(),
  };
}

/** Feasibility with a 24 h cache keyed by edition id (Workers Cache API; a miss or error just recomputes). */
export async function getFeasibility(edition: FeasibilityEdition): Promise<Feasibility> {
  const cacheKey = new Request(`https://feasibility.chapterr.internal/editions/${encodeURIComponent(edition.id)}?v=1`);
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) return (await hit.json()) as Feasibility;
  } catch {
    // cache is best effort
  }
  const result = await computeFeasibility(edition);
  try {
    await caches.default.put(
      cacheKey,
      new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${TTL_SECONDS}` } }),
    );
  } catch {
    // cache is best effort
  }
  return result;
}
