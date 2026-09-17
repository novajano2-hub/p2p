import { expect, test, type Page } from "@playwright/test";

import {
  ADVERTISER,
  apiError,
  expectNoHorizontalOverflow,
  ok,
  signedIn,
  stubApi,
  TRADE,
  USER,
  withSession,
} from "./support";

/*
  The market's screens, against a stubbed API (support.ts). What is under
  test is what the browser does with an answer: where a link goes, what a
  refusal looks like from where the person is standing, and that a new page
  starts at the top.
*/

const desktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const mobile = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/** 100 USDT at 158.50 birr, 10 to 20,000 birr a trade, paid through Telebirr. */
const offer = (side: "BUY" | "SELL", overrides: Record<string, unknown> = {}) => ({
  id: "o1",
  side,
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
  ...overrides,
});

const TELEBIRR = {
  id: "pm1",
  kind: "TELEBIRR",
  label: "Telebirr ····5678",
  hint: "5678",
  status: "ACTIVE",
  createdAt: "2026-09-17T09:00:00.000Z",
};

/*
  The screen's own alert, told apart from the router's route announcer, which is
  also role="alert" and would otherwise make the role ambiguous.
*/
const alertSaying = (page: Page, text: string | RegExp) =>
  page.getByRole("alert").filter({ hasText: text });

/** Makes the screen look at the offer again, the way a tab coming back into view does. */
const lookAgain = (page: Page) =>
  page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

test.describe("adding a payment method from the middle of something", () => {
  test("returns to the offer it was needed for", async ({ page, context }) => {
    await withSession(context);
    let added = false;
    await stubApi(page, [
      ...signedIn(),
      { method: "GET", path: /^\/v1\/offers\/o1$/, reply: () => ok(offer("BUY")) },
      {
        method: "GET",
        path: /^\/v1\/payment-methods$/,
        reply: () => ok({ paymentMethods: added ? [TELEBIRR] : [] }),
      },
      {
        method: "POST",
        path: /^\/v1\/payment-methods$/,
        reply: () => {
          added = true;
          return ok(TELEBIRR, 201);
        },
      },
    ]);

    await page.goto("/trade/offers/o1");
    await expect(
      page.getByRole("heading", { level: 1, name: `Sell USDT to ${ADVERTISER.username}` }),
    ).toBeVisible();
    // Selling to a BUY ad: Back goes to the Sell side of the market, not the default one.
    await expect(page.getByRole("link", { name: "Marketplace" })).toHaveAttribute(
      "href",
      "/trade?want=SELL",
    );

    await page.getByRole("link", { name: "Add a payment method" }).click();
    await expect(page).toHaveURL(/\/trade\/payment-methods\?next=%2Ftrade%2Foffers%2Fo1$/);
    await expect(page.getByRole("link", { name: "The offer" })).toHaveAttribute(
      "href",
      "/trade/offers/o1",
    );

    await page.getByLabel("Name on the account").fill("Abebe Bikila");
    await page.getByLabel("Telebirr phone number").fill("0912345678");
    await page.getByRole("button", { name: "Add payment method" }).click();

    // Back on the offer, with the new method there to choose.
    await expect(page).toHaveURL(/\/trade\/offers\/o1$/);
    await expect(page.getByLabel("Receive the payment to")).toContainText(TELEBIRR.label);
    await expectNoHorizontalOverflow(page);
  });

  test("does not follow a link off the site", async ({ page, context }) => {
    test.skip(!desktop(page), "one viewport is enough for a link's address");
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/payment-methods$/,
        reply: () => ok({ paymentMethods: [] }),
      },
    ]);

    for (const next of ["https://evil.example/", "//evil.example", "/\\evil.example"]) {
      await page.goto(`/trade/payment-methods?next=${encodeURIComponent(next)}`);
      await expect(page.getByRole("link", { name: "Marketplace" })).toHaveAttribute(
        "href",
        "/trade",
      );
    }
  });
});

test.describe("an ad that changes while you are looking at it", () => {
  test("says so at once, and the order button knows", async ({ page, context }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/offers\/o1$/,
        reply: (_route, calls) =>
          calls === 1
            ? ok(offer("SELL"))
            : apiError("NOT_FOUND", "That offer is not available right now.", 404),
      },
    ]);

    await page.goto("/trade/offers/o1");
    await expect(page.getByRole("button", { name: "Buy USDT" })).toBeEnabled();
    // Buying from a SELL ad: Back goes to the Buy side of the market.
    await expect(page.getByRole("link", { name: "Marketplace" })).toHaveAttribute(
      "href",
      "/trade?want=BUY",
    );

    await lookAgain(page);

    await expect(alertSaying(page, "no longer available")).toBeVisible();
    await expect(page.getByRole("button", { name: "No longer available" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Back to the market" })).toHaveAttribute(
      "href",
      "/trade?want=BUY",
    );
    await expectNoHorizontalOverflow(page);
  });

  test("a refused order says why where the button is", async ({ page, context }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      { method: "GET", path: /^\/v1\/offers\/o1$/, reply: () => ok(offer("SELL")) },
      {
        method: "POST",
        path: /^\/v1\/trades$/,
        reply: () =>
          apiError(
            "CONFLICT",
            "That offer no longer has enough available. Try a smaller amount or another offer.",
            409,
          ),
      },
    ]);

    await page.goto("/trade/offers/o1");
    await page.getByLabel("I will pay").fill("1000");
    const buy = page.getByRole("button", { name: "Buy USDT" });
    await buy.click();

    const alert = alertSaying(page, "no longer has enough available");
    await expect(alert).toBeVisible();
    // Beside the button, not at the top of a form the button is the bottom of.
    const [alertBox, buttonBox] = await Promise.all([alert.boundingBox(), buy.boundingBox()]);
    expect(alertBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.y - (alertBox!.y + alertBox!.height)).toBeLessThan(80);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("the amount filter", () => {
  test("has Binance's quick amounts under it, and still takes a typed one", async ({
    page,
    context,
  }) => {
    await withSession(context);
    const asked: string[] = [];
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/offers$/,
        reply: (route) => {
          asked.push(new URL(route.request().url()).search);
          return ok({ offers: [], nextCursor: null });
        },
      },
    ]);

    await page.goto("/trade");
    const quick = page.getByRole("group", { name: "Quick amounts" });
    await expect(quick.getByRole("button")).toHaveText(["1,000", "5,000", "10,000", "50,000"]);
    const field = page.getByLabel("Amount in birr");

    // A tap fills the field and asks the market for offers that fit it.
    await quick.getByRole("button", { name: "5,000" }).click();
    await expect(field).toHaveValue("5000");
    await expect(quick.getByRole("button", { name: "5,000" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => asked.at(-1)).toContain("amountSantim=500000");

    // The same tap again clears it.
    await quick.getByRole("button", { name: "5,000" }).click();
    await expect(field).toHaveValue("");
    await expect.poll(() => asked.at(-1)).not.toContain("amountSantim");

    // Typing is still typing.
    await field.fill("700");
    await expect.poll(() => asked.at(-1)).toContain("amountSantim=70000");
    await expect(quick.getByRole("button", { pressed: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("an ad that moves while you are ordering", () => {
  /*
    The advertiser edits the ad while somebody is filling in the form in front
    of it. The order carries the version it was placed against, so the screen
    has to say what moved and be told, once, that it was read.
  */
  const moved = () =>
    offer("SELL", {
      revision: 2,
      priceSantim: "16000",
      paymentWindowMinutes: 15,
      terms: "Pay from an account in your own name.",
    });

  test("lists what changed and asks for one deliberate click", async ({ page, context }) => {
    await withSession(context);
    const orders: unknown[] = [];
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/offers\/o1$/,
        reply: (_route, calls) => ok(calls === 1 ? offer("SELL") : moved()),
      },
      {
        method: "POST",
        path: /^\/v1\/trades$/,
        reply: (route) => {
          orders.push(route.request().postDataJSON());
          return ok(TRADE, 201);
        },
      },
      { method: "GET", path: /^\/v1\/trades\/t1$/, reply: () => ok(TRADE) },
      { method: "GET", path: /^\/v1\/trades\/t1\/events$/, reply: () => ok({ events: [] }) },
      {
        method: "GET",
        path: /^\/v1\/trades\/t1\/messages$/,
        reply: () =>
          ok({ messages: [], lastSeq: 0, myLastReadSeq: 0, theirLastReadSeq: 0, open: true }),
      },
    ]);

    await page.goto("/trade/offers/o1");
    await page.getByLabel("I will pay").fill("1000");

    await lookAgain(page);

    const changed = page.getByRole("status").filter({ hasText: "changed this ad" });
    await expect(changed).toContainText("158.50 → 160.00");
    await expect(changed).toContainText("Time to pay: 30 → 15 minutes");
    await expect(changed).toContainText("terms changed");
    // The screen itself follows the ad, not only the notice about it.
    await expect(page.getByText("160.00").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Nothing is ordered until the changes have been taken in.
    await page.getByRole("button", { name: "Accept the changes" }).click();
    await expect(changed).toBeHidden();
    expect(orders).toHaveLength(0);

    await page.getByRole("button", { name: "Buy USDT" }).click();
    await expect(page).toHaveURL(/\/orders\/t1$/);
    expect(orders).toEqual([
      expect.objectContaining({ offerId: "o1", offerRevision: 2, fiatSantim: "100000" }),
    ]);
  });

  test("an order the server refuses because the ad moved says what moved", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/offers\/o1$/,
        reply: (_route, calls) => ok(calls === 1 ? offer("SELL") : moved()),
      },
      {
        method: "POST",
        path: /^\/v1\/trades$/,
        reply: () =>
          apiError(
            "OFFER_CHANGED",
            "This ad changed while you were ordering. Check what changed, then order again.",
            409,
          ),
      },
    ]);

    await page.goto("/trade/offers/o1");
    await page.getByLabel("I will pay").fill("1000");
    await page.getByRole("button", { name: "Buy USDT" }).click();

    const changed = page.getByRole("status").filter({ hasText: "changed this ad" });
    await expect(changed).toContainText("158.50 → 160.00");
    await expect(page.getByRole("button", { name: "Accept the changes" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("a payment method the ad no longer offers is not left chosen", async ({ page, context }) => {
    test.skip(!desktop(page), "one viewport is enough for a cleared choice");
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/offers\/o1$/,
        reply: (_route, calls) =>
          ok(
            calls === 1
              ? offer("SELL", { paymentKinds: ["TELEBIRR", "DASHEN"] })
              : offer("SELL", { revision: 2, paymentKinds: ["TELEBIRR", "AWASH"] }),
          ),
      },
    ]);

    await page.goto("/trade/offers/o1");
    const railed = page.getByRole("combobox", { name: "Pay with" });
    await railed.click();
    await page.getByRole("option", { name: "Dashen Bank" }).click();
    await expect(railed).toHaveText("Dashen Bank");

    await lookAgain(page);

    await expect(railed).toHaveText("Choose a payment method");
    await expect(page.getByRole("status").filter({ hasText: "changed this ad" })).toContainText(
      "Payment methods: now Telebirr, Awash Bank",
    );
  });
});

test.describe("a new page starts at the top", () => {
  test("a link from deep in a long page lands at the top", async ({ page, context }) => {
    await withSession(context);
    const offers = Array.from({ length: 30 }, (_, index) =>
      offer("SELL", {
        id: `o${index + 1}`,
        advertiser: { ...ADVERTISER, username: `user_${20000000 + index}` },
      }),
    );
    await stubApi(page, [
      ...signedIn(),
      { method: "GET", path: /^\/v1\/offers$/, reply: () => ok({ offers, nextCursor: null }) },
      { method: "GET", path: /^\/v1\/offers\/o30$/, reply: () => ok(offers[29]) },
    ]);

    await page.goto("/trade");
    await expect(page.locator('a[href="/trade/offers/o1"]')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const last = page.locator('a[href="/trade/offers/o30"]');
    await last.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    await last.click();
    await expect(page).toHaveURL(/\/trade\/offers\/o30$/);
    await expect(page.getByRole("heading", { level: 1, name: /^Buy USDT from/ })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("the next verification step starts at the top", async ({ page, context }) => {
    test.skip(!mobile(page), "the panel only needs scrolling on a phone");
    await withSession(context);
    await stubApi(page, [
      ...signedIn({ ...USER, kycStatus: "NOT_STARTED" }),
      {
        method: "GET",
        path: /^\/v1\/kyc$/,
        reply: () =>
          ok({
            status: "NOT_STARTED",
            submittedAt: null,
            reviewedAt: null,
            rejectionReason: null,
            documents: [],
          }),
      },
    ]);

    await page.goto("/verify");
    const steps = page.getByRole("list").filter({ hasText: "1. Document" });
    await expect(steps).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The radio's real input is sr-only under its label; a person taps the words.
    await page.getByText("National ID card", { exact: true }).click();
    await page.evaluate(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }),
    );
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Continue" }).click();

    await expect(steps).toContainText("2. Your details");
    // Scrolled back up to the list, with the header's height to spare.
    await expect.poll(async () => (await steps.boundingBox())?.y ?? -1).toBeLessThan(160);
    await expect.poll(async () => (await steps.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
    // And announced: focus is on the step's name.
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain(
      "Your details",
    );
  });
});
