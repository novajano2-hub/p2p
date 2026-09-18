import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";

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

/** An advertiser, as every screen that names one wants them. */
export const ADVERTISER = {
  userId: "0199f0b1-2c3d-7e4f-8a9b-0c1d2e3f4a5c",
  username: "user_20482010",
  verified: true,
  tradesTotal: 14,
  tradesCompleted: 13,
  completionRate: 93,
  avgReleaseSeconds: 240,
  avgPaySeconds: 600,
};

/** An open order, carrying the terms it was taken under. */
export const TRADE = {
  id: "t1",
  offerId: "o1",
  offerSide: "SELL",
  role: "BUYER",
  status: "AWAITING_FIAT_PAYMENT",
  message: "Pay the seller, then say you have paid.",
  amount: "6309148",
  fee: "0",
  buyerReceives: "6309148",
  priceSantim: "15850",
  fiatSantim: "100000",
  counterparty: ADVERTISER,
  payment: {
    kind: "TELEBIRR",
    label: "Telebirr ····5678",
    instructions: {
      kind: "TELEBIRR",
      accountHolder: "Abebe Bikila",
      accountNumber: "0912345678",
    },
    reference: null,
  },
  terms: "No third-party payments. Send from an account in your own name.",
  paymentDeadline: "2099-01-01T00:00:00.000Z",
  paidAt: null,
  closedAt: null,
  closeReason: null,
  dispute: null,
  chat: { lastSeq: 0, unread: 0 },
  actions: {
    canMarkPaid: true,
    canCancel: true,
    canRelease: false,
    canDispute: false,
    canWithdrawDispute: false,
    canChat: true,
  },
  createdAt: "2026-09-17T09:00:00.000Z",
  updatedAt: "2026-09-17T09:00:00.000Z",
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
  The page is never wider than the viewport. A grid column that will not
  shrink below its content, a string with nowhere to break, a panel that
  escapes its column: each ends as a horizontal scrollbar on a phone, and
  each is invisible on the desktop the page was written on. Named for what
  crossed the edge, so the failure says where to look.
*/
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    /*
      The layout viewport, which is the screen. Not innerWidth: on a phone,
      Chrome zooms out to fit content that is too wide, and innerWidth grows
      with it - so a check against innerWidth passes on exactly the pages it
      exists to catch. clientWidth stays the width of the screen.
    */
    const width = document.documentElement.clientWidth;
    const across = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.right > width + 1;
      })
      .slice(0, 5)
      .map(
        (element) =>
          `<${element.tagName.toLowerCase()} class="${element.className}"> reaches ${Math.round(element.getBoundingClientRect().right)}px`,
      );
    return { width, scrollWidth: document.documentElement.scrollWidth, across };
  });
  expect(
    overflow.scrollWidth,
    `the page is ${overflow.scrollWidth}px wide in a ${overflow.width}px viewport:\n${overflow.across.join("\n")}`,
  ).toBeLessThanOrEqual(overflow.width);
}

/*
  Puts a session cookie in the jar, for tests that open a signed-in page
  directly instead of arriving there by signing in. Without one, middleware
  turns the request straight around to the landing page.
*/
export async function withSession(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: SESSION_COOKIE, value: SESSION_VALUE, url: SITE }]);
}
