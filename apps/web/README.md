# apps/web

The Next.js client. Currently only the marketing landing page (route group
`app/(marketing)`); the authenticated customer and admin areas arrive in later phases.

## Structure

```
app/(marketing)/       landing page: layout, page
components/brand/      logo (placeholder mark)
components/marketing/  one component per section, plus header, footer, mobile nav
components/motion/     Reveal: scroll-reveal wrapper (client)
components/ui/         Button / ButtonLink
lib/site.ts            brand name, nav, CTA labels. The ONLY place the brand name lives
lib/cn.ts              class merge helper
app/globals.css        design tokens (colours, radius, easing, fonts)
e2e/                   Playwright + axe (AT-22)
scripts/               import-boundary check for the marketing route group
```

## Rules for this app

- The marketing route group imports nothing from the API client, money modules or the
  authenticated app. `npm run check:boundaries` enforces it.
- The browser never computes an authoritative balance or trade state. Amounts shown on the
  landing page are illustrative strings.
- Motion is isolated in `"use client"` leaves and always honours `prefers-reduced-motion`.
- One accent colour, one radius system, one font family. Tokens live in `globals.css`.

## Commands

Run from the repository root with `-w web`, or from this directory without it.

```bash
npm run dev -w web
npm run build -w web && npm run start -w web
npm run lint -w web
npm run typecheck -w web
npm run check:boundaries -w web
npm exec -w web -- playwright install chromium   # once
npm run test:e2e -w web                          # runs against `next start` of the last build
```

If the Chromium download fails (flaky network), run the suite against an installed
browser instead:

```bash
PW_BROWSER_CHANNEL=chrome npm run test:e2e -w web
```

## Placeholders to replace before launch

- Brand name and mark: `lib/site.ts`, `components/brand/logo.tsx`
- Photograph in the Safety section (`components/marketing/safety.tsx`), currently a
  grayscale picsum.photos placeholder; also remove that host from `next.config.ts`
- `/terms`, `/privacy`, `/login`, `/register` routes do not exist yet
