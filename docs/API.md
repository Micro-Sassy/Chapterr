# Chapterr API contract (multi-club)

All endpoints live under `/api`, return JSON, and require a signed-in, verified member unless marked **public**. Errors use the `ApiErrorBody` envelope (`shared/types.ts`). Shared club records use optimistic concurrency (`expectedVersion` → `409` with `error.current`).

Terminology: a **member** is a signed-in account. A **club** is an independent space; an account can belong to up to `LIMITS.clubsPerUserMax` clubs and own up to `LIMITS.clubsOwnedMax`. Everything inside `/api/clubs/:clubId/...` is scoped to that club and requires membership (`403 not_a_member` otherwise; `404` if the club does not exist or is archived). The middleware `requireClubMember` (`worker/lib/club.ts`) loads the club and the caller's membership into `c.get("club")` / `c.get("membership")`. Role checks: `requireClubRole("admin")` allows owner+admin.

Pagination: list endpoints marked *(paged)* accept `?cursor=&limit=` (`pageQuerySchema`, default `LIMITS.pageSize`) and return `Page<T>`.

## Public (no session)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/config` | `PublicConfig` (adds `marketingUrl`, `billingEnabled: false`, `clubPriceCents: 100`) |
| GET | `/api/public/shares/:token` | `PublicShare`; `club_list` includes `clubName` |
| GET | `/api/invites/:code` | `InvitePreview` — works signed out (then `alreadyMember: false`). Rate limited per IP. Never lists members. |
| * | `/api/auth/*` | Better Auth (unchanged; Turnstile via auth-guard) |

## Account (global, unchanged paths)

`/api/account/me` returns `Me` with `clubs: ClubSummary[]` (most recently joined first) and `lastClubId`. `PUT /api/account/last-club { clubId }` records the club to open next time (404 if not a member).

Everything else under `/api/account/*`, `/api/library/*`, `/api/reviews/*`, `/api/quotes/*`, `/api/goals/*`, `/api/books/*`, `/api/imports/*`, `/api/shares/*`, `/api/notifications/*` keeps its current shape, with these rules:

- **Visibility across clubs.** A member sees another member's `club`-visibility items (library entries, reviews, quotes, profile stats) only if the two share at least one club (`sharesClubWith(db, a, b)` in `worker/lib/club.ts`). Private items are owner-only, as before.
- `GET /api/reviews?editionId=` and `GET /api/quotes?editionId=` (book page) filter to the viewer's own items plus club-visible items from members who share a club with the viewer.
- Review reactions: a member may react only to reviews they can see.
- `/api/members/:username` (profile) returns `404` unless the viewer shares a club with that member; it includes `sharedClubs`. There is **no** global `/api/members` list anymore — member lists are per club.
- Share links: `club_list` requires `clubId`; the creator must be a member of that club at creation time and the public page resolves only while they still are. Chats are never shareable.
- Notifications carry `clubId`/`clubName` (null for account-level). `GET /api/notifications` is *(paged)*.
- `/api/books/*` (catalogue search, editions, provider add, manual add, edition edit) is global and unchanged. `PUT /api/books/works/:bookId/genres` moves to the club scope (below).

## Clubs

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/clubs` | `ClubSummary[]` the member belongs to |
| POST | `/api/clubs` | `clubCreateSchema` → `Club` (201). Requires Turnstile header `x-turnstile-token`. Creator becomes `owner`; the club's main conversation (`kind: 'club'`) is created in the same batch; `plan` is `beta_free`. Limits: `clubsOwnedMax`, `clubsPerUserMax`. Rate limit 5/hour. Slug: slugified name + 4 random chars, unique. |
| POST | `/api/clubs/join` | `joinClubSchema { code }` → `Club` (201, or 200 if already a member). Validates code (not revoked/expired/over max_uses), member_limit, clubsPerUserMax; increments `use_count`; adds the member to the club conversation; notifies admins (`club_member_joined`). Turnstile required. Rate limit 10/hour per user. |
| GET | `/api/clubs/:clubId` | `Club` |
| PUT | `/api/clubs/:clubId` | `clubUpdateSchema` (admin+) → `Club` |
| GET | `/api/clubs/:clubId/dashboard?today=YYYY-MM-DD` | `ClubDashboard` |
| GET | `/api/clubs/:clubId/members` | `ClubMember[]` (sorted owner, admins, then by name) |
| PUT | `/api/clubs/:clubId/members/:userId/role` | `memberRoleSchema` (admin+; cannot change the owner; admins cannot demote other admins — owner only) → `ClubMember`; notifies target (`club_role_changed`) |
| DELETE | `/api/clubs/:clubId/members/:userId` | Remove a member (admin+; cannot remove the owner; admins cannot remove admins). Removes conversation participation, closes their realtime sockets for this club, notifies them (`club_removed`). |
| POST | `/api/clubs/:clubId/leave` | Leave (any non-owner). Owner must transfer first (`409 owner_must_transfer`). |
| POST | `/api/clubs/:clubId/transfer-ownership` | `transferOwnershipSchema` (owner; verifies password) → previous owner becomes admin |
| POST | `/api/clubs/:clubId/delete` | `deleteClubSchema` (owner; verifies password and that `confirmName` equals the club name). Sets `archived_at`; club disappears for everyone; data purged by the daily cron after 30 days. |
| GET | `/api/clubs/:clubId/invites` | `ClubInvite[]` (admin+), active first |
| POST | `/api/clubs/:clubId/invites` | `inviteCreateSchema` (admin+) → `ClubInvite` (201). Code: 10 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` via `crypto.getRandomValues`. Max 20 live invites per club. |
| DELETE | `/api/clubs/:clubId/invites/:inviteId` | Revoke (admin+) |
| GET | `/api/clubs/:clubId/billing` | `{ plan, billingStatus, priceCents, billingEnabled: false, message }` — stub during beta |

### Club-scoped content (moved from the old single-club routes)

Prefix every path below with `/api/clubs/:clubId`. Behaviour is the existing behaviour, filtered by `club_id`.

| Method | Path | Notes |
|---|---|---|
| GET/POST/PUT/DELETE | `/goal`, `/books`, `/books/:id`, `/books/reorder`, `/books/:id/archive|restore`, `/books/years` | Club reading list + annual goal |
| GET/POST/PUT/… | `/meetings`, `/meetings/:id`, `/meetings/:id/archive|restore` | |
| GET/POST/PUT/… | `/assignments…` | `?when=current|past|all&today=` |
| GET/POST/PUT/… | `/activities…` | |
| GET/POST/PUT/DELETE | `/genres`, `/genres/:id`, `/genres/:id/archive|restore`; `PUT /works/:bookId/genres` | Genres are per club |
| GET | `/reviews` *(paged)* | Club-visible reviews by members of this club (plus the viewer's own) |
| GET | `/quotes` *(paged)* | Same rule |
| GET/POST/PUT/DELETE | `/recommendations…` | Recommendations are made inside a club; recipient must be a member of it |
| GET | `/activity` *(paged)* | Club activity feed (`ActivityItem[]`): finished/started/review/quote events from members of this club, club books, meetings, assignments |
| GET/POST | `/conversations`, `/conversations/direct { userId }` | DMs are per club (direct_key `club:a:b`); recipient must be a member |
| GET/POST | `/conversations/:id/messages` *(paged, newest-first cursor)*, `PUT/DELETE /messages/:id`, `POST /conversations/:id/read` | |
| GET | `/realtime` | WebSocket upgrade. Worker verifies session + membership, then connects to the Durable Object named `club:<clubId>`. |

Per-club limits (abuse controls): messages 60/min per user, reviews/quotes 30/hour, recommendations 30/hour, invites 20/hour per club, join attempts 10/hour per user and 30/hour per IP.

## Home

`GET /api/home?today=YYYY-MM-DD` → `HomeData` (one query batch; clubs with `nextMeeting`, `currentAssignment`, `currentBook`, `unreadMessages`). Replaces the old `/api/dashboard`.

## Realtime

One Durable Object per club (`idFromName("club:" + clubId)`), hibernating WebSockets tagged `user:<id>` and `session:<id>`. `publish(env, clubId, userIds | "all", event)`. On password reset / sign-out-everywhere the Worker calls `disconnectUser` for each club the user belongs to. Notifications are published to the club DO they belong to (account-level notifications are picked up by polling). Removing a member closes their sockets on that club's DO and sends `membership.ended` first.

## Cron (daily)

Purge: expired share links, verification rows, rate-limit windows, imports older than 30 days, archived clubs older than 30 days (cascades), notifications older than 90 days.

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
