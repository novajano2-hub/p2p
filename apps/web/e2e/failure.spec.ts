import { expect, test } from "@playwright/test";

import {
  ADVERTISER,
  adminSignedIn,
  apiError,
  expectNoHorizontalOverflow,
  ok,
  signedIn,
  stubApi,
  stubSocket,
  toastSaying,
  TRADE,
  unreachable,
  USER,
  withSession,
} from "./support";

/*
  Failure has a home (Phase 5, stage 3). A session that ends mid-task comes
  back to the task; something that is not there is the not-found page, not a
  sentence in a panel; a load that failed can be tried again; offline and a
  live connection that is down are said, quietly; an order that moved on
  while the page was open says what it is now; and an administrator is asked
  whether they are still there before the session runs out.
*/

/** The order page's own reads, for a trade as the stub has it. */
const orderReads = (trade: () => object) => [
  { method: "GET" as const, path: /^\/v1\/trades\/t1$/, reply: () => ok(trade()) },
  { method: "GET" as const, path: /^\/v1\/trades\/t1\/events$/, reply: () => ok({ events: [] }) },
  {
    method: "GET" as const,
    path: /^\/v1\/trades\/t1\/messages$/,
    reply: () =>
      ok({ messages: [], lastSeq: 0, myLastReadSeq: 0, theirLastReadSeq: 0, open: true }),
  },
];

/** 100 USDT at 158.50 birr, as the marketplace lists it. */
const OFFER = {
  id: "o1",
  side: "SELL",
  priceSantim: "15850",
  available: "100000000",
  minSantim: "1000",
  maxSantim: "2000000",
  paymentWindowMinutes: 30,
  paymentKinds: ["TELEBIRR"],
  terms: null,
  requireVerified: false,
  minCompletedTrades: 0,
  advertiser: ADVERTISER,
  revision: 1,
  isMine: false,
  blockedBecause: null,
};

test.describe("a session that ends", () => {
  test("in the middle of an order comes back to the order", async ({ page, context }) => {
    await withSession(context);
    let signedInAgain = false;
    await stubApi(page, [
      ...signedIn(),
      ...orderReads(() => TRADE),
      // The session ended while the page was open.
      {
        method: "POST",
        path: /^\/v1\/trades\/t1\/paid$/,
        reply: () => apiError("UNAUTHENTICATED", "Sign in to continue.", 401),
      },
      { method: "POST", path: /^\/v1\/auth\/logout$/, reply: () => ({ status: 204 }) },
      { method: "POST", path: /^\/v1\/auth\/login$/, reply: () => ok({ ticket: "a-ticket" }) },
      {
        method: "POST",
        path: /^\/v1\/auth\/login\/verify$/,
        reply: () => {
          signedInAgain = true;
          return ok({ user: USER });
        },
      },
    ]);

    await page.goto("/orders/t1");
    await page.getByRole("button", { name: "I have paid" }).click();
    await page.getByRole("button", { name: "Yes, I have paid" }).click();

    // Not "Sign in to continue." on the order: sent to log in, with the way back.
    await expect(page).toHaveURL(/\/login\?next=%2Forders%2Ft1&why=ended$/);
    await expect(page.getByText("Your session ended.")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByLabel("Email").fill(USER.email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Password", { exact: true }).fill("Correct1Horse");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByLabel(/digit 1 of 6/).fill("123456");

    await expect(page).toHaveURL(/\/orders\/t1$/);
    expect(signedInAgain).toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Buy");
  });

  test("a link opened while signed out asks for a log-in on the way", async ({ page }) => {
    await page.goto("/orders/t1?tab=chat");
    await expect(page).toHaveURL(/\/login\?next=%2Forders%2Ft1%3Ftab%3Dchat$/);
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
  });

  test("ended by the live connection goes the same way", async ({ page, context }) => {
    await withSession(context);
    const socket = await stubSocket(page);
    await stubApi(page, [
      ...signedIn(),
      { method: "POST", path: /^\/v1\/auth\/logout$/, reply: () => ({ status: 204 }) },
    ]);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await (await socket.connected).close(4001, "session ended");

    await expect(page).toHaveURL(/\/login\?next=%2Fsettings&why=ended$/);
  });
});

test.describe("something that is not there", () => {
  test("an order that is not yours is the not-found page, inside the app", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/trades\/t404$/,
        reply: () => apiError("NOT_FOUND", "There is no such trade.", 404),
      },
      { method: "GET", path: /^\/v1\/trades$/, reply: () => ok({ trades: [], nextCursor: null }) },
    ]);

    await page.goto("/orders/t404");
    await expect(
      page.getByRole("heading", { level: 1, name: "This order is not here" }),
    ).toBeVisible();
    await expect(page.getByText("It does not exist, or it is not one of yours.")).toBeVisible();
    // Still inside the app: its header is there, and the way back leads to the list.
    await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Your orders" })).toHaveAttribute(
      "href",
      "/orders",
    );
    await expectNoHorizontalOverflow(page);

    // The tab says it too, over the order page's own title - and has that
    // title back once the page is left.
    await expect(page).toHaveTitle("Order not found | BIRQ");
    await page.getByRole("link", { name: "Your orders" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
    await expect(page).toHaveTitle("Orders | BIRQ");
  });

  test("an address that matches nothing has its own page", async ({ page }) => {
    await page.goto("/there-is-no-such-page");
    await expect(
      page.getByRole("heading", { level: 1, name: "This page does not exist" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page).toHaveTitle("Page not found | BIRQ");
    await expectNoHorizontalOverflow(page);
  });

  test("an admin page for something that is not there keeps the admin bar", async ({ page }) => {
    await stubApi(page, [
      ...adminSignedIn(),
      {
        method: "GET",
        path: /^\/v1\/admin\/withdrawals\/w404$/,
        reply: () => apiError("NOT_FOUND", "There is no such withdrawal.", 404),
      },
    ]);

    await page.goto("/admin/withdrawals/w404");
    await expect(page.getByRole("heading", { level: 1, name: "No such withdrawal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Withdrawals" }).last()).toHaveAttribute(
      "href",
      "/admin/withdrawals",
    );
    await expect(page).toHaveTitle("Withdrawal not found | BIRQ administration");
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("a load that failed", () => {
  test("can be tried again", async ({ page, context }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/offers$/,
        reply: (_route, calls) =>
          calls === 1
            ? apiError("INTERNAL", "Something went wrong.", 500)
            : ok({ offers: [OFFER], nextCursor: null }),
      },
    ]);

    await page.goto("/trade");
    const failed = page.getByRole("alert").filter({ hasText: "Something went wrong on our side." });
    await expect(failed).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText(ADVERTISER.username).first()).toBeVisible();
    await expect(failed).toBeHidden();
  });
});

test.describe("the connection", () => {
  test("offline is said at once, and a form sent offline says it did not go", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      { method: "GET", path: /^\/v1\/payment-methods$/, reply: () => ok({ paymentMethods: [] }) },
      // Offline: the request never reaches anything.
      { method: "POST", path: /^\/v1\/payment-methods$/, reply: unreachable },
    ]);

    await page.goto("/trade/payment-methods");
    await expect(page.getByRole("heading", { level: 1, name: "Payment methods" })).toBeVisible();
    await context.setOffline(true);

    const offline = page.getByRole("status").filter({ hasText: "You are offline." });
    await expect(offline).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Add a payment method" }).click();
    await page.getByLabel("Name on the account").fill("Abebe Bikila");
    await page.getByLabel("Telebirr phone number").fill("0912345678");
    await page.getByRole("button", { name: "Add payment method" }).click();
    await expect(toastSaying(page, "We could not reach the server.")).toBeVisible();

    await context.setOffline(false);
    await expect(offline).toBeHidden();
  });

  test("a live connection that stays down is said quietly, and goes when it is back", async ({
    page,
    context,
  }) => {
    await withSession(context);
    const socket = await stubSocket(page);
    await stubApi(page, [...signedIn()]);

    await page.goto("/settings");
    const live = await socket.connected;
    // Down, and it stays down: every attempt to come back is turned away.
    socket.refuse(true);
    await live.close(1001, "going away");

    const reconnecting = page.getByRole("status").filter({ hasText: "Reconnecting." });
    await expect(reconnecting).toBeVisible({ timeout: 10_000 });
    await expectNoHorizontalOverflow(page);

    socket.refuse(false);
    await expect(reconnecting).toBeHidden({ timeout: 15_000 });
  });

  test("a tab stood down for being one too many says so, and offers a reload", async ({
    page,
    context,
  }) => {
    await withSession(context);
    const socket = await stubSocket(page);
    await stubApi(page, [...signedIn()]);

    await page.goto("/settings");
    await (await socket.connected).close(4002, "too many connections");

    const paused = page.getByRole("status").filter({ hasText: "too many tabs" });
    await expect(paused).toBeVisible();
    await expect(paused.getByRole("button", { name: "Reload this tab" })).toBeVisible();
    // Nothing about the session is wrong: the tab stays where it is.
    await expect(page).toHaveURL(/\/settings$/);
  });
});

test.describe("an order that moved on while it was open", () => {
  test("says what it is now, instead of the refusal", async ({ page, context }) => {
    await withSession(context);
    const expired = {
      ...TRADE,
      status: "EXPIRED",
      closedAt: "2026-09-17T09:31:00.000Z",
      payment: { ...TRADE.payment, instructions: null },
      actions: { ...TRADE.actions, canMarkPaid: false, canCancel: false, canChat: false },
    };
    await stubApi(page, [
      ...signedIn(),
      // First, so it answers before the plain reads below: the order, then the order moved on.
      {
        method: "GET",
        path: /^\/v1\/trades\/t1$/,
        reply: (_route, calls) => ok(calls === 1 ? TRADE : expired),
      },
      ...orderReads(() => TRADE),
      {
        method: "POST",
        path: /^\/v1\/trades\/t1\/paid$/,
        reply: () =>
          apiError(
            "CONFLICT",
            "This trade has moved on since you last looked, so that cannot be done now.",
            409,
          ),
      },
    ]);

    await page.goto("/orders/t1");
    await page.getByRole("button", { name: "I have paid" }).click();
    await page.getByRole("button", { name: "Yes, I have paid" }).click();

    const moved = toastSaying(page, "This order moved on while you were looking");
    await expect(moved).toBeVisible();
    await expect(moved).toContainText("It is expired now.");
    // The page is the order as it is: expired, with nothing left to press.
    await expect(page.getByText("Expired").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "I have paid" })).toBeHidden();
  });
});

test.describe("an administrator's session", () => {
  test("asks whether they are still there before it runs out, and ends when it does", async ({
    page,
  }) => {
    const start = new Date("2026-09-18T09:00:00.000Z");
    await page.clock.install({ time: start });
    let asked = 0;
    const [me] = adminSignedIn({ idleMinutes: 5, now: start });
    if (!me) throw new Error("adminSignedIn answers /auth/me");
    await stubApi(page, [
      {
        ...me,
        reply: (route, calls) => {
          asked = calls;
          return me.reply(route, calls);
        },
      },
      {
        method: "GET",
        path: /^\/v1\/admin\/kyc\/queue$/,
        reply: () => ok({ submissions: [], pending: 0 }),
      },
    ]);

    await page.goto("/admin");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    // Five minutes idle, counted a minute short: asked with two minutes to go.
    await page.clock.fastForward("02:10");
    const prompt = page.getByRole("alertdialog", { name: "Still there?" });
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(/1:[45]\d/);
    await expectNoHorizontalOverflow(page);

    await prompt.getByRole("button", { name: "I am still here" }).click();
    await expect(prompt).toBeHidden();
    expect(asked).toBe(2);

    // Then nothing: the window runs out, and the next page is signing in, back to here.
    await page.clock.fastForward("04:10");
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin&why=idle$/);
    await expect(
      page.getByText("You were signed out after a long time without activity."),
    ).toBeVisible();
  });
});
