import { NextResponse, type NextRequest } from "next/server";

/*
  Sends people to the side of the app they belong on, before a page is even
  rendered: a signed-in customer landing on / goes to /account, and a signed-out
  visitor asking for /account goes back to the landing page rather than looking
  at a card telling them what they already know.

  These are routing hints, not authorisation, and they deliberately only look at
  whether the cookie EXISTS. Validating it would mean a call to the API on every
  request; /account resolves the session properly and leaves for the landing
  page itself if the cookie turns out to be stale. Nothing here is what keeps
  anything private - the API refuses every request without a live session.

  The two rules are exact opposites on the same condition, so they cannot bounce
  a request between them: a cookie either exists or it does not.

  This works in development because the web app and the API share the host
  `localhost`, so the cookie reaches both. In production they are different
  hosts, and the web server only sees the cookie if COOKIE_DOMAIN is set on the
  API (see .env.example). Unset, these are no-ops rather than failures.
*/

/** Set by the API (apps/api/src/modules/auth/session.service.ts). */
const SESSION_COOKIE = "birq_session";

const LANDING = "/";
/** Where an authenticated customer belongs. Mirrors `afterAuth` in lib/site.ts. */
const APP_ENTRY = "/account";
/**
 * Every route behind a session, as prefixes. Mirrors `appRoutes` in
 * lib/app-nav.ts. Prefixes rather than exact paths because sections have
 * pages under them - /wallet/deposit belongs to whoever /wallet belongs to,
 * and a new one must not have to be added here to be protected.
 */
const APP_ROUTES = ["/account", "/trade", "/orders", "/wallet", "/settings", "/verify"];

const isAppRoute = (pathname: string): boolean =>
  APP_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));

export function proxy(request: NextRequest): NextResponse {
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  if (signedIn && pathname === LANDING) {
    return NextResponse.redirect(new URL(APP_ENTRY, request.url));
  }
  if (!signedIn && isAppRoute(pathname)) {
    return NextResponse.redirect(new URL(LANDING, request.url));
  }
  return NextResponse.next();
}

/*
  Only these. Sign-up, log-in and recovery stay reachable with a session in
  the jar: finishing a password reset, or signing in as someone else, both mean
  arriving at those pages while one is still there.

  `:path*` matches zero or more further segments, so each entry covers the
  section's own page and everything nested under it.
*/
export const config = {
  matcher: [
    "/",
    "/account/:path*",
    "/trade/:path*",
    "/orders/:path*",
    "/wallet/:path*",
    "/settings/:path*",
    "/verify/:path*",
  ],
};
