import type { BrowserContext, Page, Route } from "@playwright/test";

/*
  The API, stubbed at the network boundary, for specs that drive signed-in
  screens. auth.spec.ts says why the stub rather than the real thing; this is
  the general form of the same idea: a list of handlers, each answering a
  method and a path, each told how many times it has been asked so an answer
  can change over time - the offer that is there on the first look and gone
  on the second.
*/

export const SESSION_COOKIE = "birq_session";
export const SESSION_VALUE = "a-session-token";
/** Matches playwright.config.ts. Cookies ignore the port, so this covers the API stub too. */
export const SITE = "http://localhost:3100";

export const USER = {
  id: "0199f0b1-2c3d-7e4f-8a9b-0c1d2e3f4a5b",
  email: "samlee@gmail.com",
  platformId: "BQ-48213967",
  username: "user_48213967",
  kycStatus: "NOT_STARTED",
  status: "ACTIVE",
  emailVerified: true,
};

export type Reply = { status: number; body?: unknown };

export const ok = (body: unknown, status = 200): Reply => ({ status, body });

/** The API's error envelope, so the client parses a stubbed failure as a real one. */
export const apiError = (code: string, message: string, status: number): Reply => ({
  status,
  body: { error: { code, message, correlationId: "test" } },
});

export type Handler = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Tested against the request's pathname, e.g. /^\/v1\/offers\/o1$/. */
  path: RegExp;
  /** `calls` counts this handler's own hits, from 1. */
  reply: (route: Route, calls: number) => Reply | Promise<Reply>;
};

/*
  The client sends credentialed cross-origin requests, so the browser enforces
  CORS on every reply and preflights the ones carrying a JSON body or a custom
  header. A stub that omits these fails exactly the way a misconfigured server
  would, and every test would then be failing for the wrong reason.
*/
function corsHeaders(route: Route): Record<string, string> {
  return {
    "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type,idempotency-key,x-csrf-token",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  };
}

export async function stubApi(page: Page, handlers: Handler[]): Promise<void> {
  const hits = new Map<Handler, number>();

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders(route) });
      return;
    }

    const { pathname } = new URL(request.url());
    const handler = handlers.find(
      (candidate) =>
        (!candidate.method || candidate.method === request.method()) &&
        candidate.path.test(pathname),
    );
    let reply: Reply;
    if (handler) {
      const calls = (hits.get(handler) ?? 0) + 1;
      hits.set(handler, calls);
      reply = await handler.reply(route, calls);
    } else {
      reply = apiError("NOT_FOUND", `No stub answers ${request.method()} ${pathname}.`, 404);
    }

    const hasBody = reply.body !== undefined;
    await route.fulfill({
      status: reply.status,
      headers: {
        ...corsHeaders(route),
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(reply.body) } : {}),
    });
  });
}

/** The two calls every signed-in page makes before it does anything of its own. */
export function signedIn(user: typeof USER = USER): Handler[] {
  return [
    { method: "GET", path: /^\/v1\/auth\/me$/, reply: () => ok({ user }) },
    {
      method: "GET",
      path: /^\/v1\/notifications$/,
      reply: () => ok({ notifications: [], unreadCount: 0 }),
    },
  ];
}

/*
  Puts a session cookie in the jar, for tests that open a signed-in page
  directly instead of arriving there by signing in. Without one, middleware
  turns the request straight around to the landing page.
*/
export async function withSession(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: SESSION_COOKIE, value: SESSION_VALUE, url: SITE }]);
}
