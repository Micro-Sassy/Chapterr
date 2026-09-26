import type { AuthSessionData } from "./auth/auth";

/** All Worker bindings: wrangler.jsonc vars + secrets set with `wrangler secret put`. */
export interface Env extends CloudflareBindings {
  /** Long random string used by Better Auth to sign cookies/tokens. Secret. */
  BETTER_AUTH_SECRET: string;
  /** Resend API key. Secret. Required when EMAIL_PROVIDER=resend. */
  RESEND_API_KEY?: string;
  /** Cloudflare Turnstile secret key. Secret. */
  TURNSTILE_SECRET_KEY: string;
  /** Optional Google Books API key. Secret. Without it Open Library is used. */
  GOOGLE_BOOKS_API_KEY?: string;
}

export type AuthedUser = AuthSessionData["user"];
export type AuthedSession = AuthSessionData["session"];

export interface AppEnv {
  Bindings: Env;
  Variables: {
    user: AuthedUser;
    session: AuthedSession;
    /** Sanitised request forwarded to Better Auth by the auth guard. */
    authRequest?: Request;
  };
}

export function isProduction(env: Env): boolean {
  return env.APP_ENV === "production";
}
