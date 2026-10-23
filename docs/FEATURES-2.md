# Feature wave 2: contract

Companion to `docs/API.md`. Every path below is club-scoped under `/api/clubs/:clubId` unless marked **personal** (`/api/...`) or **public**. All club routes sit behind `requireClubMember`; admin-only routes use `requireClubRole("admin")`. Shared records use `expectedVersion` → `409`. Lists marked *(paged)* use `pageQuerySchema` → `Page<T>`. Schema: `migrations/0003_features.sql`. Types/schemas: `shared/types.ts`, `shared/schemas.ts` (section "Feature wave 2").

Ownership of code (to avoid conflicts): **W1** = meetings/calendar/polls/roles/sign-ups/pace/mappings (`worker/routes/meetings.ts`, `polls.ts`, `calendar.ts`, `pace.ts`, `worker/lib/recurrence.ts`, `ics.ts`, `pack.ts`); **W2** = chat/rooms/guides/scheduled/digest/welcome (`worker/routes/messages.ts`, `rooms.ts`, `guides.ts`, `scheduled.ts`, `worker/lib/digest.ts`, `prompts.ts`, `ai.ts`); **W3** = files/branding/screening/bulk invites/exports/push/SMS/streaks/challenges/recaps/feasibility/bridge/cross-club (`worker/routes/files.ts`, `membership.ts`, `exports.ts`, `push.ts`, `reading.ts`, `challenges.ts`, `recaps.ts`, `feasibility.ts`, `bridge.ts`, `worker/lib/storage.ts`, `webpush.ts`, `worker/sms/*`, `worker/lib/notify.ts`). `worker/index.ts` mounts are pre-wired (see bottom). `worker/routes/club.ts` keeps goal/list/assignments/activities; the old meeting routes inside it move to `meetings.ts` (W1 owns that move). The cron dispatcher `worker/cron.ts` calls `runMeetingReminders` (W1), `runScheduledMessages` + `runCatchUpDigests` (W2), `runHousekeeping` (existing) — each owner implements their function in their own file; the dispatcher is pre-written.

## 1. Meetings (W1)

`Meeting` gains: `timezone`, `locationUrl`, `rsvpDeadline`, `recurrence: Recurrence | null`, `seriesId`, `host/picker/notetaker: MemberSummary | null`, `notes`, `copiedFromId`, `rsvp: { going, maybe, no, mine: RsvpStatus | null, goingGuests }`, `attendance: { present: number, marked: boolean, mine: boolean | null }`, `signupLists: SignupList[]` (detail only), `occurrence: { index, total } | null`.

| Method | Path | Notes |
|---|---|---|
| GET | `/meetings?when=upcoming|past|all&from=&to=` | occurrences expanded; `from/to` ISO dates for calendar views |
| GET | `/meetings/:id` | full detail incl. sign-up lists, RSVP list (names + status, unless the viewer is not a member), attendance |
| POST | `/meetings` | `meetingSchema` + `recurrence?` → creates the first N occurrences (max 52, up to `until`/`count`) sharing `series_id`; roles auto-assigned from the rotation ledger when `autoAssignRoles` is true |
| PUT | `/meetings/:id?scope=this|future|all` | edits this occurrence, this-and-future, or the whole series |
| POST | `/meetings/:id/copy` | `{ startsAt, keep: { book, location, details, signups } }` → new meeting (201) |
| POST | `/meetings/:id/archive|restore?scope=` | |
| PUT | `/meetings/:id/rsvp` | `rsvpSchema { status, guests, note }`; closed after `rsvpDeadline` (409 `rsvp_closed`) |
| PUT | `/meetings/:id/attendance` | admin+ (or host) `{ userIds: string[] }` marks present (replaces); any member may `POST /meetings/:id/attendance/me` to self-check-in within ±6h of start |
| PUT | `/meetings/:id/roles` | `{ host?, picker?, notetaker? }` member ids; writes `role_ledger` |
| GET | `/roles/ledger` | fairness view: per member counts per role + suggested next (fewest, then longest ago) |
| PUT | `/meetings/:id/notes` | `{ notes, expectedVersion }` |
| GET | `/meetings/:id/pack` | `MeetingPack`: agenda built from the book's guide questions, club reviews/quotes for the book (club-visible), last meeting's notes, RSVP summary, sign-up gaps; cached in `club_meetings.agenda` for 10 min |
| POST | `/meetings/:id/signups` | `signupListSchema` → list; `POST /signups/:listId/items`, `PUT/DELETE /signups/items/:itemId`, `PUT /signups/items/:itemId/claim` (`{ note }` toggles the caller's claim) |
| GET | `/calendar.ics?token=` | **public** per-member calendar feed (token = `calendar_tokens` → add table? No: use a signed token `HMAC(BETTER_AUTH_SECRET, userId:clubId)` returned by `GET /calendar/feed-url`); `GET /meetings/:id.ics` (member) single event |
| GET | `/calendar?month=YYYY-MM` / `?year=YYYY` | `CalendarMonth` / `CalendarYear` (meetings + assignment due dates + poll closes) |

Reminders (cron, every 15 min): for each upcoming meeting and each offset in `clubs.reminder_offsets` (minutes) whose window `[start-offset, start-offset+15min)` contains now, send to members with RSVP ≠ no: in-app notification (`meeting_reminder`), push, email (pref `email_meeting_reminders`), SMS (pref + opt-in + adapter configured). Record in `meeting_reminders_sent`.

Recurrence JSON: `{ freq: "weekly"|"biweekly"|"monthly"|"custom", interval?: number, byDay?: number[] (0-6), byMonthDay?: number, nthWeekday?: { n: 1-5|-1, day: 0-6 }, until?: "YYYY-MM-DD", count?: number }`. `worker/lib/recurrence.ts: expand(startsAt, rule, limit)`.

## 2. Polls (W1)

| Method | Path | Notes |
|---|---|---|
| GET | `/polls?status=open|closed` *(paged)* | `Poll[]` with options, counts, `myVotes`, voter names unless anonymous |
| POST | `/polls` | `pollCreateSchema { kind, title, description, options: [{label, editionId?, startsAt?, endsAt?}], allowMultiple, anonymous, closesAt?, year? }` (book polls: options need editionId; date polls: startsAt required) |
| POST | `/polls/:id/options` | members may add options while open (`allowMemberOptions` default true) |
| PUT | `/polls/:id/vote` | `{ optionIds: string[] }` replaces the caller's votes |
| POST | `/polls/:id/close` | admin+ or creator; computes winner (ties → earliest option) |
| POST | `/polls/:id/apply` | admin+: book poll → adds winner to the club list for `year` (status planned) and notifies; date poll → creates (or updates `meeting_id`) a meeting at the winning slot |
| DELETE | `/polls/:id` | archive |

Cron closes polls past `closes_at`.

## 3. Chat upgrades (W2)

`Message` gains `parentId`, `replyCount`, `attachments: Attachment[]`, `mentions: MemberSummary[]`, `reactions: { emoji, count, mine }[]`, `kind`. `POST /conversations/:id/messages` body: `messageSchema { body, parentId?, attachmentFileIds?: string[] (max 4, must be files of kind attachment owned by sender in this club) }`; mentions parsed from `@username` tokens, validated against club members; mentioned members get a `mention` notification + push (pref `push_mentions`). `GET /messages/:id/thread` *(paged)* replies. `PUT /messages/:id/reactions { emoji }` toggles (emoji limited to a curated list of 16 in `shared/constants.ts` `MESSAGE_EMOJI`). Photo upload: `POST /api/clubs/:clubId/files` (W3) with `kind: attachment` then reference by id. Realtime events: `message.reaction`, `thread.reply` (parent id + count).

Scheduled messages: `GET /scheduled` (mine), `POST /scheduled { conversationId, body, sendAt }`, `DELETE /scheduled/:id`; cron `runScheduledMessages` posts them as the sender.

Welcome message: when a member joins (W3 calls `postWelcome(env, clubId, userId)` from W2's `worker/lib/welcome.ts`), post `clubs.welcome_message` into the club conversation as a `kind: 'welcome'` system message addressed to the newcomer (body prefixed with `@username`), and send them a DM from the owner with the same text when `welcome_message` is set.

## 4. Discussion rooms, progress, guides (W2)

| Method | Path | Notes |
|---|---|---|
| GET | `/books/:editionId/rooms` | `DiscussionRoom[]` with `unlocked: boolean` for the viewer and `membersInside` count |
| POST | `/books/:editionId/rooms` | `roomSchema { kind, title, gateType, gateValue }`; `POST /books/:editionId/rooms/auto { chapters: n }` creates chapter rooms 1..n gated by chapter; reflection room gated by `finished` |
| GET/PUT | `/books/:editionId/progress` | `progressSchema { chapter?, page?, percent?, finished }` (viewer's club reading position); `GET /books/:editionId/progress/all` member positions (spoiler-safe: just positions) |
| GET | `/rooms/:roomId` | room + conversation id; entering a gated room the viewer has not reached → `403 room_locked` with the gate |
| messages | rooms use the normal conversation endpoints (`conversation.room_id` set); posting/reading enforces the gate |
| GET/PUT | `/books/:editionId/guide` | `DiscussionGuide`; `PUT` with `guideSchema { sections }` |
| POST | `/books/:editionId/guide/generate { source: 'template'|'ai', chapters? }` | template: 12-18 questions from `worker/lib/prompts.ts` (genre-aware using club genres, title, authors, description); ai: when `ANTHROPIC_API_KEY` is set, `worker/lib/ai.ts` calls the Claude Messages API (model `claude-sonnet-5`, JSON output) with the book's title/authors/description; otherwise `409 ai_unavailable`. Result is saved as the guide (source noted) |

Milestones = rooms of kind `milestone`; questions in the guide may carry `roomId` to appear pinned at the top of that room (`GET /rooms/:id` returns `questions`).

Catch-up digest (cron, daily 13:00 UTC): for each member with `digest_catch_up` and ≥ 10 unread messages in a club/room conversation since `last_read_at`, build a progress-gated summary: list rooms/threads with counts, the 5 most-reacted messages they are allowed to see (never from rooms they have not unlocked), and send as an in-app notification + email (`digestEmail`). Record `digest_deliveries`.

## 5. Files, branding, screening, invites, exports (W3)

`worker/lib/storage.ts`: `putFile(env, {clubId, ownerId, kind, title, contentType, bytes, meetingId?})` → stores in `env.FILES` (R2) when bound else `file_blobs` (max 2 MB; R2 max 25 MB; images > 1600px are accepted as-is, the client resizes); `getFile`, `deleteFile`. Quotas: 200 files / 200 MB per club (D1 mode: 50 MB).

| Method | Path | Notes |
|---|---|---|
| POST | `/files` | multipart (`file`, `kind`, `title?`, `meetingId?`) → `FileRecord` (201) |
| GET | `/files?kind=&meetingId=` *(paged)* | |
| GET | `/files/:id/content` | streams bytes (members only); `Cache-Control: private` |
| DELETE | `/files/:id` | uploader or admin+ |
| PUT | `/branding` | admin+ multipart or JSON `{ accentColor?, bannerFileId? }`; `GET /api/clubs/:id` returns `branding: { bannerUrl, accentColor }` |
| PUT | `/settings` | admin+ `clubSettingsSchema { welcomeMessage, joinPolicy, screeningQuestions, timezone, reminderOffsets, rolesRotation, discordWebhookUrl (write-only) }` |
| GET | `/join-requests?status=` | admin+ |
| POST | `/join-requests/:id/approve|decline` | admin+; approve adds membership + welcome |
| POST | `/invites/bulk` | admin+ `{ csv }` (text; columns email[,name]) → creates one email invite per row (single-use code, 14 days), sends `inviteEmail`; returns `{ sent, skipped: [{row, reason}] }`; max 200 rows |
| GET | `/members/export.csv` | admin+ CSV: name, username, email (admins only see emails), role, joined, meetings attended (12 mo), books finished (year) |

`POST /api/clubs/join` (existing) changes: if `join_policy = 'approval'` → creates a `join_request` (with `answers` per `screening_questions`) and returns `202 { pending: true }`; invite preview returns `joinPolicy` and `screeningQuestions`.

## 6. Push, SMS, reading log, challenges, recaps (W3)

- Push: `GET /api/push/public-key`, `POST /api/push/subscribe { endpoint, keys }`, `DELETE /api/push/subscribe { endpoint }`. `worker/lib/webpush.ts` implements VAPID + `aes128gcm` with WebCrypto (no npm dependency); `sendPush(env, userId, payload)`; drop subscriptions after 3 consecutive 404/410. Payload `{ title, body, url, tag }`. The service worker (`src/sw-push.ts`, F3) shows it. Wire into `notifyUsers` for kinds the member allows.
- SMS: `worker/sms/index.ts` adapter (`console` locally; `twilio` when `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM` secrets exist). Used only for meeting reminders to opted-in members with a phone. `PUT /api/account/phone { phone, smsOptIn }` (E.164).
- Reading log **personal**: `PUT /api/reading-log/:day { pages, minutes, editionId?, note }`, `GET /api/reading-log?from&to`, `GET /api/reading-log/streak` → `{ current, longest, today: boolean }` (streak = consecutive days with pages or minutes > 0, in the member's zone). Marking progress in the library/club also logs today.
- Challenges: **personal** `/api/challenges` and club `/challenges` (CRUD, join, progress computed: books finished / pages read / genre count / streak days within window; `custom` uses manual progress). `GET` returns `ChallengeSummary[]` with leaderboard (club) or own progress.
- Recaps: `GET /api/recaps/monthly?month=YYYY-MM` (personal: books finished, pages, streak, top genre, club meetings attended) and `GET /api/clubs/:id/recaps/monthly`, `GET /api/clubs/:id/wrapped?year=` (`ClubWrapped`: books read, pages, meetings, attendance rate, most-reacted message, most-loved book, top reviewer, longest streak holder, busiest month, poll stats). Cached in `recap_cache` for 6 h. The shareable graphic is drawn client-side (F3) from this JSON.

## 7. Pace planner, mappings, feasibility, bridge, cross-club (W1 pace/mappings, W3 the rest)

- `POST /pace-plans { editionId, meetingId?, startsOn, endsOn?, totalPages?, cadence, restDays, createAssignments: true }` → splits pages evenly by cadence into `schedule` and creates assignments with `from_page/to_page`; `GET /pace-plans/:editionId` returns the plan plus the viewer's personal daily pages (`(toPage - myPage) / daysLeft`, from club progress). `PUT`/`DELETE`.
- `PUT /api/books/editions/:id/mappings { kind, total, label }` (any member); `Assignment` gains `ranges: { pages, kindle, audio }` computed proportionally from `from_page/to_page` and the edition's `page_count` + mappings (`worker/lib/mapping.ts`).
- Feasibility `GET /api/books/editions/:id/feasibility` → `{ library: { openLibraryLendable, archiveOrgUrl, worldcatUrl }, ebook: { googleBooksPrice?, googleBooksUrl, kindleSearchUrl, kindleUnlimited: 'unknown' }, audio: { libroFmUrl, audibleSearchUrl }, pageCount, estimatedHours }` from Open Library (`availability` API) and Google Books `saleInfo` (free, keyless) with 24 h cache; everything else is a link, labelled best-effort.
- Bridge: `GET /meetings/:id/share` → `{ text, url, whatsapp, sms, email, copy }` deep links (`https://wa.me/?text=`, `sms:?&body=`, `mailto:`); `POST /bridge/discord { kind: 'meeting'|'poll'|'assignment', id }` admin+ posts to the club's Discord webhook if set (server-side fetch, never exposes the URL).
- Cross-club: `GET /api/clubs/:id/intelligence?editionId=` → `{ duplicatePicks: [{ clubName, year, status }], suggestions: [{ edition, reason }] }` — the viewer's other clubs' lists/finished books (only titles, never other clubs' members); also surfaced when adding a book to a list (`POST /books` returns `warnings`).

## 8. Notifications (new kinds)

`meeting_reminder`, `rsvp_update` (host), `poll_opened`, `poll_closed`, `join_request` (admins), `join_approved`, `mention`, `thread_reply`, `reaction`, `digest`, `challenge_update`, `welcome`. Every kind routes through `notifyUsers` which fans out to in-app + push (+ email per prefs).

## 9. Frontend routes (wave 2)

```
/c/:clubId/meetings              list + month/year calendar toggle; RSVP; filters
/c/:clubId/meetings/:id          detail: RSVP, attendance (admin), roles, notes, sign-ups, pack, share, copy, .ics
/c/:clubId/polls[/:pollId]       polls (book / date / custom); create; vote; close; apply
/c/:clubId/calendar              month + year views, subscribe (.ics feed URL)
/c/:clubId/rooms/:bookId         discussion rooms for a book (gated), progress control, guide
/c/:clubId/files                 documents & photos (upload, browse, minutes per meeting)
/c/:clubId/challenges            club challenges + leaderboard
/c/:clubId/wrapped               Club Wrapped (year) + monthly recap card (download PNG)
/c/:clubId/settings              + Branding, Screening, Bulk invite, Join requests, Export, Bridge, Reminders/Roles
/c/:clubId/messages[/:id]        threads panel, reactions, photo upload, @mentions autocomplete, schedule send
/books/:id                       + rooms link, mappings, feasibility panel, cross-club notice, pace plan (per club)
/reading                         personal: reading log, streak, monthly recap graphic, challenges
/settings                        + Phone/SMS, push toggle, quote capture (OCR) lives on the quote form
```

## 10. Pre-wired mounts (`worker/index.ts`)

```
club.route("/", meetingRoutes)      // W1: /meetings*, /roles/ledger, /calendar*, /pace-plans*
club.route("/polls", pollRoutes)    // W1
club.route("/", roomRoutes)         // W2: /books/:editionId/rooms*, /books/:editionId/progress*, /rooms/:id, /books/:editionId/guide*
club.route("/scheduled", scheduledRoutes) // W2
club.route("/files", fileRoutes)    // W3
club.route("/", membershipRoutes)   // W3: /branding, /settings, /join-requests*, /invites/bulk, /members/export.csv, /bridge/*, /intelligence
club.route("/challenges", clubChallengeRoutes) // W3
club.route("/recaps", recapRoutes)  // W3: /monthly, /wrapped
api.route("/push", pushRoutes)      // W3
api.route("/reading-log", readingLogRoutes) // W3
api.route("/challenges", challengeRoutes)   // W3 personal
api.route("/recaps", personalRecapRoutes)   // W3
app.get("/api/public/calendar/:token.ics", calendarFeed) // W1
```
