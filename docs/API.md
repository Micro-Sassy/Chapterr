# Chapterr API contract (multi-club)

All endpoints live under `/api`, return JSON, and require a signed-in, verified member unless marked **public**. Errors use the `ApiErrorBody` envelope (`shared/types.ts`). Shared club records use optimistic concurrency (`expectedVersion` → `409` with `error.current`).

Terminology: a **member** is a signed-in account. A **club** is an independent space; an account can belong to up to `LIMITS.clubsPerUserMax` clubs and own up to `LIMITS.clubsOwnedMax`. Everything inside `/api/clubs/:clubId/...` is scoped to that club and requires membership (`403 not_a_member` otherwise; `404` if the club does not exist or is archived). The middleware `requireClubMember` (`worker/lib/club.ts`) loads the club and the caller's membership into `c.get("club")` / `c.get("membership")`. Role checks: `requireClubRole("admin")` allows owner+admin.

Pagination: list endpoints marked *(paged)* accept `?cursor=&limit=` (`pageQuerySchema`, default `LIMITS.pageSize`) and return `Page<T>`. Cursors are the `createdAt` timestamp of the last item of the previous page (opaque to clients: pass `nextCursor` back unchanged; a malformed cursor is `400`).

Error codes used by the club endpoints (all in the `ApiErrorBody` envelope): `not_a_member` (403), `forbidden` (403, role too low), `captcha_failed` (403), `limit_reached` (409: clubs owned/joined cap, 20 live invites), `club_full` (409), `owner_must_transfer` (409), `owns_clubs` (409, account deletion while owning a club with other members), `invite_invalid` (404: unknown or revoked code), `invite_expired` (410: past `expiresAt` or `maxUses` reached), `invalid_password` (400), `conflict` (409 with `error.current`), `validation_error` (422 with `error.fields`).

## Public (no session)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/config` | `PublicConfig` (adds `marketingUrl`, `billingEnabled: false`, `clubPriceCents: 100`) |
| GET | `/api/public/shares/:token` | `PublicShare`; `club_list` includes `clubName` |
| GET | `/api/invites/:code` | `InvitePreview` — works signed out (then `alreadyMember: false`). Rate limited per IP (30/min). Never lists members. Unknown and revoked codes are `404`; an expired or used-up code still previews with `expired: true`. |
| * | `/api/auth/*` | Better Auth (unchanged; Turnstile via auth-guard) |

## Account (global, unchanged paths)

`/api/account/me` returns `Me` with `clubs: ClubSummary[]` (most recently joined first) and `lastClubId`. `PUT /api/account/last-club { clubId }` records the club to open next time (404 if not a member) → `{ ok: true, lastClubId }`. Creating or joining a club also sets `lastClubId`; leaving, being removed or the club being deleted clears it.

`POST /api/account/delete` refuses with `409 owns_clubs` while the member owns a live club that has other members (transfer or delete it first); clubs they own alone are archived with the account.

Everything else under `/api/account/*`, `/api/library/*`, `/api/reviews/*`, `/api/quotes/*`, `/api/goals/*`, `/api/books/*`, `/api/imports/*`, `/api/shares/*`, `/api/notifications/*` keeps its current shape, with these rules:

- **Visibility across clubs.** A member sees another member's `club`-visibility items (library entries, reviews, quotes, profile stats) only if the two share at least one club (`sharesClubWith(db, a, b)` in `worker/lib/club.ts`). Private items are owner-only, as before.
- `GET /api/reviews?editionId=` and `GET /api/quotes?editionId=` (book page) filter to the viewer's own items plus club-visible items from members who share a club with the viewer.
- Review reactions: a member may react only to reviews they can see.
- `/api/members/:username` (profile) returns `404` unless the viewer shares a club with that member; it includes `sharedClubs`. There is **no** global `/api/members` list anymore — member lists are per club.
- Share links: `club_list` requires `clubId`; the creator must be a member of that club at creation time and the public page resolves only while they still are. Chats are never shareable.
- Notifications carry `clubId`/`clubName` (null for account-level). `GET /api/notifications` is *(paged)*.
- `/api/books/*` (catalogue search, editions, provider add, manual add, edition edit) is global and unchanged. `PUT /api/books/works/:bookId/genres` moves to the club scope (below). `EditionDetail.genres` lists the tags from every club the viewer belongs to; each `Genre` carries `clubId` and `clubName` so the UI can group them. `clubStats` on the edition page counts shelves of members who share a club with the viewer.
- `POST /api/reviews` and `POST /api/quotes` are rate limited to 30/hour per member.

## Clubs

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/clubs` | `ClubSummary[]` the member belongs to |
| POST | `/api/clubs` | `clubCreateSchema` → `Club` (201). Requires Turnstile header `x-turnstile-token`. Creator becomes `owner`; the club's main conversation (`kind: 'club'`) is created in the same batch; `plan` is `beta_free`. Limits: `clubsOwnedMax`, `clubsPerUserMax`. Rate limit 5/hour. Slug: slugified name + 4 random chars, unique. |
| POST | `/api/clubs/join` | `joinClubSchema { code }` → `Club` (201, or 200 if already a member). Validates code (`404 invite_invalid` when unknown/revoked, `410 invite_expired` when expired or over `maxUses`), member_limit (`409 club_full`), clubsPerUserMax (`409 limit_reached`); increments `use_count`; adds the member to the club conversation; notifies admins (`club_member_joined`); publishes `club.updated`. Turnstile required. Rate limit 10/hour per user and 30/hour per IP. |
| GET | `/api/clubs/:clubId` | `Club` |
| PUT | `/api/clubs/:clubId` | `clubUpdateSchema` (admin+) → `Club`; publishes `club.updated` |
| GET | `/api/clubs/:clubId/dashboard?today=YYYY-MM-DD` | `ClubDashboard` (`currentBooks` = list entries with status `current`, newest year first; `activity` = latest 20 items) |
| GET | `/api/clubs/:clubId/members` | `ClubMember[]` (sorted owner, admins, then by name) |
| PUT | `/api/clubs/:clubId/members/:userId/role` | `memberRoleSchema` (admin+; cannot change the owner; admins cannot change other admins' roles — owner only) → `ClubMember`; notifies target (`club_role_changed`); publishes `club.updated` |
| DELETE | `/api/clubs/:clubId/members/:userId` | Remove a member (admin+; cannot remove the owner; admins cannot remove admins; removing yourself is `400` — use leave) → `{ ok: true }`. Removes every conversation participation in this club (main chat and DMs), sends `membership.ended` then closes their realtime sockets for this club, notifies them (`club_removed`), publishes `club.updated`. |
| POST | `/api/clubs/:clubId/leave` | Leave (any non-owner) → `{ ok: true }`. Owner must transfer first (`409 owner_must_transfer`). |
| POST | `/api/clubs/:clubId/transfer-ownership` | `transferOwnershipSchema` (owner; verifies password) → `Club` as seen by the previous owner, who becomes admin; the new owner is notified (`club_role_changed`) |
| POST | `/api/clubs/:clubId/delete` | `deleteClubSchema` (owner; verifies password and that `confirmName` equals the club name, `400` otherwise) → `{ ok: true }`. Sets `archived_at`, revokes the club's invites and `club_list` share links, sends `membership.ended` to every connected member and closes their sockets; the club disappears for everyone; data purged by the daily cron after 30 days. |
| GET | `/api/clubs/:clubId/invites` | `ClubInvite[]` (admin+), active first, then newest first (max 100) |
| POST | `/api/clubs/:clubId/invites` | `inviteCreateSchema` (admin+) → `ClubInvite` (201). Code: 10 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` via `crypto.getRandomValues`; `url` is `${PUBLIC_APP_URL}/join/<code>`. Max 20 live invites per club (`409 limit_reached`); rate limit 20/hour per club. |
| DELETE | `/api/clubs/:clubId/invites/:inviteId` | Revoke (admin+) → `{ ok: true }` |
| GET | `/api/clubs/:clubId/billing` | `ClubBilling` `{ plan, billingStatus, priceCents, billingEnabled: false, message }` — stub during beta |

### Club-scoped content (moved from the old single-club routes)

Prefix every path below with `/api/clubs/:clubId`. Behaviour is the existing behaviour, filtered by `club_id`.

| Method | Path | Notes |
|---|---|---|
| GET/POST/PUT/DELETE | `/goal`, `/books`, `/books/:id`, `/books/reorder`, `/books/:id/archive|restore`, `/books/years` | Club reading list + annual goal |
| GET/POST/PUT/… | `/meetings`, `/meetings/:id`, `/meetings/:id/archive|restore` | |
| GET/POST/PUT/… | `/assignments…` | `?when=current|past|all&today=` |
| GET/POST/PUT/… | `/activities…` | |
| GET/POST/PUT/… | `/genres`, `/genres/:id`, `/genres/:id/archive|restore`, `/genres/:id/books`; `PUT /works/:bookId/genres` | Genres are per club (`Genre.clubId` set); `PUT /works/:bookId/genres` returns this club's `Genre[]` for the work and rejects ids from other clubs (`400`) |
| GET | `/reviews` *(paged)* | `Page<Review>`, newest first: club-visible reviews by members of this club (plus the viewer's own) |
| GET | `/quotes` *(paged)* | `Page<Quote>`, same rule |
| GET/POST/PUT/DELETE | `/recommendations…` | `Recommendation[]` / `Recommendation`; `?scope=all|club|received|sent`. Recommendations are made inside a club (`Recommendation.clubId`); recipient must be a member of it (`404` otherwise). Rate limit 30/hour per member per club. |
| GET | `/activity` *(paged)* | `Page<ActivityItem>`: finished/started/review/quote events from members of this club, club-wide recommendations, club books, meetings, assignments. Links point at `/c/:clubId/...` or `/books/:id`. |
| GET/POST | `/conversations`, `/conversations/direct { userId }`, `/conversations/:id` | `Conversation[]` (the `club` conversation first, `Conversation.clubId` set). DMs are per club (direct_key `<clubId>:<a>:<b>`); recipient must be a member (`404` otherwise). `/direct` → `{ id, created }` (201 when new). |
| GET | `/conversations/:id/messages` *(paged)* | `Page<Message>`: the newest `limit` messages, **returned in chronological order within the page**; `nextCursor` is the oldest `createdAt` on the page — pass it back as `?cursor=` to load older messages (null when the start is reached). |
| POST | `/conversations/:id/messages` `{ body }` → `Message` (201); `PUT|PATCH /messages/:id { body }`, `DELETE /messages/:id` (sender only) → `Message`; `POST /conversations/:id/read` → `{ ok }` | Rate limit 60/min per member per club |
| GET | `/realtime` | WebSocket upgrade. Worker verifies session + membership + `Origin`, then connects to the Durable Object named `club:<clubId>`. First event: `{ type: "hello", userId, clubId }`. |

Per-club limits (abuse controls): messages 60/min per user, reviews/quotes 30/hour, recommendations 30/hour, invites 20/hour per club, join attempts 10/hour per user and 30/hour per IP, club creation 5/hour per user, invite previews 30/min per IP. Limits are 10x looser outside production.

Removed endpoints: `/api/dashboard`, `/api/activity`, `/api/club/*`, `/api/genres/*`, `/api/recommendations/*`, `/api/conversations/*`, `/api/messages/*`, `/api/realtime`, `/api/members` (list) and `PUT /api/books/works/:bookId/genres` all return `404`; their club-scoped replacements are listed above.

## Home

`GET /api/home?today=YYYY-MM-DD` → `HomeData` (one query batch; clubs with `nextMeeting` = soonest meeting from six hours ago onward, `currentAssignment` = soonest assignment due today or later, `currentBook` = the list entry with status `current` (newest year, first position), `unreadMessages` across that club's conversations). `clubs` is empty for a member with no clubs (the UI shows the create/join empty state). Replaces the old `/api/dashboard`.

## Realtime

One Durable Object per club (`idFromName("club:" + clubId)`), hibernating WebSockets tagged `user:<id>` and `session:<id>`. `publish(env, clubId, userIds | "all", event)`. On password reset / sign-out-everywhere the Worker calls `disconnectUser` for each club the user belongs to. Notifications are published to the club DO they belong to (account-level notifications such as review reactions are picked up by polling). Removing a member closes their sockets on that club's DO and sends `membership.ended` first; deleting a club sends `membership.ended` to everyone connected. `club.updated` is sent to the whole club when its details, members or roles change: refetch `/api/clubs/:clubId` and `/api/clubs/:clubId/members` on it. Clients send the string `ping` to keep the socket alive and receive `{ type: "pong" }`.

## Cron (daily)

Purge: expired share links (and links revoked more than 30 days ago), expired verification rows and sessions, rate-limit windows, dev outbox older than 7 days, imports older than 30 days, archived clubs older than 30 days (cascades to every club table), notifications older than 90 days. Implemented in `runHousekeeping` (`worker/index.ts`).

## Frontend routes (app.chapterr.io)

```
/                       Home: your clubs (cards) + personal reading; empty state → create/join
/clubs/new              Create a club
/join/:code             Invite landing (public preview; sign-in/register return here)
/c/:clubId              Club dashboard
/c/:clubId/list         Reading list + annual goal
/c/:clubId/meetings     Meetings
/c/:clubId/activities   Activities
/c/:clubId/reviews      Club reviews feed
/c/:clubId/quotes       Club quotes feed
/c/:clubId/recommend    Recommendations
/c/:clubId/messages[/:conversationId]
/c/:clubId/members[/:username]
/c/:clubId/settings     Club settings: details, invites, members/roles, billing (free beta), leave/delete
/library, /books/add, /books/:id, /goals, /notifications, /settings   personal (unchanged)
/s/:token, /privacy, /terms, sign-in/register/reset flows   public
```

The sidebar shows a club switcher (current club name, dropdown of the member's clubs, "Create or join"). Club sections appear under the switcher; personal sections (Library, Find books, Goals) below. The realtime socket follows the club in the URL. `lastClubId` is saved via `PUT /api/account/last-club` whenever a club page opens.
