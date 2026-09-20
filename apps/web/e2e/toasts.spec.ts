import { expect, test, type Page } from "@playwright/test";

import {
  ADVERTISER,
  apiError,
  expectNoHorizontalOverflow,
  ok,
  signedIn,
  stubApi,
  stubSocket,
  toastSaying,
  TRADE,
  USER,
  withSession,
} from "./support";

/*
  Saying what happened (Phase 5, stage 2). A form that cannot be sent goes to
  its first problem and says what it is; a refusal is said where the person is
  looking and kept beside the button; an action that worked says so; news from
  the socket is said on whatever page is open, once; a picture that cannot be
  sent is refused before a byte leaves. And a toast wears the kit's colours in
  both themes.
*/

const desktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

const VERIFIED = { ...USER, kycStatus: "APPROVED" };

const TELEBIRR = {
  id: "pm1",
  kind: "TELEBIRR",
  label: "Telebirr ····5678",
  hint: "5678",
  status: "ACTIVE",
  createdAt: "2026-09-17T09:00:00.000Z",
};

/** 100 USDT at 158.50 ETB, 10 to 20,000 ETB a trade. */
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

/** The order page's own reads, for a trade as the stub has it. */
const orderPage = (trade: () => object) => [
  { method: "GET" as const, path: /^\/v1\/trades\/t1$/, reply: () => ok(trade()) },
  { method: "GET" as const, path: /^\/v1\/trades\/t1\/events$/, reply: () => ok({ events: [] }) },
  {
    method: "GET" as const,
    path: /^\/v1\/trades\/t1\/messages$/,
    reply: () =>
      ok({ messages: [], lastSeq: 0, myLastReadSeq: 0, theirLastReadSeq: 0, open: true }),
  },
];

const notification = (overrides: Record<string, unknown>) => ({
  type: "notification",
  notification: {
    id: "n1",
    type: "DEPOSIT_CREDITED",
    title: "Deposit credited",
    body: "25.00 USDT is in your available balance.",
    link: "/wallet",
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  },
});

const chatMessage = (id: string, seq: number, body: string) => ({
  type: "message",
  tradeId: "t1",
  message: {
    id,
    tradeId: "t1",
    seq,
    senderId: ADVERTISER.userId,
    kind: "TEXT",
    body,
    image: null,
    clientMessageId: `c-${id}`,
    createdAt: new Date().toISOString(),
  },
});

test.describe("a form that cannot be sent", () => {
  test("goes to its first problem and says what it is", async ({ page, context }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(VERIFIED),
      {
        method: "GET",
        path: /^\/v1\/payment-methods$/,
        reply: () => ok({ paymentMethods: [TELEBIRR] }),
      },
    ]);

    await page.goto("/trade/ads/new");
    // Each step checks its own fields before moving on, and goes to the first problem.
    await page.getByRole("button", { name: "Next" }).click();

    const said = toastSaying(page, "Enter the price in ETB per USDT.");
    await expect(said).toBeVisible();
    const price = page.getByLabel("Price, ETB per USDT");
    await expect(price).toBeFocused();
    await expect(price).toBeInViewport();

    await price.fill("158.50");
    await page.getByRole("button", { name: "Next" }).click();
    // On to the second step, and on again with nothing in it.
    await expect(page.getByLabel("Total amount, USDT")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    const next = toastSaying(page, "Enter how much USDT the ad is for.");
    await expect(next).toBeVisible();
    await expect(next).toContainText("3 more fields need a look too.");
    await expect(page.getByLabel("Total amount, USDT")).toBeFocused();
    // Every problem is also on its own field, where it stays.
    await expect(page.getByText("Choose at least one way to be paid.")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("an order with no amount goes to the amount", async ({ page, context }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      { method: "GET", path: /^\/v1\/offers\/o1$/, reply: () => ok(OFFER) },
    ]);

    await page.goto("/trade/offers/o1");
    await page.getByRole("button", { name: "Buy USDT" }).click();

    await expect(toastSaying(page, "Enter an amount.")).toBeVisible();
    const amount = page.getByLabel("I will pay");
    await expect(amount).toBeFocused();

    // As it is typed, against the ad's own limits.
    await amount.fill("5");
    await expect(page.getByText("The smallest trade on this offer is 10.00 ETB.")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("a refusal", () => {
  test("is said as a toast, and kept beside the button", async ({ page, context }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(VERIFIED),
      {
        method: "GET",
        path: /^\/v1\/payment-methods$/,
        reply: () => ok({ paymentMethods: [TELEBIRR] }),
      },
      {
        method: "POST",
        path: /^\/v1\/offers$/,
        reply: () =>
          apiError("CONFLICT", "You can have at most 5 live ads. Take one offline first.", 409),
      },
    ]);

    await page.goto("/trade/ads/new");
    await page.getByLabel("Price, ETB per USDT").fill("158.50");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Total amount, USDT").fill("100");
    await page.getByLabel("Smallest trade, ETB").fill("500");
    await page.getByLabel("Largest trade, ETB").fill("20000");
    await page.getByText("Telebirr ····5678").click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Post ad" }).click();

    const sentence = "You can have at most 5 live ads. Take one offline first.";
    await expect(toastSaying(page, sentence)).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: sentence })).toBeVisible();
    await expect(page).toHaveURL(/\/trade\/ads\/new$/);
    await expectNoHorizontalOverflow(page);
  });

  test("about a field is said on the field", async ({ page, context }) => {
    await withSession(context);
    let attempts = 0;
    const seller = {
      ...TRADE,
      role: "SELLER",
      status: "BUYER_MARKED_PAID",
      paidAt: "2026-09-17T09:05:00.000Z",
      payment: { ...TRADE.payment, instructions: null },
      actions: { ...TRADE.actions, canMarkPaid: false, canCancel: false, canRelease: true },
    };
    await stubApi(page, [
      ...signedIn(),
      ...orderPage(() => seller),
      {
        method: "POST",
        path: /^\/v1\/trades\/t1\/release$/,
        reply: () => {
          attempts += 1;
          return {
            status: 400,
            body: {
              error: {
                code: "VALIDATION_FAILED",
                message: "The request is not valid.",
                correlationId: "test",
                details: [{ path: "password", message: "That password is not right." }],
              },
            },
          };
        },
      },
    ]);

    await page.goto("/orders/t1");
    // Nothing typed: the form says so before asking the server.
    await page.getByRole("button", { name: /^Release 6\.31 USDT/ }).click();
    await expect(toastSaying(page, "Enter your password to confirm.")).toBeVisible();
    expect(attempts).toBe(0);

    const password = page.getByLabel("Your password");
    await password.fill("not-it");
    await page.getByRole("button", { name: /^Release 6\.31 USDT/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "That password is not right." }),
    ).toBeVisible();
    await expect(toastSaying(page, "That password is not right.")).toBeVisible();
    await expect(password).toBeFocused();
    expect(attempts).toBe(1);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("an action that worked", () => {
  test("says so, and the toast outlives the page it was said on", async ({ page, context }) => {
    await withSession(context);
    let added = false;
    await stubApi(page, [
      ...signedIn(),
      { method: "GET", path: /^\/v1\/offers\/o1$/, reply: () => ok({ ...OFFER, side: "BUY" }) },
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

    await page.goto("/trade/payment-methods?next=%2Ftrade%2Foffers%2Fo1");
    await page.getByLabel("Name on the account").fill("Abebe Bikila");
    await page.getByLabel("Telebirr phone number").fill("0912345678");
    await page.getByRole("button", { name: "Add payment method" }).click();

    // Back on the offer that needed it, and still being told.
    await expect(page).toHaveURL(/\/trade\/offers\/o1$/);
    const said = toastSaying(page, "Payment method added");
    await expect(said).toBeVisible();
    await expect(said).toContainText(TELEBIRR.label);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("news from the socket", () => {
  test("is said on whatever page is open, and View goes there", async ({ page, context }) => {
    await withSession(context);
    let read = 0;
    const socket = await stubSocket(page);
    await stubApi(page, [
      ...signedIn(),
      {
        method: "POST",
        path: /^\/v1\/notifications\/n1\/read$/,
        reply: () => {
          read += 1;
          return { status: 204 };
        },
      },
    ]);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    (await socket.connected).send(notification({}));

    const said = toastSaying(page, "Deposit credited");
    await expect(said).toBeVisible();
    await expect(said).toContainText("25.00 USDT is in your available balance.");
    await expect(page.getByRole("button", { name: "Notifications, 1 unread" })).toBeVisible();

    // Inside the screen on a phone: nothing past either edge.
    const box = await said.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    await expectNoHorizontalOverflow(page);

    await said.getByRole("button", { name: "View" }).click();
    await expect(page).toHaveURL(/\/wallet$/);
    // Opened from its toast is opened: the bell no longer counts it.
    await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
    expect(read).toBe(1);
  });

  test("fills the bell, whose list fits the screen", async ({ page, context }) => {
    await withSession(context);
    const socket = await stubSocket(page);
    await stubApi(page, signedIn());

    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    (await socket.connected).send(
      notification({
        type: "OFFER_HIDDEN",
        title: "Your ad is hidden from the market",
        body: "Your sell ad at 158.50 ETB is hidden: your available balance of 0.00 USDT is worth less than its smallest order of 1,000.00 ETB. Add USDT within 24 hours or the ad goes offline.",
        link: "/trade/ads",
      }),
    );

    const bell = page.getByRole("button", { name: "Notifications, 1 unread" });
    await bell.click();
    const list = page.locator(`#${(await bell.getAttribute("aria-controls")) ?? ""}`);
    await expect(list.getByText("Your ad is hidden from the market")).toBeVisible();

    // Inside the screen at every width, phone included: nothing past either edge.
    const box = await list.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    await expectNoHorizontalOverflow(page);
  });

  test("a chat message is said off its trade, and not on it", async ({ page, context }) => {
    await withSession(context);
    const socket = await stubSocket(page);
    await stubApi(page, [...signedIn(), ...orderPage(() => TRADE)]);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    const live = await socket.connected;
    live.send(chatMessage("m1", 1, "Sent it. Please check your Telebirr."));

    const said = toastSaying(page, `New message from ${ADVERTISER.username}`);
    await expect(said).toBeVisible();
    await expect(said).toContainText("Sent it. Please check your Telebirr.");
    // Into the chat itself: below lg it is a screen of its own, which this address opens.
    await said.getByRole("button", { name: "Open chat" }).click();
    await expect(page).toHaveURL(/\/orders\/t1\?chat=open$/);

    // With the chat on the screen it says the message, and nothing else does.
    await expect(page.getByText("No messages yet.", { exact: false })).toBeVisible();
    live.send(chatMessage("m2", 2, "Did it arrive?"));
    await expect(page.getByText("Did it arrive?")).toBeVisible();
    // Past the moment a toast would have been said, and counted then: an
    // expectation that retries would pass once a wrong toast faded by itself.
    await page.waitForTimeout(2_000);
    expect(await toastSaying(page, "New message").count()).toBe(0);
  });

  test("a chat message is said on its trade too, while a phone has the chat shut", async ({
    page,
    context,
  }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) >= 1024,
      "from lg up the chat is always beside the order",
    );
    await withSession(context);
    const socket = await stubSocket(page);
    await stubApi(page, [...signedIn(), ...orderPage(() => TRADE)]);

    await page.goto("/orders/t1");
    await expect(page.getByRole("button", { name: "Chat" })).toBeVisible();
    const live = await socket.connected;
    live.send(chatMessage("m1", 1, "Sent it. Please check your Telebirr."));

    // The order is open but its chat is not: without this the message would land unseen.
    const said = toastSaying(page, `New message from ${ADVERTISER.username}`);
    await expect(said).toBeVisible();
    await said.getByRole("button", { name: "Open chat" }).click();
    await expect(page).toHaveURL(/\/orders\/t1\?chat=open$/);
    const chat = page.getByRole("region", { name: "Chat" });
    await expect(chat.getByRole("textbox", { name: "Message" })).toBeVisible();

    // The order was under the chat, so the way back to it is Back.
    await chat.getByRole("button", { name: "Back to the order" }).click();
    await expect(page).toHaveURL(/\/orders\/t1$/);
    await expect(chat).toBeHidden();
  });

  test("the seller's own release is said once, not twice", async ({ page, context }) => {
    await withSession(context);
    const socket = await stubSocket(page);
    let released = false;
    const seller = () => ({
      ...TRADE,
      role: "SELLER",
      status: released ? "COMPLETED" : "BUYER_MARKED_PAID",
      paidAt: "2026-09-17T09:05:00.000Z",
      closedAt: released ? "2026-09-17T09:10:00.000Z" : null,
      payment: { ...TRADE.payment, instructions: null },
      actions: {
        ...TRADE.actions,
        canMarkPaid: false,
        canCancel: false,
        canRelease: !released,
      },
    });
    await stubApi(page, [
      ...signedIn(),
      ...orderPage(seller),
      {
        method: "POST",
        path: /^\/v1\/trades\/t1\/release$/,
        reply: () => {
          released = true;
          return ok(seller());
        },
      },
    ]);

    await page.goto("/orders/t1");
    const live = await socket.connected;
    await page.getByLabel("Your password").fill("Correct1Horse");
    await page.getByRole("button", { name: /^Release 6\.31 USDT/ }).click();
    await expect(toastSaying(page, "USDT released")).toBeVisible();

    // The server tells this account too, for its other devices.
    live.send(
      notification({
        id: "n2",
        type: "TRADE_RELEASED",
        title: "USDT sent",
        body: `You released 6.31 USDT to ${ADVERTISER.username}. The trade is complete.`,
        link: "/orders/t1",
      }),
    );
    await expect(page.getByRole("button", { name: "Notifications, 1 unread" })).toBeVisible();
    // A toast is drawn a tick after it is said; counted after that, once - an
    // expectation that retries would pass once a wrong toast faded by itself.
    await page.waitForTimeout(500);
    expect(await toastSaying(page, "USDT sent").count()).toBe(0);
    expect(await toastSaying(page, "USDT released").count()).toBe(1);
  });
});

test.describe("a picture", () => {
  test("that cannot be sent is refused before a byte leaves", async ({ page, context }) => {
    await withSession(context);
    let uploads = 0;
    await stubApi(page, [
      ...signedIn(),
      ...orderPage(() => TRADE),
      {
        method: "POST",
        path: /^\/v1\/trades\/t1\/messages\/images\//,
        reply: () => {
          uploads += 1;
          return apiError("VALIDATION_FAILED", "Send the image as a JPEG, PNG or WebP.", 400);
        },
      },
    ]);

    // By its address, the chat is on the screen at any width.
    await page.goto("/orders/t1?chat=open");
    await expect(page.getByRole("button", { name: "Send an image" })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "receipt.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7 not a picture"),
    });

    await expect(
      toastSaying(page, "That file is not a picture. Choose a JPEG, PNG or WebP image."),
    ).toBeVisible();
    expect(uploads).toBe(0);
  });
});

test.describe("a toast", () => {
  test("wears the kit's colours in both themes", async ({ page, context }) => {
    test.skip(!desktop(page), "colour does not depend on the viewport");
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      { method: "GET", path: /^\/v1\/offers\/o1$/, reply: () => ok(OFFER) },
    ]);

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/trade/offers/o1");
    await page.getByRole("button", { name: "Buy USDT" }).click();
    const said = toastSaying(page, "Enter an amount.");
    await expect(said).toBeVisible();

    const paint = () =>
      said.evaluate((toast) => {
        const style = getComputedStyle(toast);
        return { background: style.backgroundColor, text: style.color };
      });
    // Surface and ink, as globals.css has them.
    expect(await paint()).toEqual({ background: "rgb(255, 255, 255)", text: "rgb(32, 38, 34)" });

    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(paint).toEqual({ background: "rgb(26, 32, 29)", text: "rgb(233, 237, 232)" });
  });
});
