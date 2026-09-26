export function formatDate(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  if (!value) return "";
  // Date-only values (YYYY-MM-DD) are calendar dates, not instants.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, opts);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function relativeTime(value: string): string {
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(value);
}

export function authorsLine(authors: string[]): string {
  if (authors.length <= 2) return authors.join(" & ");
  return `${authors.slice(0, 2).join(", ")} & ${authors.length - 2} more`;
}

/** Convert an ISO instant to the value a datetime-local input expects (local time). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert a datetime-local input value to an ISO instant. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
