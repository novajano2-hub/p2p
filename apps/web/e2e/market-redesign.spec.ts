import { expect, test, type Page } from "@playwright/test";

import {
  ADVERTISER,
  expectNoHorizontalOverflow,
  ok,
  signedIn,
  stubApi,
  toastSaying,
  USER,
  withSession,
} from "./support";

/*
  The market redesign (Phase 5, stage 5), against a stubbed API. What the new
  screens say that the old ones did not: whether an advertiser is around, why
  an ad cannot be taken, what an ad of yours can offer and why the market is
  hiding it, the filters, posting in three steps with the balance beside the
  total, and adding a payment method from a panel. Every one at all three
  widths, with nothing past either edge.
*/

const VERIFIED = { ...USER, kycStatus: "APPROVED" };
const MINUTE = 60_000;

/** A time this many minutes ago, a little past the minute so the label cannot round either way. */
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * MINUTE - 20_000).toISOString();

/** 100 USDT at 158.50 birr, 10 to 20,000 birr a trade, paid through Telebirr. */
const offer = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
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
  ...overrides,
});

/** One of your own ads, as My ads reads it. */
const mine = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  side: "SELL",
  priceSantim: "15850",
  totalAmount: "100000000",
  remainingAmount: "100000000",
  minSantim: "100000",
  maxSantim: "2000000",
  paymentWindowMinutes: 30,
  paymentMethods: [{ kind: "TELEBIRR", paymentMethodId: "pm1", label: "Telebirr ····5678" }],
  terms: null,
  autoReply: null,
  requireVerified: false,
  minCompletedTrades: 0,
  status: "ACTIVE",
  revision: 1,
  openOrders: 0,
  adBalance: "100000000",
  hiddenBecause: null,
  unfundedSince: null,
  pausesAt: null,
  createdAt: "2026-09-17T09:00:00.000Z",
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

const balance = (available: string) => ({
  method: "GET" as const,
  path: /^\/v1\/wallet\/balance$/,
  reply: () =>
    ok({ asset: "USDT", available, escrowed: "0", pendingWithdrawal: "0", total: available }),
});

/** An ad's own element in the market or in My ads: the list item that carries this text. */
const itemWith = (page: Page, text: string) =>
  page.getByRole("listitem").filter({ hasText: text }).first();

test.describe("the market", () => {
  test("says who is around, which ads you cannot take and why, and which one is yours", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/offers$/,
        reply: () =>
          ok({
            offers: [
              offer("o1", { advertiser: { ...ADVERTISER, username: "selam_usdt", online: true } }),
              offer("o2", {
                advertiser: {
                  ...ADVERTISER,
                  username: "hanna_b",
                  online: false,
                  lastSeenAt: minutesAgo(25),
                },
              }),
              offer("o3", {
                requireVerified: true,
                blockedBecause: "VERIFICATION",
                advertiser: { ...ADVERTISER, username: "yonas_exchange" },
              }),
              offer("o4", { isMine: true, advertiser: { ...ADVERTISER, username: USER.username } }),
            ],
            nextCursor: null,
          }),
      },
    ]);

    await page.goto("/trade");
    await expect(itemWith(page, "selam_usdt")).toContainText("Online");
    await expect(itemWith(page, "hanna_b")).toContainText("Last online 25 min ago");
    await expect(
      itemWith(page, "selam_usdt").getByRole("link", { name: "Buy USDT" }),
    ).toHaveAttribute("href", "/trade/offers/o1");

    // An ad for verified accounts, seen by somebody who is not: no way in, and the reason.
    const limited = itemWith(page, "yonas_exchange");
    await expect(limited.getByRole("button", { name: "Limited" })).toBeDisabled();
    await expect(limited).toContainText("Verified accounts only");
    expect(await limited.getByRole("link").count()).toBe(0);

    // Your own ad is in its place, to edit rather than to take.
    await expect(
      itemWith(page, USER.username).getByRole("link", { name: "Your ad · Edit" }),
    ).toHaveAttribute("href", "/trade/ads/o4/edit");
    await expectNoHorizontalOverflow(page);
  });

  test("filters by time to pay and by what you can take, and sells in red", async ({
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
          return ok({ offers: [offer("o1", { side: "BUY" })], nextCursor: null });
        },
      },
    ]);

    await page.goto("/trade?want=SELL");
    await expect(page.getByRole("link", { name: "Sell USDT" })).toHaveClass(/bg-destructive/);

    await page.getByRole("button", { name: "Filters" }).click();
    const filters = page.getByRole("dialog", { name: "Filters" });
    await expect(filters).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(
      filters.getByRole("group", { name: "Time to pay" }).getByRole("button"),
    ).toHaveText(["All", "15 min", "30 min", "45 min", "60 min"]);
    await expect(filters).toContainText("Only ads whose buyer has this long to pay you.");
    await filters.getByRole("button", { name: "45 min" }).click();
    await filters.getByRole("switch", { name: "Only ads I can take" }).click();
    await filters.getByRole("button", { name: "Apply" }).click();
    await expect(filters).toBeHidden();

    await expect.poll(() => asked.at(-1)).toContain("paymentWindowMinutes=45");
    expect(asked.at(-1)).toContain("takeable=true");
    expect(asked.at(-1)).toContain("want=SELL");
    await expect(page.getByRole("button", { name: "Filters · 2" })).toBeVisible();

    // Reset lets everything back in.
    await page.getByRole("button", { name: "Filters · 2" }).click();
    await page
      .getByRole("dialog", { name: "Filters" })
      .getByRole("button", { name: "Reset" })
      .click();
    await expect.poll(() => asked.at(-1)).not.toContain("takeable");
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("an ad you cannot take", () => {
  test("says why before the button, and the button waits", async ({ page, context }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/offers\/o1$/,
        reply: () => ok(offer("o1", { requireVerified: true, blockedBecause: "VERIFICATION" })),
      },
    ]);

    await page.goto("/trade/offers/o1");
    await expect(page.getByRole("button", { name: "Limited" })).toBeDisabled();
    await expect(
      page.getByText("This advertiser trades with verified accounts only."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Verify now" })).toHaveAttribute("href", "/verify");
    await expect(
      page.getByRole("region", { name: "Who may take this ad" }).getByLabel("Not met"),
    ).toBeVisible();
    // The advertiser, whether they are around, and their record at a glance.
    const advertiser = page.getByRole("region", { name: "Advertiser" });
    await expect(advertiser).toContainText("Online");
    await expect(advertiser).toContainText("Average release");
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("my ads", () => {
  test("says what each ad can offer, why one is hidden, and how long before it goes offline", async ({
    page,
    context,
  }) => {
    await withSession(context);
    const pausesAt = new Date(Date.now() + (23 * 60 + 41) * MINUTE - 20_000).toISOString();
    let paused = 0;
    await stubApi(page, [
      ...signedIn(VERIFIED),
      balance("2000000"),
      {
        method: "GET",
        path: /^\/v1\/offers\/mine$/,
        reply: () =>
          ok({
            offers: [
              mine("a1", {
                adBalance: "2000000",
                hiddenBecause: "BALANCE",
                unfundedSince: new Date(Date.now() - 20 * MINUTE).toISOString(),
                pausesAt,
              }),
              mine("a2", {
                priceSantim: "15940",
                remainingAmount: "3500000",
                adBalance: "2000000",
                hiddenBecause: "REMAINDER",
              }),
            ],
          }),
      },
      {
        method: "POST",
        path: /^\/v1\/offers\/a1\/pause$/,
        reply: () => {
          paused += 1;
          return ok(mine("a1", { status: "PAUSED" }));
        },
      },
    ]);

    await page.goto("/trade/ads");
    await expect(page.getByRole("region", { name: "Your available balance" })).toContainText(
      "2.000000 USDT",
    );

    const uncovered = itemWith(page, "158.50");
    await expect(uncovered).toContainText(
      "Hidden from the market: your balance cannot cover the smallest order.",
    );
    await expect(uncovered).toContainText(/Add USDT within 23 h 4\d min/);
    await expect(uncovered.getByRole("link", { name: "Deposit USDT" })).toHaveAttribute(
      "href",
      "/wallet/deposit",
    );
    await expect(uncovered.getByRole("link", { name: "Lower the minimum" })).toHaveAttribute(
      "href",
      "/trade/ads/a1/edit",
    );

    const soldDown = itemWith(page, "159.40");
    await expect(soldDown).toContainText(
      "Hidden: what is left of this ad is less than one smallest order.",
    );
    await expect(soldDown.getByRole("link", { name: "Edit ad" })).toHaveAttribute(
      "href",
      "/trade/ads/a2/edit",
    );
    await expectNoHorizontalOverflow(page);

    // Online is a switch: off takes it offline.
    await uncovered.getByRole("switch", { name: "Online" }).click();
    await expect.poll(() => paused).toBe(1);
  });
});

test.describe("posting an ad", () => {
  test("goes in three steps, and an ad bigger than the balance says what that means", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(VERIFIED),
      balance("2000000"),
      {
        method: "GET",
        path: /^\/v1\/payment-methods$/,
        reply: () => ok({ paymentMethods: [TELEBIRR] }),
      },
      {
        method: "GET",
        path: /^\/v1\/offers$/,
        reply: () => ok({ offers: [offer("o9", { priceSantim: "15820" })], nextCursor: null }),
      },
    ]);

    await page.goto("/trade/ads/new");
    // The price, against the best one in the market now.
    await expect(page.getByText("Best sell price in the market now:")).toContainText("158.20");
    await page.getByLabel("Price, birr per USDT").fill("158.80");
    await expect(page.getByText("0.38% above it")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Next" }).click();

    // More than the balance: allowed, and said.
    await page.getByLabel("Total amount, USDT").fill("100");
    const warning = page
      .getByRole("status")
      .filter({ hasText: "Your balance covers 2.000000 USDT of these 100.000000 USDT." });
    await expect(warning).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Use all" }).click();
    await expect(page.getByLabel("Total amount, USDT")).toHaveValue("2.000000");
    await expect(warning).toBeHidden();

    // Back keeps what was typed.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Price, birr per USDT")).toHaveValue("158.80");
  });

  test("an ad the balance cannot cover is posted as hidden, not as online", async ({
    page,
    context,
  }) => {
    await withSession(context);
    const posted = mine("n1", { adBalance: "0", hiddenBecause: "BALANCE" });
    await stubApi(page, [
      ...signedIn(VERIFIED),
      balance("0"),
      {
        method: "GET",
        path: /^\/v1\/payment-methods$/,
        reply: () => ok({ paymentMethods: [TELEBIRR] }),
      },
      { method: "GET", path: /^\/v1\/offers$/, reply: () => ok({ offers: [], nextCursor: null }) },
      { method: "POST", path: /^\/v1\/offers$/, reply: () => ok(posted) },
      { method: "GET", path: /^\/v1\/offers\/mine$/, reply: () => ok({ offers: [posted] }) },
    ]);

    await page.goto("/trade/ads/new");
    await page.getByLabel("Price, birr per USDT").fill("158.50");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Total amount, USDT").fill("100");
    await page.getByLabel("Smallest trade, birr").fill("1000");
    await page.getByLabel("Largest trade, birr").fill("20000");
    await page.getByText("Telebirr ····5678").click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Post ad" }).click();

    const said = toastSaying(page, "Posted, but hidden from the market");
    await expect(said).toBeVisible();
    await expect(said).toContainText("Deposit USDT and it shows on the market.");
    await expect(page).toHaveURL(/\/trade\/ads$/);
    await expect(toastSaying(page, "Your ad is online")).toHaveCount(0);
  });

  test("keeps what was typed through adding a payment method, and ticks the new one", async ({
    page,
    context,
  }) => {
    await withSession(context);
    let methods: unknown[] = [];
    await stubApi(page, [
      ...signedIn(VERIFIED),
      balance("2000000"),
      {
        method: "GET",
        path: /^\/v1\/payment-methods$/,
        reply: () => ok({ paymentMethods: methods }),
      },
      {
        method: "POST",
        path: /^\/v1\/payment-methods$/,
        reply: () => {
          methods = [TELEBIRR];
          return ok(TELEBIRR, 201);
        },
      },
      { method: "GET", path: /^\/v1\/offers$/, reply: () => ok({ offers: [], nextCursor: null }) },
    ]);

    await page.goto("/trade/ads/new");
    await page.getByLabel("Price, birr per USDT").fill("158.80");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Total amount, USDT").fill("2");
    await page.getByLabel("Smallest trade, birr").fill("100");
    await page.getByRole("link", { name: "Add a payment method" }).click();

    // Adding one is the errand, so its panel is open on arrival.
    const sheet = page.getByRole("dialog", { name: "Add a payment method" });
    await sheet.getByLabel("Name on the account").fill("Abebe Bikila");
    await sheet.getByLabel("Telebirr phone number").fill("0912345678");
    await sheet.getByRole("button", { name: "Add payment method" }).click();

    // Back on the second step as it was left, with the new method in the ad.
    await expect(page).toHaveURL(/\/trade\/ads\/new$/);
    await expect(page.getByLabel("Total amount, USDT")).toHaveValue("2");
    await expect(page.getByLabel("Smallest trade, birr")).toHaveValue("100");
    await expect(page.getByRole("checkbox", { name: "Telebirr ····5678" })).toBeChecked();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Price, birr per USDT")).toHaveValue("158.80");
  });
});

test.describe("payment methods", () => {
  test("are added from a panel with every wallet and bank a tap away", async ({
    page,
    context,
  }) => {
    await withSession(context);
    let added: unknown = null;
    await stubApi(page, [
      ...signedIn(),
      { method: "GET", path: /^\/v1\/payment-methods$/, reply: () => ok({ paymentMethods: [] }) },
      {
        method: "POST",
        path: /^\/v1\/payment-methods$/,
        reply: (route) => {
          added = route.request().postDataJSON();
          return ok(
            { ...TELEBIRR, id: "pm2", kind: "AWASH", label: "Awash Bank ····6789", hint: "6789" },
            201,
          );
        },
      },
    ]);

    await page.goto("/trade/payment-methods");
    await page.getByRole("button", { name: "Add a payment method" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a payment method" });
    await expect(sheet).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await sheet.getByText("Awash Bank", { exact: true }).click();
    await expect(sheet.getByRole("radio", { name: "Awash Bank" })).toBeChecked();
    await sheet.getByLabel("Name on the account").fill("Abebe Bikila");
    await sheet.getByLabel("Account number").fill("0132012345678");
    await sheet.getByRole("button", { name: "Add payment method" }).click();

    await expect(sheet).toBeHidden();
    expect(added).toEqual({
      kind: "AWASH",
      accountHolder: "Abebe Bikila",
      accountNumber: "0132012345678",
    });
    await expectNoHorizontalOverflow(page);
  });
});
