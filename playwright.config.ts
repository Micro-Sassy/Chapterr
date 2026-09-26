import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5173);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

/**
 * End-to-end tests run against the local dev server (Vite + Workers runtime
 * + local D1). They need `npm run setup:local` once (creates .dev.vars with
 * Cloudflare's Turnstile *testing* keys and the console email provider).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
