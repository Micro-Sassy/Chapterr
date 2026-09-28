# Teel Ridge Book Club

**Live at https://bookclub.teelridge.com** (emails are sent from `books@mail.teelridge.com`).

A private, installable web app (PWA) for one book club. Members keep personal reading libraries, share a club reading list and goals, plan meetings and assignments, write reviews, save quotations, recommend books, import their Goodreads history, share selected items publicly, and chat in real time.

It is not a commercial product: there are no subscriptions, billing, organizations, invitations, admin roles or approval workflows. Everything runs on free tiers: **Cloudflare Workers + D1 + Durable Objects + Turnstile**, **Resend** for email, and **Open Library** (optionally **Google Books**) for book data.

- [What the app does](#what-the-app-does)
- [How it is built](#how-it-is-built)
- [Run it on your computer](#run-it-on-your-computer)
- [Put it online (Cloudflare production setup)](#put-it-online-cloudflare-production-setup)
- [Automatic deploys from GitHub](#automatic-deploys-from-github)
- [Custom domain and HTTPS](#custom-domain-and-https)
- [Email with Resend](#email-with-resend)
- [Bot protection with Turnstile](#bot-protection-with-turnstile)
- [Book search (Open Library / Google Books)](#book-search-open-library--google-books)
- [Configuration reference](#configuration-reference)
- [Database migrations](#database-migrations)
- [Testing](#testing)
- [Security and privacy model](#security-and-privacy-model)
- [Free-tier notes and limits](#free-tier-notes-and-limits)
- [Troubleshooting](#troubleshooting)

---

## What the app does

**Accounts**
- Open registration for anyone with the URL: username, display name, email, password (+ confirmation), acceptance of a short privacy notice, and a Turnstile check.
- Email verification is required before an account can sign in.
- Sign in with **email or username**. Sessions persist across visits (30 days, refreshed daily) in secure, HttpOnly, SameSite cookies.
- Forgot/reset password by email. A reset **signs the account out everywhere**.
- Change display name, profile, photo, username\*, email\* and password\* (\* requires the current password). See and sign out other devices. Download your data or delete your account.

**Personal reading** (only you can change these)
- Library with To-be-read, Reading, Finished and Did-not-finish shelves, start/finish dates, page or percent progress, and private notes.
- Reviews with a five-state feeling (Loved it → Really disliked it), spoiler flag and reactions from other members.
- Quotations with page/location and a private note.
- Annual reading goal with progress and a monthly chart.
- Recommendations to one member or the whole club.
- Every item is **Club** (visible to signed-in members) or **Only me**.

**Shared club data** (any member can create, edit, reorder or archive)
- Annual club reading list with ordering and status, and an annual club goal.
- Reading assignments (book, due date, what to read, linked meeting).
- Meetings, other group activities, and the club's genre/tag list.
- Edits by two members at once are detected: the second save gets a clear "someone else changed this" message and the latest copy.

**Books**
- Catalogue stored **per edition**, keyed by ISBN-13 where available. Search the club catalogue plus Open Library (or Google Books when a key is set); add books manually when needed; correct edition details.
- "Find this edition" links (Amazon, GetTextbooks, Bookshop.org, WorldCat, Open Library) are plain search links built from the ISBN — no scraping.

**Messages**
- Main club conversation and one-to-one direct messages, delivered instantly over WebSockets.
- Senders can edit (marked "edited") or remove (shown as "Message removed") their own messages.
- Chats are members-only and can **never** be shared publicly.

**Sharing**
- Create a public link for one review, one quote, one of your lists (club-visible items only), or the club's annual list. Links can expire and can be turned off at any time.

**Goodreads import**
- Upload the CSV from Goodreads "Export Library". The file is parsed in your browser, previewed, then imported in batches. Ratings map to review feelings, shelves to reading statuses, and re-importing updates instead of duplicating.

**PWA**
- Installable on phones, tablets and desktops, with maskable icons, an offline app shell, an "update available" prompt, and an offline banner. Private API data is deliberately **not** cached by the service worker.

## How it is built

| Part | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Tailwind CSS + design tokens, Lucide icons |
| Runtime | One Cloudflare Worker (via the official Cloudflare Vite plugin) serving both the SPA assets and the API |
| API | Hono |
| Database | Cloudflare D1 (SQLite) with versioned SQL migrations in `migrations/` |
| Auth | Better Auth (native D1 support, username plugin), PBKDF2 password hashing via WebCrypto |
| Realtime | One `ClubRealtime` Durable Object using the WebSocket Hibernation API; D1 is the source of truth |
| Email | Resend REST API behind a small provider adapter (`worker/email/`) |
| Validation | Zod schemas in `shared/` used by both browser and Worker |
| Tests | Vitest (+ React Testing Library), `@cloudflare/vitest-pool-workers` for API tests in the real Workers runtime, Playwright end-to-end |

```
src/          React app (routes/, components/, lib/)
shared/       Zod schemas, types, ISBN utilities, Goodreads parser (used by both sides)
worker/       Hono API, auth, email, realtime Durable Object, catalogue providers
migrations/   D1 SQL migrations (applied in order)
tests/worker/ API, permission, realtime, sharing and import tests (Workers runtime)
e2e/          Playwright journeys
public/       Manifest, icons, logos (public/brand), robots.txt, _headers
brand/source/ Original club logo files; `npm run brand` regenerates logos, app icons and favicon from them
docs/         Architecture and security notes
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SECURITY.md](docs/SECURITY.md).

## Run it on your computer

You need **Node.js 20.19+ (22 recommended)** and **npm**.

```bash
npm install
npm run setup:local   # creates .dev.vars with safe local values and sets up a local D1 database
npm run dev           # http://localhost:5173
```

Local development needs no Cloudflare, Resend or Google accounts:

- **Email:** `EMAIL_PROVIDER=console` prints emails in the terminal. Verification and reset links are also available at `http://localhost:5173/api/dev/outbox?to=you@example.com`. (This mailbox is disabled whenever `APP_ENV=production` or a real provider is used.)
- **Turnstile:** Cloudflare's official *testing* keys, which always pass.
- **Books:** Open Library (no key needed).

To start fresh, delete `.wrangler/state` and run `npm run db:migrate:local` again.

## Put it online (Cloudflare production setup)

You need a free Cloudflare account. Do these steps once, from the project folder.

1. **Log in:** `npx wrangler login`
2. **Create the database:**
   ```bash
   npx wrangler d1 create teel-ridge-book-club
   ```
   Copy the printed `database_id` into `wrangler.jsonc` → `d1_databases[0].database_id` (replace `REPLACE_WITH_YOUR_D1_DATABASE_ID`). You can also find it later in the dashboard: **Storage & Databases → D1 → teel-ridge-book-club**.
3. **Create the tables:** `npm run db:migrate:remote`
4. **Set the public values** in `wrangler.jsonc` → `vars`:
   - `PUBLIC_APP_URL` — the exact HTTPS address members will use, no trailing slash (e.g. `https://books.example.com`, or `https://bookclub-teelridge.<your-subdomain>.workers.dev` if you skip a custom domain).
   - `EMAIL_FROM` — e.g. `Teel Ridge Book Club <books@example.com>` on a domain verified in Resend (see below).
   - `TURNSTILE_SITE_KEY` — from the Turnstile widget (see below).
5. **Set the secrets** (you'll be prompted to paste each value; they never go into git):
   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET     # a long random string, e.g. output of: openssl rand -base64 32
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler secret put GOOGLE_BOOKS_API_KEY   # optional
   ```
   Secrets can also be managed in the dashboard: **Workers & Pages → bookclub-teelridge → Settings → Variables and Secrets**.
6. **Deploy:** `npm run deploy`

The Durable Object (`ClubRealtime`) is created automatically on first deploy from the `durable_objects` and `migrations` blocks in `wrangler.jsonc` — there is no ID to copy. It uses the SQLite storage backend, which is available on the Workers Free plan. A daily Cron Trigger (`triggers.crons`) cleans up expired sessions and old rate-limit counters.

> **Important:** never change `BETTER_AUTH_SECRET` casually — doing so signs everyone out and invalidates outstanding email links.

## Automatic deploys from GitHub

Keep the GitHub repository **private**. Two options — use one, not both.

### Option A (recommended): Cloudflare Workers Builds

1. Complete the one-time setup above (database, secrets, first deploy).
2. Dashboard → **Workers & Pages → bookclub-teelridge → Settings → Builds → Connect** and pick this repository and the `main` branch.
3. Build settings:
   - **Build command:** `npm run build`
   - **Deploy command:** `npm run db:migrate:remote && npx wrangler deploy`
4. **Give the build token D1 access.** The automatically created build token can deploy Workers but has no D1 permission, so the migration step would fail. In **My Profile → API Tokens**, edit the Workers Builds token and add **Account → D1 → Edit**. (Alternatively, keep the deploy command as `npx wrangler deploy` and run `npm run db:migrate:remote` yourself whenever a new migration is added.)

Every push to `main` now builds, migrates and deploys. The GitHub Actions workflow in `.github/workflows/ci.yml` runs lint, type checks, unit/API tests, a build and the end-to-end suite on every pull request.

### Option B: GitHub Actions

`.github/workflows/deploy.yml` deploys on pushes to `main` **only** when the repository variable `DEPLOY_WITH_GITHUB_ACTIONS` is `true`. Add repository secrets `CLOUDFLARE_API_TOKEN` (a token with *Workers Scripts: Edit*, *D1: Edit*, and *Workers Routes: Edit* if you use a custom domain) and `CLOUDFLARE_ACCOUNT_ID`.

## Custom domain and HTTPS

1. Add your domain to Cloudflare (free plan) and point the registrar's nameservers at Cloudflare.
2. In `wrangler.jsonc`, uncomment and edit:
   ```jsonc
   "routes": [{ "pattern": "books.example.com", "custom_domain": true }]
   ```
   or use the dashboard: **Worker → Settings → Domains & Routes → Add → Custom domain**.
3. Set `PUBLIC_APP_URL` to `https://books.example.com` and redeploy.

Cloudflare issues and renews the TLS certificate automatically. In production, cookies are `Secure` and the Worker sends `Strict-Transport-Security`. Also turn on **SSL/TLS → Edge Certificates → Always Use HTTPS** for the zone.

`PUBLIC_APP_URL` must match the address people actually use: it is the only trusted origin for sign-in, it is used in email links and share links, and it is checked for WebSocket and CSRF origin validation.

## Email with Resend

The free tier (currently 3,000 emails/month, 100/day) is plenty for a club.

1. Create an account at resend.com.
2. **Domains → Add Domain** (a subdomain such as `mail.example.com` is fine). Add the DNS records Resend shows (SPF/DKIM `TXT` and the bounce `MX`) — if the domain is on Cloudflare DNS, add them under **DNS → Records** with the proxy **off** (grey cloud). Wait until Resend shows **Verified**.
3. **API Keys → Create** with *Sending access*, ideally restricted to that domain. Store it: `npx wrangler secret put RESEND_API_KEY`.
4. Set `EMAIL_FROM` in `wrangler.jsonc` to an address on the verified domain.

Emails sent: verification, change-of-email confirmation, password reset, password-changed notice, and optional (off by default) club update / recommendation emails that members enable in **Settings → Notifications**. The provider lives behind `EmailProvider` in `worker/email/`, so switching providers means adding one small class.

## Bot protection with Turnstile

1. Dashboard → **Turnstile → Add widget**. Name it, add your hostname(s) (your custom domain and/or `*.workers.dev` address; add `localhost` only to a separate testing widget), and choose **Managed** mode.
2. Put the **site key** in `wrangler.jsonc` → `TURNSTILE_SITE_KEY` (site keys are public by design).
3. Store the **secret key**: `npx wrangler secret put TURNSTILE_SECRET_KEY`.

Turnstile is required on registration, sign-in (email and username), password-reset requests, verification-email resends, and public share-link creation. Tokens are verified server-side against Cloudflare's siteverify API; any failure is treated as a failed check.

## Book search (Open Library / Google Books)

- **Without configuration** the app uses **Open Library** (free, no key).
- **Optional Google Books:** in Google Cloud Console create a project, enable the **Books API**, create an **API key**, restrict it to the Books API, then `npx wrangler secret put GOOGLE_BOOKS_API_KEY`. Google Books is then tried first.
- **Fallback behaviour:** if Google Books fails (quota, outage), the Worker automatically falls back to Open Library. If both are unavailable, searching the club's own catalogue still works and the UI offers **Add a book manually**.
- Adding a catalogue result re-fetches its details on the server; the browser never supplies trusted metadata. Editions are de-duplicated by ISBN-13, then provider IDs.

## Configuration reference

| Name | Where | Required | Purpose |
| --- | --- | --- | --- |
| `APP_ENV` | var | yes | `production`, `development` or `test`. Production disables dev-only features. |
| `APP_NAME` | var | yes | Display name used in emails. |
| `PUBLIC_APP_URL` | var | yes | Public HTTPS origin, no trailing slash (Better Auth base URL). |
| `EMAIL_PROVIDER` | var | yes | `resend` (production) or `console` (local only). |
| `EMAIL_FROM` | var | yes | Sender on a Resend-verified domain. |
| `TURNSTILE_SITE_KEY` | var | yes | Public Turnstile site key. |
| `PASSWORD_HASH_ITERATIONS` | var | no | PBKDF2 iterations for new hashes, 10,000–100,000 (default 100,000). |
| `BETTER_AUTH_SECRET` | secret | yes | Signs sessions and email tokens. Long and random. |
| `RESEND_API_KEY` | secret | production | Resend API key. |
| `TURNSTILE_SECRET_KEY` | secret | yes | Turnstile secret key. |
| `GOOGLE_BOOKS_API_KEY` | secret | no | Enables Google Books; Open Library is the fallback. |

Bindings (in `wrangler.jsonc`): `DB` (D1), `REALTIME` (Durable Object), `ASSETS` (static files). Local values go in `.dev.vars` (see `.dev.vars.example`; never commit it).

## Database migrations

- Migrations are plain SQL files in `migrations/`, applied in filename order and tracked by Wrangler.
- Create one: `npm run db:migration:new -- short_description`, edit the new file, then `npm run db:migrate:local` to try it.
- Apply to production: `npm run db:migrate:remote` (or automatically via the Workers Builds deploy command).
- Check status: `npm run db:migrations:list`.
- Never edit a migration that has already been applied to production — add a new one.

Backups: D1 includes **Time Travel** (point-in-time restore for the last 7 days on the Free plan): `npx wrangler d1 time-travel info teel-ridge-book-club`. For an extra copy: `npx wrangler d1 export teel-ridge-book-club --remote --output backup.sql`.

## Testing

```bash
npm run lint          # ESLint
npm run typecheck     # TypeScript (app, worker, tooling)
npm run test:unit     # Vitest + React Testing Library (components, schemas, ISBN, Goodreads importer)
npm run test:worker   # API tests inside the Workers runtime with a real local D1 database
npm run test:e2e      # Playwright (starts the dev server; run npm run setup:local first)
npm test              # unit + worker
```

The Worker suite covers registration rules, email verification, username/email sign-in, cookie flags, password-reset session revocation and hashed tokens, rate limiting, CSRF/origin checks, ownership rules for every kind of personal data, visibility filtering, shared-data concurrency conflicts and reordering, realtime delivery only to conversation participants, cross-origin WebSocket rejection, share-link privacy/expiry/revocation, catalogue fallback, and Goodreads import.

The end-to-end suite registers and verifies a member through the UI, adds and shelves a book, reviews it, adds it to the club list, exchanges realtime messages with a second member in another browser, creates a public share link and checks what anonymous visitors can and cannot reach, runs a password reset that signs out the old session, and checks the mobile layout and manifest. It stubs only the Turnstile *browser widget* (so tests don't depend on loading Cloudflare's script); the Worker still verifies the token against Cloudflare using the testing secret.

## Security and privacy model

Summary (details in [docs/SECURITY.md](docs/SECURITY.md)):

- **Every private API route requires a valid session for a verified account**, enforced in the Worker. Hidden buttons are never the protection.
- Personal records are only changeable by their owner (ownership is part of every `UPDATE`/`DELETE`); other members only ever see items marked *Club*; personal notes are never sent to anyone but their owner.
- Shared club records are editable by all members, with version-based conflict detection and `created_by`/`updated_by` audit fields.
- Direct conversations are readable only by their two participants; realtime events go only to the users the Worker authorised.
- Share links use 256-bit random tokens; only a SHA-256 hash is stored. The share system has no message/chat type (enforced by the API schema *and* a database `CHECK` constraint).
- Passwords are hashed (PBKDF2-SHA256, per-user salt); reset and verification identifiers are stored hashed; secrets live only in Worker secrets.
- `robots.txt`, `<meta name="robots">` and `X-Robots-Tag` ask search engines not to index the app — this is a preference, **not** access control.

## Free-tier notes and limits

- **Workers Free:** 100,000 requests/day, **10 ms CPU per request**. Normal requests use far less. Password hashing is the heaviest operation (~10–20 ms for 100,000 PBKDF2 iterations). Cloudflare allows occasional overruns, which suits infrequent sign-ins; if you ever see **error 1102** on sign-in or registration, lower `PASSWORD_HASH_ITERATIONS` (e.g. to `50000`) and redeploy. Existing passwords keep working because each hash records its own iteration count.
- **D1 Free:** 5 GB storage and generous daily read/write allowances — far beyond a book club's needs. Profile photos are resized in the browser to ~256 px before upload and stored in D1.
- **Durable Objects Free:** SQLite-backed Durable Objects are included; the app uses a single instance with hibernating WebSockets.
- **Resend Free:** ~100 emails/day. Club update emails are opt-in to stay well within this.
- **Turnstile:** free.
- **Open Library:** free, no key. Please keep request volumes modest (the Worker identifies itself with a User-Agent that includes your app URL).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "The anti-spam check failed" | Check `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` belong to the same widget and the widget's hostnames include your domain. |
| No verification emails | Check the Resend domain is *Verified*, `EMAIL_FROM` uses it, and `RESEND_API_KEY` is set. See **Worker → Logs** for "Resend rejected the email". |
| Sign-in works but you're immediately signed out, or "Invalid origin" | `PUBLIC_APP_URL` must exactly match the address in the browser (scheme + host, no trailing slash). |
| Error 1102 on sign-in | See *Free-tier notes* — lower `PASSWORD_HASH_ITERATIONS`. |
| Workers Builds fails at the migration step | Add *D1: Edit* to the build token, or migrate manually and use `npx wrangler deploy` as the deploy command. |
| Chat says "Reconnecting…" | Usually a network change; it reconnects automatically. Messages are saved regardless and reload when the connection returns. |
| Book search shows "services are unavailable" | Open Library/Google Books is down or rate-limited. Try later or add the book manually. |
| Local dev: "no such table" | Run `npm run db:migrate:local`. |
