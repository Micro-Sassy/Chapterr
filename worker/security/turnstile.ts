import type { Env } from "../env";
import { ApiError } from "../lib/errors";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
  action?: string;
}

/**
 * Verify a Turnstile token server-side. Fails closed: any network or provider
 * error is treated as a failed challenge.
 */
export async function verifyTurnstile(env: Env, token: string | null | undefined, ip: string | null): Promise<boolean> {
  if (!token || token.length > 2048) return false;
  if (!env.TURNSTILE_SECRET_KEY) {
    console.error("TURNSTILE_SECRET_KEY is not configured; rejecting request");
    return false;
  }
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  body.append("idempotency_key", crypto.randomUUID());
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const data = (await res.json()) as TurnstileResult;
    return data.success === true;
  } catch (err) {
    console.error("Turnstile verification failed", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function requireTurnstile(env: Env, token: string | null | undefined, ip: string | null): Promise<void> {
  if (!(await verifyTurnstile(env, token, ip))) {
    throw new ApiError(403, "captcha_failed", "The anti-spam check failed. Please try again.");
  }
}

export function clientIp(req: Request): string | null {
  return req.headers.get("cf-connecting-ip");
}
