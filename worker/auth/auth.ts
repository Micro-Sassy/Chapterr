import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { APP_NAME, LIMITS } from "../../shared/constants";
import { isValidUsername } from "../../shared/schemas";
import { createEmailProvider } from "../email";
import {
  changeEmailVerification,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from "../email/templates";
import type { Env } from "../env";
import { isProduction } from "../env";
import { nowIso } from "../lib/util";
import { disconnectUser } from "../realtime/publish";
import { consumeRateLimit, scaleRule } from "../security/rate-limit";
import { hashPassword, resolveIterations, verifyPassword } from "./password";

function buildAuth(env: Env) {
  const production = isProduction(env);
  const baseURL = env.PUBLIC_APP_URL.replace(/\/+$/, "");
  const r = (window: number, max: number) => scaleRule(env, { window, max });

  return betterAuth({
    appName: env.APP_NAME || APP_NAME,
    baseURL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    // Native Cloudflare D1 support in Better Auth.
    database: env.DB,
    trustedOrigins: [baseURL],
    telemetry: { enabled: false },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: LIMITS.passwordMin,
      maxPasswordLength: LIMITS.passwordMax,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      password: { hash: (pw) => hashPassword(pw, resolveIterations(env.PASSWORD_HASH_ITERATIONS)), verify: verifyPassword },
      sendResetPassword: async ({ user, url }) => {
        await createEmailProvider(env).send(passwordResetEmail(user.email, user.name, url));
      },
      onPasswordReset: async ({ user }) => {
        // Sessions are revoked by Better Auth; also drop any open realtime sockets.
        await disconnectUser(env, user.id).catch(() => undefined);
        await createEmailProvider(env)
          .send(passwordChangedEmail(user.email, user.name))
          .catch((err) => console.error("password-changed notice failed", err instanceof Error ? err.message : err));
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        const provider = createEmailProvider(env);
        // Change-of-email verifications are addressed to the new address.
        const isChange = user.emailVerified;
        await provider.send(isChange ? changeEmailVerification(user.email, user.name, url) : verificationEmail(user.email, user.name, url));
      },
    },

    user: {
      changeEmail: { enabled: true },
      deleteUser: { enabled: true },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh expiry at most once a day
      // No cookie cache: every request re-checks the session row so revocation is immediate.
    },

    verification: {
      // Password-reset and other verification identifiers are stored as hashes.
      storeIdentifier: "hashed",
    },

    rateLimit: {
      enabled: true,
      window: 60,
      max: production ? 120 : 1200,
      customRules: {
        "/sign-in/email": r(15 * 60, 10),
        "/sign-in/username": r(15 * 60, 10),
        "/sign-up/email": r(60 * 60, 5),
        "/request-password-reset": r(60 * 60, 5),
        "/reset-password": r(60 * 60, 10),
        "/send-verification-email": r(60 * 60, 5),
        "/change-password": r(15 * 60, 10),
        "/verify-email": r(60 * 60, 20),
        "/get-session": false,
      },
      customStorage: {
        consume: (key, rule) => consumeRateLimit(env.DB, `auth:${key}`, rule),
      },
    },

    advanced: {
      cookiePrefix: "chapterr",
      useSecureCookies: production || baseURL.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },

    plugins: [
      username({
        minUsernameLength: LIMITS.usernameMin,
        maxUsernameLength: LIMITS.usernameMax,
        usernameValidator: isValidUsername,
        usernameNormalization: (value) => value.trim().toLowerCase(),
        validationOrder: { username: "post-normalization" },
      }),
    ],

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const now = nowIso();
            // Registration is validated (including acceptance of the privacy
            // notice) before Better Auth runs, see routes/auth-guard.ts.
            await env.DB.batch([
              env.DB.prepare(
                "INSERT OR IGNORE INTO profiles (user_id, privacy_accepted_at, created_at, updated_at) VALUES (?, ?, ?, ?)",
              ).bind(user.id, now, now, now),
              env.DB.prepare("INSERT OR IGNORE INTO notification_preferences (user_id, updated_at) VALUES (?, ?)").bind(
                user.id,
                now,
              ),
            ]);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;
export type AuthSessionData = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

/**
 * A fresh Better Auth instance for each call. Instances must NOT be cached
 * across requests: Better Auth lazily initialises internal promises on first
 * use, and in Workers a promise created during one request cannot be awaited
 * by another — if the first request is cancelled (e.g. a search the browser
 * aborted), every later request waiting on it hangs until the client gives up.
 */
export function getAuth(env: Env): Auth {
  return buildAuth(env);
}
