import type { ClubRole } from "../shared/constants";
import type { AuthSessionData } from "./auth/auth";

/** All Worker bindings: wrangler.jsonc vars + secrets set with `wrangler secret put`. */
type SecretKeys =
  | "BETTER_AUTH_SECRET"
  | "RESEND_API_KEY"
  | "TURNSTILE_SECRET_KEY"
  | "GOOGLE_BOOKS_API_KEY"
  | "PASSWORD_HASH_ITERATIONS"
  | "VAPID_PRIVATE_KEY"
  | "ANTHROPIC_API_KEY"
  | "TWILIO_ACCOUNT_SID"
  | "TWILIO_AUTH_TOKEN"
  | "TWILIO_FROM";

export interface Env extends Omit<CloudflareBindings, SecretKeys> {
  /** PBKDF2 iterations for new password hashes (see worker/auth/password.ts). */
  PASSWORD_HASH_ITERATIONS?: string;
  /** Long random string used by Better Auth to sign cookies/tokens. Secret. */
  BETTER_AUTH_SECRET: string;
  /** Resend API key. Secret. Required when EMAIL_PROVIDER=resend. */
  RESEND_API_KEY?: string;
  /** Cloudflare Turnstile secret key. Secret. */
  TURNSTILE_SECRET_KEY: string;
  /** Optional Google Books API key. Secret. Without it Open Library is used. */
  GOOGLE_BOOKS_API_KEY?: string;
  /** Marketing site origin shown in /api/config (defaults to https://chapterr.io). */
  MARKETING_URL?: string;
  /** R2 bucket for club files. Optional: without it files are stored inline in D1 (2 MB each). */
  FILES?: R2Bucket;
  /** Web Push (VAPID). Public key + subject are vars; the private key is a secret. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_SUBJECT?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Claude Messages API key (discussion guide generation). Secret. */
  ANTHROPIC_API_KEY?: string;
  /** Twilio SMS adapter (meeting reminders). Secrets; all three enable the adapter. */
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
}

/** A clubs row as loaded by requireClubMember. */
export interface ClubRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  plan: "beta_free" | "free" | "standard";
  billingStatus: "active" | "past_due" | "canceled";
  memberLimit: number;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AuthedUser = AuthSessionData["user"];
export type AuthedSession = AuthSessionData["session"];

export interface AppEnv {
  Bindings: Env;
  Variables: {
    user: AuthedUser;
    session: AuthedSession;
    /** Set by requireClubMember on /api/clubs/:clubId/* routes. */
    club: ClubRecord;
    membership: { role: ClubRole; joinedAt: string; muted: boolean };
    /** Sanitised request forwarded to Better Auth by the auth guard. */
    authRequest?: Request;
  };
}

export function isProduction(env: Env): boolean {
  return env.APP_ENV === "production";
}
