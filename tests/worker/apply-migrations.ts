import { applyD1Migrations, env } from "cloudflare:test";

// Runs before each test file: bring the local D1 database up to the latest schema.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
