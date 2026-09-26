declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    BETTER_AUTH_SECRET: string;
    TURNSTILE_SECRET_KEY: string;
    RESEND_API_KEY?: string;
    GOOGLE_BOOKS_API_KEY?: string;
  }
}
