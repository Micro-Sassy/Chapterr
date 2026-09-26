-- Migration 0001: Better Auth core tables (+ username plugin fields).
-- Column names follow Better Auth's default camelCase field names.
-- Dates are stored as ISO-8601 text; booleans as 0/1 integers.

CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "username" TEXT UNIQUE,
  "displayUsername" TEXT
);
-- Defence in depth: usernames are already lowercased by the app, but make
-- uniqueness case-insensitive at the database level too.
CREATE UNIQUE INDEX "user_username_nocase_idx" ON "user" ("username" COLLATE NOCASE);
CREATE UNIQUE INDEX "user_email_nocase_idx" ON "user" ("email" COLLATE NOCASE);

CREATE TABLE "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");

CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TEXT,
  "refreshTokenExpiresAt" TEXT,
  "scope" TEXT,
  -- Password hash only (PBKDF2-SHA256, see worker/auth/password.ts). Never plaintext.
  "password" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("userId");

CREATE TABLE "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  -- Stored hashed (verification.storeIdentifier = "hashed"), so reset tokens are never kept in plaintext.
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
