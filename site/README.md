# Chapterr marketing site

The public site at **https://chapterr.io**. It is a standalone static site
(plain HTML, CSS and a little vanilla JavaScript; no framework, no build step)
deployed as its own assets-only Cloudflare Worker. The app itself lives at
https://app.chapterr.io and is configured by the repository's root
`wrangler.jsonc`.

## Layout

```
site/
├── wrangler.jsonc          Worker config (assets only, custom domains chapterr.io + www)
├── README.md
└── public/                 Everything in here is served as-is
    ├── index.html          Landing page
    ├── privacy.html        Privacy notice      → served at /privacy
    ├── terms.html          Terms of service    → served at /terms
    ├── 404.html            Not-found page
    ├── styles.css          All styles (brand tokens at the top)
    ├── site.js             Mobile menu, scroll reveal, header hairline
    ├── _headers            Security + caching headers (CSP, HSTS, …)
    ├── robots.txt, sitemap.xml
    ├── favicon.svg, favicon.png, og-image.png (1200×630)
    ├── icons/apple-touch-icon.png
    └── brand/              Logo files from the brand book (see below)
```

`html_handling: auto-trailing-slash` means `/privacy.html` is reachable as
`/privacy` (links on the site use the extension-less form).

## Brand assets

The pages reference these files, which come from the Chapterr brand kit and
are not generated here:

```
public/brand/logo-horizontal-color-on-light.svg   nav + footer (light mode)
public/brand/logo-horizontal-color-on-dark.svg    nav + footer (dark mode)
public/brand/logo-vertical-color-on-light.svg
public/brand/mark-color-on-light.svg
public/brand/mark-color-on-dark.svg
public/brand/wordmark-color-on-light.svg          footer (light mode)
public/brand/watermark-mark-forest.svg            pricing section corner (12% opacity, baked in)
public/brand/app-icon-rounded.svg
public/favicon.svg  public/favicon.png  public/icons/apple-touch-icon.png  public/og-image.png
```

## Preview locally

From the repository root:

```sh
npx wrangler dev -c site/wrangler.jsonc
```

Then open the URL Wrangler prints (usually http://localhost:8787). Because
there is no build step, edits to anything in `public/` show up on reload.

## Deploy

```sh
npx wrangler deploy -c site/wrangler.jsonc
```

The first deploy creates the `chapterr-site` Worker and attaches the custom
domains `chapterr.io` and `www.chapterr.io` (both zones must be on the same
Cloudflare account; Cloudflare manages the DNS records and certificates).
`workers_dev` is off, so the site is only reachable on those domains.

## Conventions

- Follow the brand book: Fraunces for display, Inter for body; Forest / Brass /
  Linen palette; one Brass accent per section; sentence case; no exclamation
  marks; buttons are verbs of at most two words.
- Dark mode follows `prefers-color-scheme` (Deep Forest ground, Forest cards,
  Linen text, Brass unchanged). Logo variants swap through `<picture>`.
- Keep JavaScript in `site.js`. The CSP in `_headers` has no `unsafe-inline`,
  so inline `<script>` or `style=""` attributes will be blocked. (JSON-LD data
  blocks are fine; they are not executed.)
- The product mockups are built in HTML/CSS and marked `aria-hidden`; the
  real content is in the surrounding copy.
