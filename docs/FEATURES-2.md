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

### W1 implementation notes (meetings)

- **Shapes.** `shared/types.ts` was not touched; the superset types live in `shared/types-meetings.ts`: `MeetingFull = Meeting & MeetingExtras` (every list row and every write response) and `MeetingDetail = Meeting & MeetingDetailExtras` (`GET /meetings/:id`, `PUT /roles`, `PUT /attendance`, `POST /copy`). Roles are nested: `meeting.roles.host|picker|notetaker`. RSVP summary also carries `myGuests` and `deadlinePassed`; `attendance.mine` is `null` until anyone is marked.
- **Schemas.** `POST /meetings` uses `meetingCreateSchema` (wave 1 fields + `locationUrl`, `timezone` (IANA), `rsvpDeadline`, `recurrence`, `autoAssignRoles`, `roles?`); `PUT /meetings/:id` uses `meetingEditSchema` (same fields minus `recurrence`, plus `expectedVersion`). The recurrence rule itself cannot be edited after creation: archive the series (`?scope=all`) and recreate. Explicit `roles` on create apply to every occurrence; `autoAssignRoles` rotates per occurrence.
- **Scope edits.** `?scope=future|all` applies the non-time fields to the siblings and shifts their start by the same delta as the edited occurrence, keeping the new duration and RSVP lead time. Only the edited occurrence is version-checked; siblings get `version + 1`. `restore?scope=` targets archived siblings. `scope` also works on `archive`/`restore` as documented.
- **Time zones.** `expandOccurrences(startsAt, rule, timezone, limit = 52)` (not `expand(startsAt, rule, limit)`): the wall clock is taken in the meeting's zone (falls back to `clubs.timezone`, then UTC) so 7 PM stays 7 PM across DST. `custom` with `byDay` behaves weekly; with `byMonthDay`/`nthWeekday` monthly. A `byMonthDay` beyond the month's length clamps to the last day.
- **Calendar feed.** The public path is `GET /api/public/calendar/:token.ics` (not `/calendar.ics?token=`); `GET /calendar/feed-url` returns `{ url }`. Token = base64url(`userId:clubId:` + base64url(HMAC-SHA256(`BETTER_AUTH_SECRET`, `userId:clubId`))). The feed covers meetings from 90 days ago onward plus assignment due dates as all-day events; anything invalid, or a token for someone no longer a member, is a 404. Events use `DTSTART;TZID=<zone>` without a VTIMEZONE block (Google/Apple/Outlook accept IANA names). Each occurrence is its own VEVENT (`UID = <id>@chapterr.io`); the single-meeting `.ics` of a recurring meeting carries an `RRULE` with `COUNT` = remaining occurrences.
- **Reminders.** Window is `[start - offset, start - offset + 60 min)` rather than 15 min so a skipped tick still delivers; the `(meeting, offset)` row is claimed with `INSERT OR IGNORE` before sending, so repeated ticks never double-send. Recipients: club members whose RSVP is not `no`, including the creator. In-app via `notifyUsers` (kind `meeting_reminder`, `actorId` null, link `/c/:clubId/meetings/:id`); email via `meetingReminderEmail` (pref `email_meeting_reminders`); push/SMS are W3's fan-out inside `notifyUsers`. The same tick also closes expired polls.
- **Roles.** `PUT /meetings/:id/roles` is admin+ only (members cannot hand themselves roles). Fairness: fewest assignments of that role, then longest ago, then longest-standing member; the suggestion avoids giving one member two roles when the club has enough people. RSVP changes notify the host (`rsvp_update`, at most once per member per meeting per hour).
- **Sign-ups.** Any member may create lists/items and edit or delete them; claims are capped by `quantity` (409 `item_taken`); `DELETE /signups/:listId` removes a list; each write returns the updated `SignupList` (version bumped).
- **Pack.** Cached per meeting (not per viewer), so only club-visible quotes/reviews are included. `?refresh=1` rebuilds. RSVP counts in the pack are always live.
- **Notification link** for `club_meeting` (new meeting) stays `/c/:clubId/meetings` (the wave 1 contract and test).

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

### W1 implementation notes (polls)

- `GET /polls/:id` exists too. `Poll` gained `allowMemberOptions` (stored in `polls.allow_member_options`, added by `migrations/0004_poll_member_options.sql`; 0003 is untouched). Per-option fields are `votes`, `voters` (`[]` when anonymous) and `mine`; there is no separate `myVotes` array.
- Options are validated per kind on create and on `POST /:id/options` (book: `editionId` required and must exist; date: `startsAt` required). `closesAt` must be in the future. Max 20 options.
- `PUT /:id/vote` on a single-choice poll with more than one option id is a 400; voting on a closed poll is 409 `poll_closed`.
- `POST /:id/apply` (admin+) closes an open poll first; no votes → 409 `no_votes`; already applied → 409 `already_applied`. Body is optional: `{ year?, title? }` (year for book polls, meeting title for date polls). Date polls reuse `polls.meeting_id` when set (the meeting is moved), otherwise create a meeting in the club's zone. The book apply notifies with kind `poll_closed`, the date apply with `club_meeting`.
- `DELETE /:id` (archive) is admin+ or creator. Rate limit: 20 writes/hour per member across create, add options and vote.
- `closeExpiredPolls(env, now)` is exported from `worker/routes/polls.ts` and runs from `runMeetingReminders`; it notifies every member (including the creator) with kind `poll_closed`.

## 3. Chat upgrades (W2)

Every message endpoint (club chat, DMs, rooms, threads, scheduled sends) returns `ChatMessage = Message & MessageExtras` (`shared/types-chat.ts`): `parentId`, `replyCount`, `attachments: Attachment[]` (`url` = `/api/clubs/:clubId/files/:fileId/content`), `mentions: MemberSummary[]`, `reactions: { emoji, count, mine }[]` (sorted by count, then first reaction), `kind: 'user' | 'system' | 'welcome' | 'digest'`. `Conversation` gains `roomId: string | null` (`ConversationExtras`).

| Method | Path | Notes |
|---|---|---|
| GET | `/conversations` | club + direct conversations only (rooms are listed per book); previews ignore replies |
| GET | `/conversations/:id` | `{ ..., roomId, title }`; a room's title is the room name, `otherMember` null |
| GET | `/conversations/:id/messages` *(paged)* | top-level messages only (replies live in threads) |
| POST | `/conversations/:id/messages` | `messageCreateSchema { body, parentId?, attachmentFileIds? }` (body may be empty when a photo is attached). `@username` tokens (case-insensitive) resolve to club members; unknown names are ignored. Attachments must be `files` rows of kind `attachment` owned by the sender in this club (422 otherwise). `parentId` must be a live top-level message in the same conversation (400 for a reply-to-reply, 404 across conversations); the parent's `reply_count` is bumped |
| GET | `/messages/:id/thread` *(paged, oldest first)* | `{ items, nextCursor, parent }`; `nextCursor` is the newest timestamp on the page |
| PUT | `/messages/:id/reactions` | `{ emoji }` (one of `MESSAGE_EMOJI`) toggles → `{ messageId, reactions, mine }` |
| PUT/PATCH | `/messages/:id` | sender only; mentions are re-read from the new text and newly mentioned members notified |
| DELETE | `/messages/:id` | sender only; body, attachments and mentions are erased (the row stays as "removed"); `reply_count` is not decremented |
| GET | `/scheduled` | caller's pending sends in this club, soonest first (`ScheduledMessage`, `conversationTitle` = club name / member name / room title) |
| POST | `/scheduled` | `{ conversationId, body, sendAt }`; `sendAt` 2 min to 90 days ahead (400), same access/gate rules as sending now, max 20 pending per member per club (409 `limit_reached`) |
| DELETE | `/scheduled/:id` | cancel (own, pending) |

Notifications: `mention` (link `/c/:clubId/messages/:conversationId?message=:id`, or `/c/:clubId/rooms/:editionId?room=:roomId&message=:id` inside a room), `thread_reply` to the parent's author (unless already mentioned), `reaction` to the author at most once per message per hour (fixed window in `rate_limits`, key `reaction-notify:<messageId>`), `direct_message` as before (skipped for members already notified by a mention). Only members allowed to read the conversation are ever notified (a room's audience is its unlocked members).

Realtime (`RealtimeEventWave2` in `shared/types-chat.ts`, to be unioned with `RealtimeEvent` on the client): `message.reaction { messageId, conversationId, reactions }`, `thread.reply { parentId, conversationId, replyCount, message }` (replies do **not** also emit `message.created`; edits and removals of replies emit `message.updated` with `parentId` set), `progress.updated { editionId, userId, progress }`, `rooms.changed { editionId }`.

Cron (`runScheduledMessages`, every tick): due rows are claimed (`sent_at`) first so overlapping ticks cannot double-send, then posted through `sendMessage` as the sender (mentions, threads, realtime, unread, notifications all apply); `sent_message_id` is recorded. A sender who left the club, or a conversation that is gone or locked (any `ApiError`), gets `canceled_at` instead; transient errors release the claim for the next tick.

Welcome (`worker/lib/welcome.ts: postWelcome(env, clubId, userId)`, called by the join/approve flows): when `clubs.welcome_message` is set, the owner posts a `kind: 'welcome'` message into the club conversation (`@username <message>`, `mentions = [newcomer]`, notification kind `welcome`) and sends the same text as a `welcome` DM (the DM raises no `direct_message` notice). Never throws.

## 4. Discussion rooms, progress, guides (W2)

**Room conversations.** `conversations.kind` is CHECKed to `club|direct` and `club` is unique per club, so a room's conversation is stored as `kind = 'direct'`, `direct_key = 'room:<roomId>'`, `room_id = <roomId>`. Every current member gets a `conversation_participants` row when the room is created; later joiners are added the first time they open the room (`ensureRoomParticipant`). Rooms never appear in `GET /conversations`. Every read and write on a room conversation (messages, read receipts, reactions, threads, scheduled sends) passes the gate check in `authorizeConversation`; the realtime audience of a room is the set of members whose progress satisfies the gate. Admins are **not** exempt. Unread counts (`unreadInClub`, `unreadByClub`) exclude rooms the member has not unlocked (`roomVisibleSql`).

Gate rule (`gateSatisfied` / `gateOpenSql`): `none` always open; `finished` requires `finished`; `chapter|page|percent` require that field ≥ `gateValue`; finishing the book opens every room. A locked room answers `403 { code: "room_locked", message, gate: { type, value }, progress }` (`RoomLockedError`).

| Method | Path | Notes |
|---|---|---|
| GET | `/books/:editionId/rooms` | `DiscussionRoom[]` ordered by position; locked rooms carry title/gate/`membersInside` only (`messageCount: 0`, `lastMessageAt: null`, `questions: []`) |
| POST | `/books/:editionId/rooms` | admin+ `roomSchema`; `gateValue` required for chapter/page/percent (400); max 60 rooms per book (409) |
| POST | `/books/:editionId/rooms/auto` | admin+ `{ chapters, reflection = true }` → "Chapter n" rooms gated `chapter = n` plus "Finished the book" (`reflection`, gate `finished`). Idempotent: existing chapter numbers / reflection room are kept; 201 when something was created, else 200. Returns the full list |
| GET | `/rooms/:roomId` | room + `conversationId` + pinned `questions` (guide questions whose `roomId` is this room); 403 `room_locked` when locked |
| DELETE | `/rooms/:roomId` | admin+ archive; the conversation becomes unreachable (404) |
| GET/PUT | `/books/:editionId/progress` | own `ClubReadingProgress`; `PUT progressSchema`. `finished` also sets `percent = 100`, fills `page` from the edition's page count when omitted, marks the member's `user_books` row finished (status, `finished_at` = today, 100%) and logs reading for today in `reading_log` (pages delta, or the remaining pages when finishing). A page increase alone also logs the delta. `?today=YYYY-MM-DD` is the member's local date |
| GET | `/books/:editionId/progress/all` | `MemberProgress[]`: member summary + `{ chapter, page, percent, finished, updatedAt }` for every member (finished first); nothing else |
| GET | `/books/:editionId/guide` | `DiscussionGuide` or 404 when none yet |
| PUT | `/books/:editionId/guide` | admin+ `guideSchema { sections, expectedVersion? }`; creates (201) or updates (200, `source: 'manual'`); when `expectedVersion` is sent it must match (409 with `current`); question ids are kept when unique, otherwise generated; `roomId` must be a live room of this book in this club (400); max 40 questions |
| POST | `/books/:editionId/guide/generate` | admin+ `{ source: 'template' \| 'ai', chapters? }`, 10/hour per club. `template` (`worker/lib/prompts.ts`): deterministic, genre-aware (club genre tags on the book + title/description keywords), 12-18 questions in "Before you start" (spoiler-free), "While reading" (per chapter block when `chapters` is given or inferred from chapter rooms, each block pinned to the chapter room whose gate matches), "At the end" (pinned to the reflection room) and "Beyond the book"; ids `q1..qN`. `ai` (`worker/lib/ai.ts`): needs `ANTHROPIC_API_KEY`, else `409 ai_unavailable { message: "AI guides need an API key; the template guide works without one." }`; POSTs to the Claude Messages API (`claude-sonnet-5`, `max_tokens 1500`, `anthropic-version 2023-06-01`) with a JSON-only system prompt; any network/HTTP/parse/shape failure → `502 ai_failed`; ids `ai1..aiN`, end-of-book sections pinned to the reflection room. Either source replaces the current guide (`source` recorded, version bumped) |

Milestones = rooms of kind `milestone` with any gate.

Catch-up digest (`runCatchUpDigests`, daily 13:00 UTC tick): for each member with `digest_catch_up` on and not muted, each club conversation or **unlocked** room with ≥ 10 unread messages (since `conversation_participants.last_read_at`, or the member's join time, and newer than the last digest's `through_message_id`) and no digest for that conversation in the last 24 h gets rolled into one in-app `digest` notification per club (counts per conversation, link to the club chat or room; actor = latest unread sender) plus a `digestEmail` (counts and the five most-reacted unread messages the member may see) when `email_club_updates` is on. Deliveries are recorded in `digest_deliveries (user_id, conversation_id, delivered_at, through_message_id)`, so re-running a tick, or running again a day later with nothing new, sends nothing.

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

**As built (W3).** Storage: `worker/lib/storage.ts` (`putFile`, `getFile`, `deleteFile`, `clubUsage`, `fileUrl`); R2 key `clubs/<clubId>/<fileId>`, D1 fallback via `file_blobs`; content-type allowlist = jpeg/png/webp/gif, pdf, text/plain, text/markdown, docx/xlsx/pptx (HTML/SVG/JS are refused with `415 unsupported_type`); `banner`/`photo` kinds must be images; sha256 stored. Quotas → `409 quota_exceeded`; the Worker's 2 MB body limit (413) applies to every upload, so the R2 25 MB ceiling is theoretical until that limit is raised for `/files`. Extra routes: `GET /files/usage` → `FileUsage`, `GET /files/:id` (metadata), `?download=1` on `/content` for an attachment disposition. Content headers: `Content-Disposition: inline; filename="<sanitised>"`, `Cache-Control: private, max-age=86400`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`. Uploads are rate limited 60/hour/member. Deleting a file that is the club banner needs admin (`409 file_in_use` otherwise) and clears the banner. `GET /branding` and `PUT /branding` return `ClubBranding & { version }`; `GET /api/clubs/:id` carries `branding`. `GET/PUT /settings` return `ClubSettings & { version }` (the webhook is never returned; omit `discordWebhookUrl` to keep it, send `null` to clear). Screening question ids are generated server-side when absent. Join requests: `POST /api/clubs/join` accepts `joinAnswersSchema`; with policy `approval` it answers `202 JoinPending { pending, requestId, clubName }`, spends the invite code, notifies admins (`join_request`) and emails them (`joinRequestEmail`); re-posting while pending is idempotent; a declined member may ask again. `GET /api/clubs/requests` (mine, `MyJoinRequest[]`) and `DELETE /api/clubs/requests/:id` (withdraw). Approve → membership + chat seat + `postWelcome` + `join_approved` notice + `club_member_joined` to admins; decline → notice to the requester (kind `club_removed`, club-less, body = optional note). Bulk invites: `POST /invites/bulk { csv, expiresInDays }` → `201 BulkInviteResult`; dedupes within the file, against members and against live email invites; rate limit 3 runs/hour/club; `club_invites.accepted_by` is recorded when an email invite is accepted. Export: `GET /members/export.csv` (admin+) columns Name, Username, Email, Role, Joined, Meetings attended (12 months), Books finished (year; club-visible only); cells starting with `= + - @` are quote-prefixed.

## 6. Push, SMS, reading log, challenges, recaps (W3)

- Push: `GET /api/push/public-key`, `POST /api/push/subscribe { endpoint, keys }`, `DELETE /api/push/subscribe { endpoint }`. `worker/lib/webpush.ts` implements VAPID + `aes128gcm` with WebCrypto (no npm dependency); `sendPush(env, userId, payload)`; drop subscriptions after 3 consecutive 404/410. Payload `{ title, body, url, tag }`. The service worker (`src/sw-push.ts`, F3) shows it. Wire into `notifyUsers` for kinds the member allows.
- SMS: `worker/sms/index.ts` adapter (`console` locally; `twilio` when `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM` secrets exist). Used only for meeting reminders to opted-in members with a phone. `PUT /api/account/phone { phone, smsOptIn }` (E.164).
- Reading log **personal**: `PUT /api/reading-log/:day { pages, minutes, editionId?, note }`, `GET /api/reading-log?from&to`, `GET /api/reading-log/streak` → `{ current, longest, today: boolean }` (streak = consecutive days with pages or minutes > 0, in the member's zone). Marking progress in the library/club also logs today.
- Challenges: **personal** `/api/challenges` and club `/challenges` (CRUD, join, progress computed: books finished / pages read / genre count / streak days within window; `custom` uses manual progress). `GET` returns `ChallengeSummary[]` with leaderboard (club) or own progress.
- Recaps: `GET /api/recaps/monthly?month=YYYY-MM` (personal: books finished, pages, streak, top genre, club meetings attended) and `GET /api/clubs/:id/recaps/monthly`, `GET /api/clubs/:id/wrapped?year=` (`ClubWrapped`: books read, pages, meetings, attendance rate, most-reacted message, most-loved book, top reviewer, longest streak holder, busiest month, poll stats). Cached in `recap_cache` for 6 h. The shareable graphic is drawn client-side (F3) from this JSON.

**As built (W3).** Push: `GET /api/push/public-key` (404 `push_unavailable` until `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` and the `VAPID_PRIVATE_KEY` secret are set), `GET /api/push/subscriptions`, `POST /api/push/subscribe` (201 `PushSubscriptionInfo`; upsert by endpoint, 20/hour), `DELETE /api/push/subscribe`, `POST /api/push/test` (5/hour). `VAPID_PRIVATE_KEY` is the 32-byte base64url scalar paired with the 65-byte public key (a JSON JWK also works). `sendPush(env, userId, { title, body, url, tag })` → `{ sent, failed, removed, skipped }`; 404/410 delete at once, other failures after 3 in a row. `notifyUsers(env, recipients, input, ctx?)` now fans out after the in-app insert: push to members with `push_enabled` (plus `push_mentions` for mention/thread_reply/reaction and `push_meeting_reminders` for meeting_reminder), SMS for `meeting_reminder` (opt-in + `sms_meeting_reminders`), email only when `input.channels.email` is true (W1's reminder cron emails on its own). `input.channels` overrides any channel; pass `c.executionCtx` as `ctx` so the fan-out runs after the response. SMS: `worker/sms` (`createSmsProvider`, `sendSms(env, userId, text)`); console adapter files texts in `dev_outbox` with subject `SMS`. `PUT /api/account/phone` and `PUT /api/account/preferences` (now accepts the wave 2 switches optionally); `Me` carries `phone`, `smsOptIn` and the push/reminder/digest preferences. Reading log: `PUT /api/reading-log/:day` → `{ entry, streak }` (totals replace), `GET /api/reading-log?from&to` (default last 90 days), `GET /api/reading-log/streak` → `Streak { current, longest, today, lastDay }`, `DELETE /api/reading-log/:day`; `?today=YYYY-MM-DD` hint or `profiles.timezone` decides the member's day. Other streams log activity with `logReadingToday(db, userId, editionId | null, pagesDelta | null, todayHint?)` from `worker/lib/streaks.ts` (adds pages to today; a null/zero delta still marks the day active). Challenges: personal `GET/POST /api/challenges`, `GET/PUT/DELETE /api/challenges/:id`, `PUT /api/challenges/:id/progress` (custom only); club `GET/POST /challenges`, `GET/PUT/DELETE /challenges/:id` (creator or admin), `POST /challenges/:id/join|leave`, `PUT /challenges/:id/progress`. Responses are `Challenge` with `participants` sorted by progress (the leaderboard) and `myProgress`; completion stamps `completed_at` and notifies the club (`challenge_update`), as does creating a club challenge. Recaps: `GET /api/recaps/monthly?month=`, `GET /api/clubs/:id/recaps/monthly?month=`, `GET /api/clubs/:id/recaps/wrapped?year=` (note the `/recaps/` prefix); cached 6 h in `recap_cache`, invalidated for the member when their log changes.

## 7. Pace planner, mappings, feasibility, bridge, cross-club (W1 pace/mappings, W3 the rest)

- `POST /pace-plans { editionId, meetingId?, startsOn, endsOn?, totalPages?, cadence, restDays, createAssignments: true }` → splits pages evenly by cadence into `schedule` and creates assignments with `from_page/to_page`; `GET /pace-plans/:editionId` returns the plan plus the viewer's personal daily pages (`(toPage - myPage) / daysLeft`, from club progress). `PUT`/`DELETE`.
- `PUT /api/books/editions/:id/mappings { kind, total, label }` (any member); `Assignment` gains `ranges: { pages, kindle, audio }` computed proportionally from `from_page/to_page` and the edition's `page_count` + mappings (`worker/lib/mapping.ts`).
- **W1 notes.** The pace routes are mounted inside the meetings router (`/api/clubs/:clubId/pace-plans`). Due dates run from `startsOn` (exclusive) at the cadence (`weekly` 7 days, `twice_weekly` 3/4 days alternating, `daily`), slide past rest days, and always end on `endsOn` (or the meeting's local date when only `meetingId` is given). Pages split evenly with the remainder on the earliest slots. One plan per club per edition (`POST` on an existing one is 409 `duplicate` with the current plan); `PUT /pace-plans/:editionId` (`pacePlanUpdateSchema`, with `expectedVersion`) archives the plan's previous assignments and creates new ones; `DELETE` archives them and removes the plan. `personal` = `{ myPage, pagesLeft, daysLeft, pagesPerDay, onTrack }` from `club_reading_progress` (page, else percent, else 0). `Assignment` responses are `AssignmentWithRanges` (`fromPage`, `toPage`, `pacePlanId`, `ranges`; audio as `h:mm:ss`). Mappings: `GET /api/books/editions/:id/mappings` → `EditionMappings { editionId, pageCount, mappings }`, `PUT` upserts one kind and returns the same; `GET /api/books/editions/:id` also returns `mappings: EditionMapping[]`.
- Feasibility `GET /api/books/editions/:id/feasibility` → `{ library: { openLibraryLendable, archiveOrgUrl, worldcatUrl }, ebook: { googleBooksPrice?, googleBooksUrl, kindleSearchUrl, kindleUnlimited: 'unknown' }, audio: { libroFmUrl, audibleSearchUrl }, pageCount, estimatedHours }` from Open Library (`availability` API) and Google Books `saleInfo` (free, keyless) with 24 h cache; everything else is a link, labelled best-effort.
- Bridge: `GET /meetings/:id/share` → `{ text, url, whatsapp, sms, email, copy }` deep links (`https://wa.me/?text=`, `sms:?&body=`, `mailto:`); `POST /bridge/discord { kind: 'meeting'|'poll'|'assignment', id }` admin+ posts to the club's Discord webhook if set (server-side fetch, never exposes the URL).
- Cross-club: `GET /api/clubs/:id/intelligence?editionId=` → `{ duplicatePicks: [{ clubName, year, status }], suggestions: [{ edition, reason }] }` — the viewer's other clubs' lists/finished books (only titles, never other clubs' members); also surfaced when adding a book to a list (`POST /books` returns `warnings`).

**As built (W3).** Feasibility: `worker/lib/feasibility.ts` (`getFeasibility`, `computeFeasibility`); Open Library `isbn/<isbn13>.json` → `ocaid`, else archive.org advancedsearch → identifier; archive.org loans availability → `openLibraryLendable`; Google Books volumes (keyless) → `googleBooksPrice` (formatted) and `googleBooksUrl`; `estimatedHours = pages / 40`; cached 24 h (Workers cache keyed by edition id); rate limit 60/hour/member. Bridge lives in `membership.ts`: `GET /bridge/share?kind=meeting|poll|assignment&id=` → `ShareLinks & { copy }` with the deep link under `PUBLIC_APP_URL`; `POST /bridge/discord { kind, id }` admin+, 10/hour/club, `409 discord_not_configured` without a webhook, `502 discord_failed` when Discord refuses. Cross-club: `GET /intelligence?editionId=` compares by work (`book_id`) and suggests up to 5 titles from the viewer's other clubs (completed or current this year, not on this list), reasons derived from counts only. `POST /books` warnings are W1/club.ts territory and are not wired.

## 8. Notifications (new kinds)

`meeting_reminder`, `rsvp_update` (host), `poll_opened`, `poll_closed`, `join_request` (admins), `join_approved`, `mention`, `thread_reply`, `reaction`, `digest`, `challenge_update`, `welcome`. Every kind routes through `notifyUsers` which fans out to in-app + push (per `push_enabled`, `push_mentions`, `push_meeting_reminders`), SMS for `meeting_reminder`, and email only when the caller sets `channels.email` (see §6). Declined join requests reuse `club_removed` (club-less) since there is no dedicated kind.

W1 kinds as implemented: `meeting_reminder` (cron, no actor, link `/c/:clubId/meetings/:id`), `rsvp_update` (to the host only, throttled hourly per member and meeting), `poll_opened` (club, on create), `poll_closed` (club, on manual close, cron close and book apply). Cron notices pass `actorId: null` to `notifyUsers` so the creator is included; `notifyUsers` should keep treating a null actor as "system".

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
