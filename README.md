# Chapterr

**Your club, one shelf.** Chapterr is a calm home for book clubs: the shelf, the schedule, the conversation — for every club you're in.

- Marketing site: **https://chapterr.io** (source in `site/`)
- The app (installable PWA): **https://app.chapterr.io** (source in `src/` + `worker/`)

Everything runs on Cloudflare (Workers, D1, Durable Objects) with email via Resend and bot protection via Turnstile. One account can create and join many clubs; each club is fully independent. Clubs are **free during the beta**; the plan is $1 per club per month afterwards (billing is not wired in yet — see "Billing" below).

## What the app does

**Accounts** — register with username, display name, email and password (+ Turnstile check); email verification before first sign-in; sign in with email or username; 30-day secure sessions; password reset signs out every device; change profile/photo/username/email/password; see and sign out other devices; export or delete your account.

**Clubs** — create a club (you become its *owner*), invite people with an expiring invite link/code, join with a code, switch between your clubs from the sidebar. Roles: owner (billing, delete, transfer), admin (members and invites), member. Members can leave; owners transfer first. Deleting a club archives it immediately and purges its data after 30 days. There is no public directory: nobody can find or join a club without an invite.

**Inside each club (independent per club)** — an annual reading list with ordering, status and a club goal; reading assignments (book, due date, scope, linked meeting); meetings and other activities; a club genre/tag list; club-wide chat and one-to-one direct messages (realtime, never shareable); recommendations to one member or the whole club; a reviews and quotes feed from the club's members; a members page with roles. Shared records use version-based conflict detection and keep `created_by` / `updated_by`.

**Personal (travels with you across clubs)** — your library (To be read / Reading / Finished / Did not finish, dates, progress, private notes), reviews with a five-state feeling and spoiler flag, quotations, an annual reading goal, Goodreads CSV import. Each item is *Only me* or *Club*; *Club* items are visible to members of any club you share with the viewer.

**Books** — a shared catalogue stored per edition (ISBN-13 preferred), searched across the catalogue plus Open Library (or Google Books with a key); manual entry; one-tap "Add to library" from search results; retailer *search* links built from the ISBN (no scraping).

**Sharing** — public links for one review, one quote, one of your lists, or a club's annual list; links expire or can be revoked. Chats can never be shared.

**PWA** — installable on phones, tablets and desktops ("Install app" button with per-platform instructions), offline app shell, update prompt. Private API data is never cached by the service worker.

## How it is built

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod, Tailwind CSS v4 with Chapterr design tokens (Fraunces + Inter), Lucide icons |
| API | Cloudflare Workers, Hono, Zod validation, Better Auth (email/password + username) on D1 |
| Data | Cloudflare D1 (SQLite) with committed migrations in `migrations/` |
| Realtime | One Durable Object per club with hibernating WebSockets; D1 is the source of truth |
| Email | Resend behind a small adapter (`worker/email/`), console provider for local development |
| Bots / abuse | Cloudflare Turnstile (verified server-side), per-user/per-IP/per-club rate limits in D1 |
| Site | Static HTML/CSS in `site/public`, deployed as an assets-only Worker |
| Tests | Vitest + React Testing Library, `@cloudflare/vitest-pool-workers` API tests on a real local D1, Playwright end-to-end |

```
worker/        Hono API, auth, email, realtime Durable Object, providers (Open Library / Google Books)
src/           React PWA
shared/        Types, Zod schemas, constants shared by both
migrations/    D1 schema
site/          Marketing site (chapterr.io)
brand/         Chapterr brand sources (SVG); `npm run brand` renders icons, PNGs and the OG image
docs/          API contract (docs/API.md), architecture, security model
```

## Run it on your computer

You need **Node.js 22** and **npm**.

```bash
npm install
npm run setup:local   # .dev.vars with safe local values + local D1 tables
npm run dev           # http://localhost:5173
```

Local development needs no Cloudflare, Resend or Google accounts: emails print to the terminal and are readable at `http://localhost:5173/api/dev/outbox?to=you@example.com`; Turnstile uses Cloudflare's always-pass testing keys; book search uses Open Library. To start fresh, delete `.wrangler/state` and run `npm run db:migrate:local`.

Preview the marketing site: `npx wrangler dev -c site/wrangler.jsonc --port 8788`.

## Production (already set up)

Both Workers deploy from this repository:

```bash
npm run build && npx wrangler deploy              # app → app.chapterr.io
npx wrangler deploy -c site/wrangler.jsonc        # site → chapterr.io and www.chapterr.io
npm run db:migrate:remote                         # apply new migrations to the chapterr D1 database
```

What exists in the Cloudflare account:

| Thing | Name |
| --- | --- |
| App Worker | `chapterr-app`, custom domain `app.chapterr.io`, Smart Placement on |
| Site Worker | `chapterr-site`, custom domains `chapterr.io` and `www.chapterr.io` |
| D1 database | `chapterr` (id in `wrangler.jsonc`) |
| Turnstile widget | "Chapterr" (hostnames `app.chapterr.io`, `chapterr.io`; site key in `wrangler.jsonc`) |
| Secrets on `chapterr-app` | `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY` (optional `GOOGLE_BOOKS_API_KEY`) |
| Resend domain | `mail.chapterr.io` (sender `hello@mail.chapterr.io`; DNS records live in the `chapterr.io` zone) |
| Zone settings | Always Use HTTPS on, minimum TLS 1.2; the Worker also redirects http→https and sends HSTS |

To rotate a secret: `npx wrangler secret put NAME --name chapterr-app`. Never change `BETTER_AUTH_SECRET` casually — it signs everyone out and voids outstanding email links.

### Automatic deploys

`.github/workflows/ci.yml` runs lint, typecheck and tests on every push. `.github/workflows/deploy.yml` deploys both Workers on pushes to `main` when the repository variable `DEPLOY_WITH_GITHUB_ACTIONS` is `true` (secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). Alternatively connect the repo in **Workers & Pages → chapterr-app → Settings → Builds** with build command `npm ci && npm run build` and deploy command `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`.

## Billing (not enabled yet)

Every club is created on the `beta_free` plan and the app shows "Free during beta — $1 per club per month after beta". `GET /api/config` returns `billingEnabled: false`. When you are ready to charge, the pieces to add are: a Stripe (or similar) Checkout per club, a webhook that sets `clubs.plan = 'standard'` and `billing_status`, and the gate in `worker/lib/club.ts` that limits what a `past_due`/`canceled` club can do. The `clubs` table already carries `plan`, `billing_status` and `member_limit`.

## Configuration reference

| Name | Where | Purpose |
| --- | --- | --- |
| `APP_ENV` | var | `production`, `development` or `test` |
| `APP_NAME` | var | Display name used in emails (`Chapterr`) |
| `PUBLIC_APP_URL` | var | `https://app.chapterr.io` (Better Auth base URL; no trailing slash) |
| `MARKETING_URL` | var | `https://chapterr.io` |
| `EMAIL_PROVIDER` / `EMAIL_FROM` | var | `resend` + a sender on the verified Resend domain |
| `TURNSTILE_SITE_KEY` | var | Public Turnstile site key |
| `PASSWORD_HASH_ITERATIONS` | var | PBKDF2 iterations for new hashes (default 100,000) |
| `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `GOOGLE_BOOKS_API_KEY` | secret | Set with `wrangler secret put` |

Bindings: `DB` (D1), `REALTIME` (Durable Object `ClubRealtime`), `ASSETS` (static files). Local values live in `.dev.vars` (never committed).

## Database migrations

SQL files in `migrations/`, applied in order and tracked by Wrangler. New migration: `npm run db:migration:new -- short_description`, then `npm run db:migrate:local` to try it and `npm run db:migrate:remote` to ship it. Never edit a migration that has reached production. Backups: D1 Time Travel (`npx wrangler d1 time-travel info chapterr`) and `npx wrangler d1 export chapterr --remote --output backup.sql`.

## Testing

```bash
npm run lint && npm run typecheck
npm run test:unit     # components, schemas, ISBN, Goodreads parser
npm run test:worker   # API inside the Workers runtime on a real local D1 (auth, clubs, isolation, messaging, shares…)
npm run test:e2e      # Playwright: register → create club → invite → second member joins → list, chat, share
```

## Security and privacy model

See [docs/SECURITY.md](docs/SECURITY.md). In short: every private route requires a verified session; every club route also requires membership of that club (loaded once per request, `worker/lib/club.ts`); club data is filtered by `club_id` in SQL; personal data is only changeable by its owner and only visible to people who share a club with them (if marked *Club*); chats are readable only by their participants and have no share type (API schema + database `CHECK`); share tokens are stored hashed; passwords use PBKDF2-SHA256; secrets live only in Worker secrets; `noindex` is a preference, never access control.

## Scale and free-tier notes

- Per-club Durable Objects keep chat fan-out proportional to a club's size (member limit 200 per club, 20 clubs per account, 10 owned).
- Lists are cursor-paginated; every club index leads with `club_id`; the Worker runs next to D1 (Smart Placement).
- Workers Free is 100k requests/day and 10 ms CPU/request; upgrade to Workers Paid ($5/mo) before any real launch — it also lifts D1 and Durable Object limits.
- Resend Free is ~100 emails/day (3,000/month). Verification and reset emails alone will exceed this with real sign-up volume; move to a paid Resend plan when needed. Club update emails are opt-in.
- Open Library is free and keyless; add `GOOGLE_BOOKS_API_KEY` for better metadata.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "The anti-spam check failed" | `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` must belong to the same widget, and the widget's hostnames must include `app.chapterr.io`. |
| No emails arrive | Check the Resend domain is *verified* and `EMAIL_FROM` uses that domain; look at **Resend → Logs**. |
| "Someone else changed this" | Expected: two members edited the same club record; the latest copy is shown — reapply your change. |
| Error 1102 on sign-in | CPU limit: lower `PASSWORD_HASH_ITERATIONS` or move to Workers Paid. |
