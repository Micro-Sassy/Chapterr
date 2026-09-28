/** URL-safe random identifier (128 bits). */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return base64Url(bytes);
}

/** URL-safe random secret token (256 bits) for share links. */
export function newToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The member's local calendar date, sent by the browser as `?today=YYYY-MM-DD`.
 * Accepted only within a day of UTC (every real time zone is); otherwise UTC.
 */
export function localToday(hint: string | undefined | null): string {
  const utc = nowIso().slice(0, 10);
  if (!hint || !/^\d{4}-\d{2}-\d{2}$/.test(hint)) return utc;
  const diff = Math.abs(Date.parse(`${hint}T00:00:00Z`) - Date.parse(`${utc}T00:00:00Z`));
  return Number.isFinite(diff) && diff <= 86_400_000 ? hint : utc;
}

/** e.g. "Thursday, October 2, 2026, 7:00 PM CDT" in the given IANA zone (UTC if unknown). */
export function formatMeetingTime(iso: string, timeZone: string | undefined | null): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timeZone || "UTC", timeZoneName: "short" }).format(new Date(iso));
  } catch {
    // Unknown time zone name from the client.
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC", timeZoneName: "short" }).format(new Date(iso));
  }
}

export function currentYear(): number {
  return new Date().getUTCFullYear();
}

/** Constant-time comparison of equal-length byte arrays. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape LIKE wildcards so user text is matched literally (used with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}
