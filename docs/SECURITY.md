# Security notes

## Threat model

A small private club on the public internet. Anyone can register, so the realistic risks are: automated sign-ups and credential stuffing, one member reading or altering another member's private data, leaking chats or private content through share links, cross-site request forgery, and leaked secrets. Search-engine indexing preferences are **not** a security control.

## Authentication

- Better Auth with email + password and the username plugin (sign in with either). Usernames are ASCII `a–z 0–9 _`, lowercased, 3–30 characters, no leading/trailing/double underscores, and a reserved-name list — preventing case and homoglyph look-alikes. The database also has case-insensitive unique indexes.
- Email verification is required before a session is issued (`requireEmailVerification`).
- Passwords: PBKDF2-HMAC-SHA256 via native WebCrypto, 16-byte random salt, up to 100,000 iterations (Cloudflare's maximum), constant-time comparison, self-describing hash format. Minimum length 10.
- Password reset: generic response whether or not the email exists; tokens expire after 1 hour, are single-use, and are stored hashed (`verification.storeIdentifier = "hashed"`); a reset revokes all sessions and closes realtime sockets; a "password changed" notice is emailed.
- Sessions: HttpOnly, SameSite=Lax, `Secure` in production, `trbc.` cookie prefix, 30-day expiry refreshed at most daily. No cookie cache, so revocation is immediate. Members can list and revoke their sessions.
- Sensitive changes (username, email, account deletion) require the current password; password change requires the current password and can sign out other devices. Better Auth endpoints that would bypass these checks (`/update-user`, `/change-email`, `/delete-user`, social sign-in, etc.) are not reachable — the auth guard only forwards an explicit allowlist.

## Abuse protection

- Turnstile (server-side siteverify, fail-closed) on sign-up, sign-in, password-reset requests, verification resends and share-link creation.
- Rate limits stored atomically in D1 (single `UPSERT … RETURNING`): Better Auth per-IP rules for auth endpoints plus per-identifier limits (sign-in attempts per account, reset and verification requests per email, password confirmations, message sending, book searches, share creation, imports, and public share views per IP).
- 2 MB request body limit; all input validated with Zod (length limits, control-character stripping, enum checks).

## Authorization

- Every non-public `/api/*` route is behind `requireUser` (valid session, verified email). Public routes: health, config (site key only), auth, and `/api/public/shares/:token`.
- Personal data: every mutation includes `AND user_id = <session user>`; reads apply `visibility = 'club' OR user_id = viewer`. Personal notes and quote notes are only returned to their owner. Member profile responses never include email addresses.
- Shared club data: all members may edit; optimistic concurrency prevents silent overwrites; audit fields record who changed what.
- Messages: the club conversation is readable by all members; direct conversations only by their participants (non-participants get 404 to avoid probing). Only the sender can edit or remove a message; removal erases the text in the database.
- WebSocket upgrades are authenticated and `Origin`-checked (prevents cross-site WebSocket hijacking). The Durable Object is only reachable through the Worker.

## Public sharing

- Explicit opt-in per item; tokens are 256-bit random, stored as SHA-256 hashes, optionally expiring, revocable, and view-counted.
- Payloads contain only the shared content, public book metadata and the author's display name — no ids, emails, usernames, notes or private items (reading-list shares include only club-visible entries).
- There is no share type for conversations or messages, enforced in the Zod schema and by a database `CHECK` constraint.
- Deleting a review or quote revokes its share links.

## Secrets and transport

- Secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `GOOGLE_BOOKS_API_KEY`) are Worker secrets only; the browser receives only the Turnstile site key via `/api/config`. `.dev.vars` is git-ignored.
- Resend is called only from the Worker. The console email provider and dev outbox refuse to run when `APP_ENV=production`.
- Security headers: CSP (self + Turnstile + cover image hosts), `frame-ancestors 'none'`, nosniff, strict referrer policy, restrictive Permissions-Policy, HSTS in production.
- Outbound links to retailers use `rel="noopener noreferrer nofollow"`; cover images load with `referrerpolicy="no-referrer"`.

## Reporting

This is a private club project. If you find a problem, tell the club organiser privately rather than posting details in the club chat.
