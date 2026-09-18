import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  ok,
  signedIn,
  stubApi,
  stubSocket,
  USER,
  withSession,
} from "./support";

/*
  My ads, in the three states an ad is in: online, offline, closed. A closed
  ad is closed for good, which is why it has a tab of its own rather than a
  place among the ads that still work.
*/

const desktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

const ad = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  side: "SELL",
  priceSantim: "15850",
  totalAmount: "100000000",
  remainingAmount: "60000000",
  minSantim: "1000",
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
  adBalance: "60000000",
  hiddenBecause: null,
  unfundedSince: null,
  pausesAt: null,
  createdAt: "2026-09-17T09:00:00.000Z",
  ...overrides,
});

const ADS = [
  ad({ id: "a1", openOrders: 2 }),
  ad({ id: "a2", status: "PAUSED", priceSantim: "15900" }),
  ad({ id: "a3", status: "CLOSED", priceSantim: "16000", remainingAmount: "0" }),
];

test.beforeEach(async ({ page, context }) => {
  await withSession(context);
  await stubApi(page, [
    ...signedIn({ ...USER, kycStatus: "APPROVED" }),
    { method: "GET", path: /^\/v1\/offers\/mine$/, reply: () => ok({ offers: ADS }) },
    {
      method: "POST",
      path: /^\/v1\/offers\/a1\/close$/,
      reply: () => ok(ad({ status: "CLOSED" })),
    },
  ]);
});

test("keeps online, offline and closed ads apart", async ({ page }) => {
  await page.goto("/trade/ads");

  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveText(["Online (1)", "Offline (1)", "Closed (1)"]);
  await expect(page.getByRole("tab", { name: "Online (1)" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // The live one, with everything its owner can do to it.
  const online = page.getByRole("tabpanel");
  await expect(online.getByText("Selling USDT")).toHaveCount(1);
  await expect(online).toContainText("158.50");
  await expect(online).toContainText("2 open orders");
  await expect(online.getByRole("link", { name: "Edit" })).toBeVisible();
  await expect(online.getByRole("switch", { name: "Online" })).toBeChecked();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("tab", { name: "Offline (1)" }).click();
  await expect(page).toHaveURL(/\/trade\/ads\?tab=offline$/);
  await expect(page.getByRole("tabpanel")).toContainText("159.00");
  await expect(page.getByRole("switch", { name: "Online" })).not.toBeChecked();
  await expectNoHorizontalOverflow(page);

  // A closed ad is a record, not a thing to work on.
  await page.getByRole("tab", { name: "Closed (1)" }).click();
  await expect(page).toHaveURL(/\/trade\/ads\?tab=closed$/);
  const closed = page.getByRole("tabpanel");
  await expect(closed).toContainText("160.00");
  await expect(closed.getByRole("button")).toHaveCount(0);
  await expect(closed.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("moves an ad the platform took offline as it happens, not at the next visit", async ({
  page,
}) => {
  const socket = await stubSocket(page);
  let offline = false;
  await stubApi(page, [
    ...signedIn({ ...USER, kycStatus: "APPROVED" }),
    {
      method: "GET",
      path: /^\/v1\/offers\/mine$/,
      reply: () => ok({ offers: [ad({ status: offline ? "PAUSED" : "ACTIVE" })] }),
    },
  ]);

  await page.goto("/trade/ads");
  await expect(page.getByRole("tab")).toHaveText(["Online (1)", "Offline (0)", "Closed (0)"]);

  // A day without the balance to cover it: the worker took it offline, and says so.
  offline = true;
  (await socket.connected).send({
    type: "notification",
    notification: {
      id: "n1",
      type: "OFFER_PAUSED",
      title: "Your ad went offline",
      body: "Your sell ad at 158.50 birr was taken offline: for 24 hours your available balance could not cover its smallest order of 10.00 birr. Add USDT, then switch it back on in My ads.",
      link: "/trade/ads?tab=offline",
      readAt: null,
      createdAt: new Date().toISOString(),
    },
  });
  await expect(page.getByRole("tab")).toHaveText(["Online (0)", "Offline (1)", "Closed (0)"]);
  await expectNoHorizontalOverflow(page);
});

test("says what closing an ad does to the orders still running", async ({ page }) => {
  test.skip(!desktop(page), "one viewport is enough for a sentence");
  await page.goto("/trade/ads");

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("2 open orders will finish normally.")).toBeVisible();

  await page.getByRole("button", { name: "Close it" }).click();
  await expect(page.getByRole("tab", { name: "Online (1)" })).toBeVisible();
});

test("a tab is part of the address", async ({ page }) => {
  test.skip(!desktop(page), "one viewport is enough for a link");
  await page.goto("/trade/ads?tab=closed");
  await expect(page.getByRole("tab", { name: "Closed (1)" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tabpanel")).toContainText("160.00");
});
