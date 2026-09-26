import type { ApiErrorBody } from "@shared/types";

export class ApiRequestError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string[]>;
  current?: unknown;
  constructor(status: number, code: string, message: string, fields?: Record<string, string[]>, current?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.current = current;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** JSON request to our own API. Cookies are same-origin and HttpOnly. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError(0, "offline", navigator.onLine ? "Could not reach the server. Please try again." : "You are offline.");
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const envelope = data as Partial<ApiErrorBody> & { message?: string; code?: string };
    const err = envelope?.error;
    throw new ApiRequestError(
      res.status,
      err?.code ?? envelope?.code ?? "error",
      err?.message ?? envelope?.message ?? `Request failed (${res.status})`,
      err?.fields,
      err?.current,
    );
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
