# Architecture

## One deployable Worker

```
Browser (React SPA, service worker)
   │  HTTPS (same origin)                     wss:// /api/realtime
   ▼                                              │
Cloudflare Worker ─ static assets (dist/client) ──┤
   │  /api/* → Hono app                            ▼
   │    ├─ /api/auth/*  → auth guard → Better Auth ─┐
   │    ├─ /api/public/* (share links, no session)  │
   │    └─ everything else → requireUser            │
   │                                                ▼
   ├──────────────► D1 (SQLite) ◄──────── authoritative data
   └──────────────► ClubRealtime Durable Object (WebSocket fan-out only)
```

- `wrangler.jsonc` sets `assets.run_worker_first: ["/api/*"]`, so API paths always run the Worker and every other path is served from static assets with SPA fallback.
- The Cloudflare Vite plugin builds both the client (`dist/client`) and the Worker in one `vite build`, and runs the Worker in the real `workerd` runtime during `vite dev`.

## Request pipeline (worker/index.ts)

1. `securityHeaders` — nosniff, frame denial, referrer policy, `X-Robots-Tag`, HSTS in production, `Cache-Control: no-store` on API responses.
2. `bodyLimit` — 2 MB per API request.
3. `sameOriginGuard` — state-changing requests must carry our `Origin` (CSRF defence in addition to SameSite=Lax cookies).
4. Auth routes go through `routes/auth-guard.ts`: endpoint allowlist, Turnstile verification, per-identifier rate limits, and request bodies rebuilt from validated fields before Better Auth sees them.
5. `requireUser` — resolves the Better Auth session from the cookie and requires a verified email. Mounted in front of every private route.
6. Route handlers validate input with the Zod schemas in `shared/schemas.ts` and query D1 with parameterised statements.
7. `onError` converts `ApiError`s to `{ error: { code, message, fields?, current? } }`; unexpected errors are logged and returned as a generic 500.

## Data model (migrations/)

- Better Auth tables: `user` (with `username`/`displayUsername`), `session`, `account`, `verification`.
- Catalogue: `books` (works, grouped by Open Library work id or normalised title|author) → `book_editions` (unique ISBN-13, provider ids, per-edition metadata). `genres` + `book_genres` (work-level tags shared by all editions).
- Personal: `profiles`, `avatars`, `notification_preferences`, `user_books`, `reviews`, `review_reactions`, `quotes`, `personal_reading_goals`, `recommendations`, `imports`.
- Shared club: `club_annual_goals`, `club_annual_books`, `club_meetings`, `club_assignments`, `club_activities` — each with `version`, `created_by`, `updated_by`, `created_at`, `updated_at` and (where archivable) `archived_at`.
- Messaging: `conversations` (one `club` row + `direct` rows keyed by the sorted user-id pair), `conversation_participants` (also tracks `last_read_at`), `messages` (soft delete nulls the body; a CHECK constraint enforces it).
- `share_links` (hashed tokens; `resource_type` CHECK excludes chats), `notifications`, `rate_limits`, `dev_outbox` (local development only).

Timestamps are ISO-8601 UTC strings; calendar dates (`finished_at`, `due_date`) are `YYYY-MM-DD`.

## Optimistic concurrency

Shared records are updated with `UPDATE … SET …, version = version + 1 WHERE id = ? AND version = ?` (`worker/lib/versioned.ts`). Zero changed rows means someone else saved first: the API returns **409** with the current record in `error.current`, and the UI refreshes and explains. List reordering sends the full ordered id list and is rejected if the set of entries changed meanwhile.

## Realtime

- The browser opens one WebSocket to `/api/realtime`. The Worker authenticates it like any API call, checks the `Origin`, and forwards the upgrade to the single `ClubRealtime` Durable Object with trusted identity headers (user id, session id, session expiry).
- The Durable Object accepts the socket with the Hibernation API and tags it `user:<id>` and `session:<id>`. It never decides permissions.
- After a message is committed to D1, the Worker calls `publish(userIds | "all", event)` over RPC. Direct messages go only to the two participants; club messages to every connected member. Sockets past their session expiry are closed on use.
- Sign-out, session revocation, password change/reset and account deletion close the relevant sockets.
- On (re)connect the client refetches conversations, so anything missed while offline is loaded from D1.

## PWA and offline behaviour

- `vite-plugin-pwa` (Workbox `generateSW`) precaches the built app shell. Navigations fall back to the cached `index.html`, so the app opens offline.
- API responses are **not** cached by the service worker (privacy on shared devices). Offline, pages show what TanStack Query already has in memory, an offline banner appears, and composing messages is disabled.
- Book covers from Open Library/Google are cached (cache-first, 30 days).
- `registerType: "prompt"` shows an "Update now" banner when a new version is ready.

## Book catalogue

`worker/providers/catalog.ts`: Google Books when `GOOGLE_BOOKS_API_KEY` is set, otherwise (or on any failure) Open Library; if both fail, a friendly error and manual entry. Adding a provider result re-fetches the edition server-side and upserts it by ISBN-13 → Google id → Open Library id → Goodreads id, only filling empty fields on existing rows.

## Goodreads import

`shared/goodreads.ts` parses the CSV (RFC 4180, BOM, embedded newlines, `="…"` ISBN wrapping) in the browser for an instant preview. Rows are uploaded 50 at a time to `/api/imports/goodreads/batch`, re-validated with the same Zod schema, and written only to the caller's records. Existing reviews are never overwritten; re-imports update shelf data instead of duplicating.
