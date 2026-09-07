# apps/web

The Next.js client. Currently only the marketing landing page (route group
`app/(marketing)`); the authenticated customer and admin areas arrive in later phases.

## Structure

```
app/(marketing)/       landing page: layout, page
components/brand/      wordmark (placeholder)
components/marketing/  one component per section, plus header, footer, mobile nav
components/motion/     gsap.ts (single plugin registration), Reveal (scroll reveal)
components/three/      the escrow vault scene (react-three-fiber), lazy-loaded
components/ui/         Button / ButtonLink, StatusPill
lib/site.ts            brand name, nav, CTA labels. The ONLY place the brand name lives
lib/cn.ts              class merge helper
app/globals.css        design tokens ("Quiet Capital" kit: colours, radius, easing, fonts)
e2e/                   Playwright + axe (AT-22)
scripts/               import-boundary check for the marketing route group
```

## Design system

- Palette: Canvas `#F6F4EE`, Surface `#FFFFFF`, Forest `#183D32`, Ink `#202622`, Sage `#ADB9A9`,
  Border `#DADFD6`. Forest is the only accent. One light theme.
- Type: IBM Plex Sans throughout (display and body, separated by weight and tracking, not by a
  second family), IBM Plex Mono for ledger figures.
- Radius: 6px controls, 8px surfaces. Fine borders, minimal shadow, except buttons, which carry a
  resting shadow and lift on hover.
- Motion: GSAP (ScrollTrigger, SplitText) for the DOM, three.js via react-three-fiber for the
  hero. No other animation library. Every animation is gated on `prefers-reduced-motion`, and
  nothing pins, scrubs or snaps the scroll.
- The 3D hero never mounts below 1024px, so mobile downloads no three.js at all.

## Rules for this app

- The marketing route group imports nothing from the API client, money modules or the
  authenticated app. `npm run check:boundaries` enforces it.
- The browser never computes an authoritative balance or trade state. Amounts shown on the
  landing page are illustrative strings driven by GSAP.
- three.js loads only in the browser, after first paint, and never fetches from a CDN (the
  studio lighting is built from light panels, not a downloaded HDRI).

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

- Brand name and wordmark: `lib/site.ts`
- `/terms`, `/privacy`, `/login`, `/register` routes do not exist yet
