# Architecture

## One deployable Worker

```
Browser (React SPA, service worker)
   │  HTTPS (same origin)              wss:// /api/clubs/:clubId/realtime
   ▼                                              │
Cloudflare Worker ─ static assets (dist/client) ──┤
   │  /api/* → Hono app                            ▼
   │    ├─ /api/auth/*  → auth guard → Better Auth ─┐
   │    ├─ /api/public/*, /api/invites/:code (no session)
   │    ├─ /api/* → requireUser (account, library, reviews, quotes, goals, books, shares, notifications, home, clubs)
   │    └─ /api/clubs/:clubId/* → requireUser → requireClubMember → club routes
   │                                                ▼
   ├──────────────► D1 (SQLite) ◄──────── authoritative data
   └──────────────► ClubRealtime Durable Objects, one per club (`club:<clubId>`; WebSocket fan-out only)
```

## Clubs

Chapterr hosts many independent clubs. An account can belong to up to `LIMITS.clubsPerUserMax` clubs and own up to `LIMITS.clubsOwnedMax`. A club is a `clubs` row plus `club_members` (role `owner` | `admin` | `member`), `club_invites` (10-character codes; the only way in — there is no directory) and exactly one `club`-kind conversation. Creating a club writes the club, the owner's membership and that conversation in one D1 batch; joining adds the membership and conversation participation; leaving or removal deletes both (and closes the member's sockets on that club's Durable Object). Deleting a club sets `archived_at`: it disappears for everyone immediately and the daily cron purges it (cascading) after 30 days.

Everything under `/api/clubs/:clubId/*` is loaded through `requireClubMember` (`worker/lib/club.ts`), which puts the club and the caller's membership on the Hono context; every query in those routes filters by `club_id`, and versioned updates add `AND club_id = ?`. Personal content (library, reviews, quotes) stays global to the account; a `club`-visibility item is shown to another member only when the two share at least one live club (`visibleToViewerSql` / `sharesClubWith`), and the per-club feeds narrow that to members of the club (`visibleInClubSql`).

- `wrangler.jsonc` sets `assets.run_worker_first: ["/api/*"]`, so API paths always run the Worker and every other path is served from static assets with SPA fallback.
- The Cloudflare Vite plugin builds both the client (`dist/client`) and the Worker in one `vite build`, and runs the Worker in the real `workerd` runtime during `vite dev`.

## Request pipeline (worker/index.ts)

1. `requireHttps` then `securityHeaders` — nosniff, frame denial, referrer policy, `X-Robots-Tag`, HSTS over https, `Cache-Control: no-store` on API responses (skipped for 101 WebSocket responses).
2. `bodyLimit` — 2 MB per API request.
3. `sameOriginGuard` — state-changing requests must carry our `Origin` (CSRF defence in addition to SameSite=Lax cookies).
4. Auth routes go through `routes/auth-guard.ts`: endpoint allowlist, Turnstile verification, per-identifier rate limits, and request bodies rebuilt from validated fields before Better Auth sees them.
5. `requireUser` — resolves the Better Auth session from the cookie and requires a verified email. Mounted in front of every private route. `requireClubMember` follows it for `/api/clubs/:clubId/*`; `requireClubRole("admin" | "owner")` guards management endpoints.
6. Route handlers validate input with the Zod schemas in `shared/schemas.ts` and query D1 with parameterised statements. Paged lists share `worker/lib/paging.ts` (timestamp cursors, `Page<T>`).
7. `onError` converts `ApiError`s to `{ error: { code, message, fields?, current? } }`; unexpected errors are logged and returned as a generic 500.

## Data model (migrations/)

- Better Auth tables: `user` (with `username`/`displayUsername`), `session`, `account`, `verification`.
- Clubs: `clubs` (slug, plan, `member_limit`, `archived_at`), `club_members` (role, `joined_at`, `muted`), `club_invites` (code, expiry, `max_uses`/`use_count`, `revoked_at`).
- Catalogue (global): `books` (works, grouped by Open Library work id or normalised title|author) → `book_editions` (unique ISBN-13, provider ids, per-edition metadata). `genres` + `book_genres` are per club (work-level tags shared by all editions, `club_id` on both).
- Personal (global to the account): `profiles` (incl. `last_club_id`), `avatars`, `notification_preferences`, `user_books`, `reviews`, `review_reactions`, `quotes`, `personal_reading_goals`, `imports`. `recommendations` carry `club_id`: they are made inside a club.
- Shared club content: `club_annual_goals`, `club_annual_books`, `club_meetings`, `club_assignments`, `club_activities` — each with `club_id`, `version`, `created_by`, `updated_by`, `created_at`, `updated_at` and (where archivable) `archived_at`.
- Messaging: `conversations` (`club_id`; one `club` row per club + `direct` rows keyed `<clubId>:<a>:<b>`), `conversation_participants` (also tracks `last_read_at`), `messages` (soft delete nulls the body; a CHECK constraint enforces it).
- `share_links` (hashed tokens; `resource_type` CHECK excludes chats; `club_id` for `club_list`), `notifications` (`club_id`, null for account-level), `rate_limits`, `dev_outbox` (local development only).

Timestamps are ISO-8601 UTC strings; calendar dates (`finished_at`, `due_date`) are `YYYY-MM-DD`.

## Optimistic concurrency

Shared records are updated with `UPDATE … SET …, version = version + 1 WHERE id = ? AND version = ?` (`worker/lib/versioned.ts`). Zero changed rows means someone else saved first: the API returns **409** with the current record in `error.current`, and the UI refreshes and explains. List reordering sends the full ordered id list and is rejected if the set of entries changed meanwhile.

## Realtime

- The browser opens one WebSocket to `/api/clubs/:clubId/realtime` for the club it is viewing. The Worker authenticates it like any API call, checks membership and the `Origin`, and forwards the upgrade to that club's `ClubRealtime` Durable Object (`idFromName("club:" + clubId)`) with trusted identity headers (user id, session id, club id, session expiry). The first event is `hello` with the club id.
- The Durable Object accepts the socket with the Hibernation API and tags it `user:<id>` and `session:<id>`. It never decides permissions.
- After a write is committed to D1, the Worker calls `publish(env, clubId, userIds | "all", event)` over RPC. Direct messages go only to the two participants; club messages to every connected member of that club; club notifications to their recipient on that club's object. Sockets past their session expiry are closed on use.
- Sign-out, session revocation, password change/reset and account deletion close the relevant sockets on every club the member belongs to (`clubIdsFor`). Removing a member or deleting a club sends `membership.ended` and then closes the sockets on that club's object.
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
