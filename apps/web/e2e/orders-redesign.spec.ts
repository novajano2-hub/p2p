import { expect, test, type Page } from "@playwright/test";

import {
  ADVERTISER,
  expectNoHorizontalOverflow,
  ok,
  signedIn,
  stubApi,
  TRADE,
  USER,
  withSession,
} from "./support";

/*
  Orders and chat, redesigned (Phase 5, stage 6), against a stubbed API. What
  the new screens do that the old ones did not: a list in Binance's two tabs
  whose rows name what is wanted, three filters that reach the API, an order
  page that says what to do now with every payment detail copyable, a chat
  beside the order on a desk and a screen of its own on a phone, and a chat
  that says when it closes and, once closed, why. At all three widths, with
  nothing past either edge.
*/

/** From lg up the chat is beside the order; below it, behind the Chat button. */
const beside = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const phone = (page: Page) => (page.viewportSize()?.width ?? 0) < 640;

const SELLING = {
  ...TRADE,
  id: "t2",
  role: "SELLER",
  status: "BUYER_MARKED_PAID",
  message: "The buyer says they have paid. Check your account, then release.",
  amount: "31545741",
  buyerReceives: "31545741",
  fiatSantim: "500000",
  counterparty: { ...ADVERTISER, username: "kidus_fx", online: false },
  payment: { ...TRADE.payment, reference: "FT26262XK1" },
  paidAt: "2026-09-17T09:12:00.000Z",
  chat: { lastSeq: 3, unread: 1, closesAt: null },
  actions: { ...TRADE.actions, canMarkPaid: false, canCancel: false, canRelease: true },
};

const DONE = {
  ...TRADE,
  id: "t3",
  status: "COMPLETED",
  message: "The USDT is in your available balance.",
  payment: { ...TRADE.payment, instructions: null },
  paidAt: "2026-09-17T09:07:00.000Z",
  // Noon UTC: the day these name is the same in whatever time zone the tests run in.
  closedAt: "2026-09-17T12:00:00.000Z",
  chat: { lastSeq: 2, unread: 0, closesAt: "2026-09-18T12:00:00.000Z" },
  actions: { ...TRADE.actions, canMarkPaid: false, canCancel: false },
};

const EXPIRED = {
  ...DONE,
  id: "t4",
  status: "EXPIRED",
  message: "The time to pay ran out. Do not send anything for this trade now.",
  paidAt: null,
  chat: { lastSeq: 2, unread: 0, closesAt: "2026-09-18T12:00:00.000Z" },
  actions: { ...DONE.actions, canChat: false },
};

const message = (seq: number, senderId: string, body: string) => ({
  id: `m${seq}`,
  tradeId: "t1",
  seq,
  senderId,
  kind: "TEXT",
  body,
  image: null,
  clientMessageId: `c${seq}`,
  createdAt: "2026-09-17T09:02:00.000Z",
});

/** Everything one order page asks for. */
const orderPage = (trade: object, chatOpen = true) => {
  const id = (trade as { id: string }).id;
  return [
    { method: "GET" as const, path: new RegExp(`^/v1/trades/${id}$`), reply: () => ok(trade) },
    {
      method: "GET" as const,
      path: new RegExp(`^/v1/trades/${id}/events$`),
      reply: () => ok({ events: [] }),
    },
    {
      method: "GET" as const,
      path: new RegExp(`^/v1/trades/${id}/messages$`),
      reply: () =>
        ok({
          messages: [
            message(1, "someone-else", "Hello! Send to the number shown and I release at once."),
            message(2, USER.id, "Sending now."),
          ],
          lastSeq: 2,
          myLastReadSeq: 2,
          theirLastReadSeq: 2,
          open: chatOpen,
        }),
    },
    {
      method: "POST" as const,
      path: new RegExp(`^/v1/trades/${id}/messages/read$`),
      reply: () => ok({ lastReadSeq: 2 }),
    },
  ];
};

test.describe("the orders list", () => {
  test("names what is wanted from you, and carries what is unread into the chat", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/trades$/,
        reply: () =>
          ok({
            trades: [{ ...TRADE, chat: { lastSeq: 2, unread: 2, closesAt: null } }, SELLING],
            nextCursor: null,
          }),
      },
    ]);

    await page.goto("/orders");
    // Two tabs, Binance's words, and how many orders still need someone.
    const processing = page.getByRole("tab", { name: /^Processing/ });
    await expect(processing).toHaveAttribute("aria-selected", "true");
    await expect(processing).toContainText("2");
    await expect(page.getByRole("tab", { name: "All orders" })).toBeVisible();

    const buying = page.getByRole("listitem").filter({ hasText: ADVERTISER.username });
    await expect(buying).toContainText("Buy USDT");
    await expect(buying).toContainText("1,000.00");
    await expect(buying.getByRole("link", { name: "Pay now" })).toHaveAttribute(
      "href",
      "/orders/t1",
    );
    await expect(
      buying.getByRole("link", { name: `Chat with ${ADVERTISER.username}, 2 unread` }),
    ).toHaveAttribute("href", "/orders/t1?chat=open");

    const selling = page.getByRole("listitem").filter({ hasText: "kidus_fx" });
    await expect(selling).toContainText("Sell USDT");
    await expect(selling.getByRole("link", { name: "Release" })).toHaveAttribute(
      "href",
      "/orders/t2",
    );
    await expectNoHorizontalOverflow(page);
  });

  test("all orders asks the API for a side, a state and a stretch of time", async ({
    page,
    context,
  }) => {
    await withSession(context);
    const asked: URLSearchParams[] = [];
    await stubApi(page, [
      ...signedIn(),
      {
        method: "GET",
        path: /^\/v1\/trades$/,
        reply: (route) => {
          asked.push(new URL(route.request().url()).searchParams);
          return ok({ trades: [DONE], nextCursor: null });
        },
      },
    ]);
    const lastAll = () => asked.filter((query) => query.get("scope") === "all").at(-1);

    await page.goto("/orders");
    await page.getByRole("tab", { name: "All orders" }).click();
    await expect(page).toHaveURL(/\/orders\?tab=all$/);
    await expect.poll(() => lastAll()?.get("scope")).toBe("all");
    expect(lastAll()?.get("role")).toBeNull();

    if (phone(page)) {
      // A phone: one button, and the three filters in the sheet everything slides up in.
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Filters" });
      await expect(sheet).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await sheet
        .getByRole("group", { name: "Type" })
        .getByRole("button", { name: "Sell" })
        .click();
      await sheet
        .getByRole("group", { name: "Status" })
        .getByRole("button", { name: "Completed" })
        .click();
      await sheet
        .getByRole("group", { name: "Date" })
        .getByRole("button", { name: "Last 7 days" })
        .click();
      await sheet.getByRole("button", { name: "Apply" }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("button", { name: "Filters · 3" })).toBeVisible();
    } else {
      await page
        .getByRole("group", { name: "Order type" })
        .getByRole("button", { name: "Sell" })
        .click();
      await page.getByRole("combobox", { name: "Status" }).click();
      await page.getByRole("option", { name: "Completed" }).click();
      await page.getByRole("button", { name: /^Date range/ }).click();
      await page
        .getByRole("dialog", { name: "Date range" })
        .getByRole("button", { name: "Last 7 days" })
        .click();
      await expect(page.getByRole("button", { name: "Date range: Last 7 days" })).toBeVisible();
    }

    await expect.poll(() => lastAll()?.get("status")).toBe("COMPLETED");
    expect(lastAll()?.get("role")).toBe("SELLER");
    // A moment, in the viewer's own days: a week back from their midnight.
    expect(Date.parse(lastAll()?.get("from") ?? "")).toBeLessThan(Date.now() - 6 * 86_400_000);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("an order, buying", () => {
  test("says what to do now, gives every detail its own Copy, and keeps the chat at hand", async ({
    page,
    context,
  }) => {
    await withSession(context);
    const trade = { ...TRADE, chat: { lastSeq: 2, unread: 2, closesAt: null } };
    await stubApi(page, [...signedIn(), ...orderPage(trade)]);

    await page.goto("/orders/t1");
    const status = page.getByRole("region", { name: "Where this order stands" });
    await expect(status).toContainText("Step 1 of 3");
    await expect(status.getByRole("heading", { name: "Pay the seller" })).toBeVisible();
    await expect(status).toContainText("left to pay");

    const payment = page.getByRole("region", { name: "Payment" });
    await expect(payment).toContainText("Send exactly");
    for (const name of [
      "Copy the amount",
      "Copy the name on the account",
      "Copy the telebirr phone number",
    ]) {
      await expect(payment.getByRole("button", { name })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "I have paid" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel order" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const chat = page.getByRole("region", { name: "Chat" });
    if (beside(page)) {
      // A desk: beside the order, with who it is and whether they are around.
      await expect(chat).toBeVisible();
      await expect(chat).toContainText(ADVERTISER.username);
      await expect(chat).toContainText("Online");
      await expect(chat.getByText("Sending now.")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Chat/ })).toBeHidden();
      return;
    }

    // A phone, Binance's way: a button with what is unread, and the chat over everything.
    await expect(chat).toBeHidden();
    await page.getByRole("button", { name: "Chat, 2 unread" }).click();
    await expect(page).toHaveURL(/\/orders\/t1\?chat=open$/);
    await expect(chat).toBeVisible();
    await expect(chat.getByText("Sending now.")).toBeVisible();
    await expect(chat.getByRole("textbox", { name: "Message" })).toBeVisible();
    // What the order is waiting for, on a strip that leads back to it.
    await expect(chat).toContainText("Buy 6.31 USDT · 1,000.00 ETB");
    const box = await chat.boundingBox();
    const viewport = page.viewportSize();
    expect(box?.y).toBe(0);
    expect(Math.round(box?.height ?? 0)).toBe(viewport?.height);
    await expectNoHorizontalOverflow(page);

    await chat.getByRole("button", { name: "Back to the order" }).click();
    await expect(page).toHaveURL(/\/orders\/t1$/);
    await expect(chat).toBeHidden();
  });

  test("a link straight into the chat opens it, and the way back is the order", async ({
    page,
    context,
  }) => {
    test.skip(beside(page), "from lg up the chat is always beside the order");
    await withSession(context);
    await stubApi(page, [...signedIn(), ...orderPage(TRADE)]);

    await page.goto("/orders/t1?chat=open");
    const chat = page.getByRole("region", { name: "Chat" });
    await expect(chat.getByRole("textbox", { name: "Message" })).toBeVisible();
    await chat.getByRole("button", { name: "Back to the order" }).click();
    await expect(page).toHaveURL(/\/orders\/t1$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Buy 6.31 USDT");
  });
});

test.describe("an order, selling", () => {
  test("says what the buyer said, and asks for the password where the release is", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, [...signedIn(), ...orderPage(SELLING)]);

    await page.goto("/orders/t2");
    const status = page.getByRole("region", { name: "Where this order stands" });
    await expect(
      status.getByRole("heading", { name: "Check your account, then release" }),
    ).toBeVisible();
    await expect(status).toContainText("kidus_fx says they sent 5,000.00 ETB");
    await expect(status).toContainText("FT26262XK1");

    const release = page.getByRole("region", { name: "Release" });
    await expect(release).toContainText("A screenshot is not a payment.");
    await expect(release.getByLabel("Your password")).toBeVisible();
    await expect(release.getByRole("button", { name: "Release 31.55 USDT" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("the chat after the order", () => {
  test("stays open for a while, and says until when", async ({ page, context }) => {
    await withSession(context);
    await stubApi(page, [...signedIn(), ...orderPage(DONE)]);

    await page.goto(beside(page) ? "/orders/t3" : "/orders/t3?chat=open");
    await expect(
      page
        .getByRole("region", { name: "Where this order stands" })
        .getByRole("heading", { name: "Completed" }),
    ).toBeAttached();
    const chat = page.getByRole("region", { name: "Chat" });
    await expect(chat).toContainText(
      /This chat closes on 18 Sept at \d\d:\d\d, 24 hours after the order was completed\./,
    );
    await expect(chat.getByRole("textbox", { name: "Message" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("once closed, says why and when instead of offering a box", async ({ page, context }) => {
    await withSession(context);
    await stubApi(page, [...signedIn(), ...orderPage(EXPIRED, false)]);

    await page.goto(beside(page) ? "/orders/t4" : "/orders/t4?chat=open");
    const chat = page.getByRole("region", { name: "Chat" });
    await expect(chat).toContainText("This chat is closed.");
    await expect(chat).toContainText(
      /It closed on 18 Sept at \d\d:\d\d, 24 hours after the order expired\./,
    );
    await expect(chat).toContainText("You can still read it.");
    await expect(chat.getByRole("textbox", { name: "Message" })).toHaveCount(0);
    // What was said is still there to read.
    await expect(chat.getByText("Sending now.")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
