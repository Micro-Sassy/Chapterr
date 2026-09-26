import { looksLikeIsbn, normalizeIsbn } from "../../shared/isbn";
import type { Env } from "../env";
import { findGoogleByIsbn, getGoogleVolume, searchGoogleBooks } from "./google-books";
import { findOpenLibraryByIsbn, getOpenLibraryEdition, searchOpenLibrary } from "./open-library";
import { ProviderError, type CatalogHit, type NormalizedEdition } from "./types";

/**
 * Catalogue search strategy (all free):
 *   1. Google Books when GOOGLE_BOOKS_API_KEY is configured (better metadata).
 *   2. Open Library otherwise, or whenever Google fails (quota, outage).
 * If both fail, local results still work and the UI offers manual entry.
 */
export async function searchCatalog(
  env: Env,
  query: string,
): Promise<{ hits: CatalogHit[]; provider: "google_books" | "open_library" | "none"; error: string | null }> {
  const q = looksLikeIsbn(query) ? `isbn:${normalizeIsbn(query).isbn13}` : query;
  if (env.GOOGLE_BOOKS_API_KEY) {
    try {
      return { hits: await searchGoogleBooks(q, env.GOOGLE_BOOKS_API_KEY), provider: "google_books", error: null };
    } catch (err) {
      console.warn("Google Books search failed; falling back to Open Library", err instanceof Error ? err.message : err);
    }
  }
  try {
    const olQuery = looksLikeIsbn(query) ? `isbn:${normalizeIsbn(query).isbn13}` : query;
    return { hits: await searchOpenLibrary(olQuery, env.PUBLIC_APP_URL), provider: "open_library", error: null };
  } catch (err) {
    console.warn("Open Library search failed", err instanceof Error ? err.message : err);
    return { hits: [], provider: "none", error: "Book search services are unavailable right now. You can still add a book manually." };
  }
}

export async function fetchProviderEdition(
  env: Env,
  provider: "google_books" | "open_library" | "isbn",
  providerId: string,
): Promise<NormalizedEdition> {
  if (provider === "google_books") return getGoogleVolume(providerId, env.GOOGLE_BOOKS_API_KEY);
  if (provider === "open_library") return getOpenLibraryEdition(providerId, env.PUBLIC_APP_URL);
  const { isbn13 } = normalizeIsbn(providerId);
  if (!isbn13) throw new ProviderError("Invalid ISBN");
  if (env.GOOGLE_BOOKS_API_KEY) {
    try {
      const g = await findGoogleByIsbn(isbn13, env.GOOGLE_BOOKS_API_KEY);
      if (g) return g;
    } catch {
      // fall through to Open Library
    }
  }
  const ol = await findOpenLibraryByIsbn(isbn13, env.PUBLIC_APP_URL);
  if (!ol) throw new ProviderError("Not found");
  return ol;
}
