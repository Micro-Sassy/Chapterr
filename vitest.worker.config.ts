import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// API / permission / realtime tests that run inside the real Workers runtime
// (workerd via Miniflare) against a local D1 database with all migrations applied.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    resolve: {
      alias: {
        "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      },
    },
    plugins: [
      cloudflareTest({
        main: "./worker/index.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            APP_ENV: "test",
            PUBLIC_APP_URL: "http://localhost",
            BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth-0123456789",
            EMAIL_PROVIDER: "console",
            EMAIL_FROM: "Teel Ridge Book Club <test@example.com>",
            TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
            TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      include: ["tests/worker/**/*.test.ts"],
      setupFiles: ["./tests/worker/apply-migrations.ts"],
    },
  };
});
