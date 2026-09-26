import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error that is safe to show to the caller. Anything else becomes a generic 500. */
export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public extra: { fields?: Record<string, string[]>; current?: unknown } = {},
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new ApiError(404, "not_found", what);
export const forbidden = (what = "You do not have permission to do that") => new ApiError(403, "forbidden", what);
export const badRequest = (what: string, fields?: Record<string, string[]>) =>
  new ApiError(400, "bad_request", what, { fields });
export const conflict = (what: string, current?: unknown) => new ApiError(409, "conflict", what, { current });
export const unauthorized = () => new ApiError(401, "unauthorized", "Please sign in");
export const tooManyRequests = (retryAfter?: number) =>
  new ApiError(
    429,
    "rate_limited",
    retryAfter ? `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` : "Too many attempts. Try again later.",
  );
