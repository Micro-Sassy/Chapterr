# Security notes

## Threat model

Many independent, private book clubs sharing one deployment on the public internet. Anyone can register, so the realistic risks are: automated sign-ups, club spam and credential stuffing; a member of one club reading or altering another club's data; one member reading or altering another member's private data; leaking chats or private content through share links; cross-site request forgery; and leaked secrets. Search-engine indexing preferences are **not** a security control.

## Authentication

- Better Auth with email + password and the username plugin (sign in with either). Usernames are ASCII `a–z 0–9 _`, lowercased, 3–30 characters, no leading/trailing/double underscores, and a reserved-name list — preventing case and homoglyph look-alikes. The database also has case-insensitive unique indexes.
- Email verification is required before a session is issued (`requireEmailVerification`).
- Passwords: PBKDF2-HMAC-SHA256 via native WebCrypto, 16-byte random salt, up to 100,000 iterations (Cloudflare's maximum), constant-time comparison, self-describing hash format. Minimum length 10.
- Password reset: generic response whether or not the email exists; tokens expire after 1 hour, are single-use, and are stored hashed (`verification.storeIdentifier = "hashed"`); a reset revokes all sessions and closes realtime sockets; a "password changed" notice is emailed.
- Sessions: HttpOnly, SameSite=Lax, `Secure` in production, `chapterr.` cookie prefix, 30-day expiry refreshed at most daily. No cookie cache, so revocation is immediate. Members can list and revoke their sessions.
- Sensitive changes (username, email, account deletion) require the current password; password change requires the current password and can sign out other devices. Better Auth endpoints that would bypass these checks (`/update-user`, `/change-email`, `/delete-user`, social sign-in, etc.) are not reachable — the auth guard only forwards an explicit allowlist.

## Abuse protection

- Turnstile (server-side siteverify, fail-closed) on sign-up, sign-in, password-reset requests, verification resends, share-link creation, club creation and joining a club.
- Rate limits stored atomically in D1 (single `UPSERT … RETURNING`): Better Auth per-IP rules for auth endpoints plus per-identifier limits (sign-in attempts per account, reset and verification requests per email, password confirmations, messages per member per club, reviews/quotes/recommendations per member, club creation, join attempts per member and per IP, invite creation per club, invite previews and public share views per IP, book searches, share creation, imports). Hard caps: clubs owned/joined per account, members per club, 20 live invites per club.
- 2 MB request body limit; all input validated with Zod (length limits, control-character stripping, enum checks).

## Authorization

- Every non-public `/api/*` route is behind `requireUser` (valid session, verified email). Public routes: health, config (site key only), auth, `/api/public/shares/:token` and `/api/invites/:code` (club name, description, member count and inviter name only; never a member list).
- Club isolation: every `/api/clubs/:clubId/*` route first runs `requireClubMember`, which loads the club and the caller's membership in one query (`403 not_a_member`, or `404` for unknown/archived clubs). Every query in club routes filters by `club_id`, including versioned updates (`AND club_id = ?`), so a record id from another club is a 404 even when guessed. Admin actions use `requireClubRole`; admins cannot change or remove other admins or the owner; ownership transfer and club deletion are owner-only and re-verify the password.
- Personal data: every mutation includes `AND user_id = <session user>`; reads apply the visibility rule: private items are owner-only, `club` items are visible only to members who share at least one live club with the owner (`visibleToViewerSql`). Member profiles are `404` to anyone who does not share a club. Personal notes and quote notes are only returned to their owner. Profile and member-list responses never include email addresses. Recommendations can only be sent to members of the same club.
- Shared club data: all members of the club may edit; optimistic concurrency prevents silent overwrites; audit fields record who changed what.
- Messages: a club's conversation is readable by its members; direct conversations exist per club and only for their two participants (non-participants and other clubs get 404 to avoid probing). Removing a member deletes their participation in every conversation of that club. Only the sender can edit or remove a message; removal erases the text in the database.
- WebSocket upgrades are authenticated, membership-checked and `Origin`-checked (prevents cross-site WebSocket hijacking). Each club has its own Durable Object, reachable only through the Worker; a member's sockets are closed when they leave, are removed, or the club is deleted.
- Invite codes: 10 characters from a 32-symbol alphabet via `crypto.getRandomValues` (160 bits), expiring, use-limited and revocable; unknown and revoked codes are indistinguishable (404). Admins only.

## Public sharing

- Explicit opt-in per item; tokens are 256-bit random, stored as SHA-256 hashes, optionally expiring, revocable, and view-counted.
- Payloads contain only the shared content, public book metadata, the author's display name and (for club lists) the club name — no ids, emails, usernames, notes or private items (reading-list shares include only club-visible entries).
- A club list can be shared only by a current member of that club, and the public page stops resolving as soon as the sharer leaves or the club is deleted.
- There is no share type for conversations or messages, enforced in the Zod schema and by a database `CHECK` constraint.
- Deleting a review or quote revokes its share links; deleting a club revokes its list shares and invites.

## Secrets and transport

- Secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `GOOGLE_BOOKS_API_KEY`) are Worker secrets only; the browser receives only the Turnstile site key via `/api/config`. `.dev.vars` is git-ignored.
- Resend is called only from the Worker. The console email provider and dev outbox refuse to run when `APP_ENV=production`.
- Security headers: CSP (self + Turnstile + cover image hosts), `frame-ancestors 'none'`, nosniff, strict referrer policy, restrictive Permissions-Policy, HSTS in production.
- Outbound links to retailers use `rel="noopener noreferrer nofollow"`; cover images load with `referrerpolicy="no-referrer"`.

## Reporting

If you find a problem, email the Chapterr team privately rather than posting details in a club chat.
