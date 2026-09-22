import { expect, test, type Page } from "@playwright/test";

import {
  ADVERTISER,
  expectNoHorizontalOverflow,
  ok,
  signedIn,
  stubApi,
  toastSaying,
  TRADE,
  USER,
  withSession,
  type Handler,
} from "./support";

/*
  Phase 5, stage 7: Home, the Wallet and its two pages, Verify and Settings,
  redrawn. One balance card for Home and the Wallet; money in and out as one
  table with where each has got to; depositing and withdrawing as three steps
  down a line, the withdrawal confirmed - address in fours, the figures, the
  password last - before anything leaves; a screen before verification starts,
  and one after a refusal that says why; and Settings with its tabs kept and
  who you are beside them.
*/

const phone = (page: Page) => (page.viewportSize()?.width ?? 0) < 640;
const desk = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

const USDT = 1_000_000;
const BALANCE = {
  asset: "USDT",
  available: String(1_000 * USDT),
  escrowed: String(200 * USDT),
  pendingWithdrawal: String(50 * USDT),
  total: String(1_250 * USDT),
};

const ADDRESS = "0x9c41B7e2A05d83F6c1E7b94D2a68F3C05e71D2a4";
const TO = "0x51Bc07A9e3F2d864C0b17E5a92Dd40cF8361aE7b";

// Noon UTC, so the day reads the same in every time zone a test machine might be in.
const DEPOSITS = [
  {
    id: "d1",
    network: "BEP20",
    txHash: "0x3f8a1c2b9d4e5f60718293a4b5c6d7e8f9012345678901234567890123459a2c",
    amount: String(500 * USDT),
    status: "CONFIRMING",
    confirmations: 9,
    confirmationsRequired: 15,
    detectedAt: "2026-09-21T12:00:00.000Z",
    creditedAt: null,
  },
  {
    id: "d2",
    network: "BEP20",
    txHash: "0xaa11bb22cc33dd44ee55ff66007788990011223344556677889900aabbcc07de",
    amount: String(750 * USDT),
    status: "CREDITED",
    confirmations: 15,
    confirmationsRequired: 15,
    detectedAt: "2026-09-19T12:00:00.000Z",
    creditedAt: "2026-09-19T12:02:00.000Z",
  },
];

const withdrawal = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  network: "BEP20",
  asset: "USDT",
  amount: String(50 * USDT),
  fee: String(1 * USDT),
  destination: TO,
  stage: "HELD",
  txHash: null,
  confirmations: 0,
  confirmationsRequired: 15,
  message: null,
  cancellable: true,
  requestedAt: "2026-09-20T12:00:00.000Z",
  settledAt: null,
  ...overrides,
});

const LIMITS = {
  network: "BEP20",
  asset: "USDT",
  minimum: String(10 * USDT),
  maximum: String(5_000 * USDT),
  dailyMaximum: String(2_000 * USDT),
  dailyRemaining: String(1_750 * USDT),
  available: String(1_000 * USDT),
  fee: String(1 * USDT),
};

/** What every wallet screen reads, as the stub has it. */
const wallet = (withdrawals: () => object[] = () => [withdrawal("w1")]): Handler[] => [
  { method: "GET", path: /^\/v1\/wallet\/balance$/, reply: () => ok(BALANCE) },
  { method: "GET", path: /^\/v1\/wallet\/deposits$/, reply: () => ok({ deposits: DEPOSITS }) },
  {
    method: "GET",
    path: /^\/v1\/wallet\/withdrawals$/,
    reply: () => ok({ withdrawals: withdrawals() }),
  },
  { method: "GET", path: /^\/v1\/wallet\/withdrawals\/limits$/, reply: () => ok(LIMITS) },
  {
    method: "GET",
    path: /^\/v1\/wallet\/deposit-address$/,
    reply: () =>
      ok({
        network: "BSC",
        standard: "BEP20",
        asset: "USDT",
        address: ADDRESS,
        confirmationsRequired: 15,
        minimumDeposit: String(1 * USDT),
      }),
  },
];

/** How far the bar pinned on a phone sits from the tab bar under it: nothing should show between. */
const slitAbove = (page: Page, buttonName: string) =>
  page.evaluate((name) => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    let bar: Element | null = button ?? null;
    while (bar && getComputedStyle(bar).position !== "fixed") bar = bar.parentElement;
    const tabs = [...document.querySelectorAll('nav[aria-label="Primary"]')].find(
      (nav) => nav.getBoundingClientRect().height > 0,
    );
    if (!bar || !tabs) return null;
    return tabs.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
  }, buttonName);

test.describe("home", () => {
  test("says who you are, what you have, what wants you, and what happened", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn(),
      ...wallet(),
      {
        method: "GET",
        path: /^\/v1\/trades$/,
        reply: () =>
          ok({
            trades: [{ ...TRADE, chat: { lastSeq: 3, unread: 2, closesAt: null } }],
            nextCursor: null,
          }),
      },
      { method: "GET", path: /^\/v1\/offers$/, reply: () => ok({ offers: [], nextCursor: null }) },
    ]);

    await page.goto("/account");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(USER.username);
    // The account number to hand to someone, and where verification stands, always there.
    await expect(page.getByText(USER.platformId).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Unverified" })).toHaveAttribute("href", "/verify");

    const balance = page.getByRole("region", { name: "Balance" });
    await expect(balance).toContainText("1,250.00");
    await expect(balance).toContainText("1,000.00");
    await expect(balance.getByRole("link", { name: "Deposit" })).toHaveAttribute(
      "href",
      "/wallet/deposit",
    );
    // Hidden means hidden everywhere on the card.
    await balance.getByRole("button", { name: "Hide balance" }).click();
    await expect(balance).not.toContainText("1,250.00");
    await balance.getByRole("button", { name: "Show balance" }).click();

    // The order says what it wants, and its chat what is unread.
    const orders = page.getByRole("region", { name: "Orders in progress" });
    await expect(orders.getByRole("link", { name: "Pay now" })).toHaveAttribute(
      "href",
      "/orders/t1",
    );
    await expect(
      orders.getByRole("link", { name: `Chat with ${ADVERTISER.username}, 2 unread` }),
    ).toHaveAttribute("href", "/orders/t1?chat=open");

    // Recent activity was an empty box for as long as it existed.
    const recent = page.getByRole("region", { name: "Recent activity" });
    await expect(recent.getByRole("listitem")).toHaveCount(3);
    await expect(recent).toContainText("Confirming");
    await expect(recent).toContainText("Being checked");

    await expect(
      page.getByRole("link", { name: /^Post an ad/ }).filter({ visible: true }),
    ).toHaveAttribute("href", "/trade/ads/new");
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("the wallet", () => {
  test("is one balance and one table, narrowed by a tab, with a withdrawal that can be called off", async ({
    page,
    context,
  }) => {
    await withSession(context);
    let cancelled = false;
    await stubApi(page, [
      ...signedIn(),
      ...wallet(() => [
        cancelled ? withdrawal("w1", { stage: "RETURNED", cancellable: false }) : withdrawal("w1"),
      ]),
      {
        method: "POST",
        path: /^\/v1\/wallet\/withdrawals\/w1\/cancel$/,
        reply: () => {
          cancelled = true;
          return ok(withdrawal("w1", { stage: "RETURNED", cancellable: false }));
        },
      },
    ]);

    await page.goto("/wallet");
    const balance = page.getByRole("region", { name: "Balance" });
    await expect(balance).toContainText("1,250.00");
    // Transfers are not open: said, not hidden, and not pressable.
    await expect(balance.getByRole("button", { name: /Transfer/ })).toBeDisabled();
    // The three cards and the one-row table that said the same things again are gone.
    await expect(page.getByRole("list", { name: "Move funds" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Assets" })).toHaveCount(0);

    const activity = page.getByRole("region", { name: "Activity" });
    const rows = activity.getByRole("group", { name: "Activity" }).getByRole("listitem");
    await expect(rows).toHaveCount(3);
    // A deposit the network is still counting: the figure, and the same thing as a bar.
    await expect(rows.first()).toContainText("9 / 15 confirmations");
    await expect(rows.first().getByRole("progressbar", { name: "Confirmations" })).toBeVisible();
    // A settled one carries its transaction, short, whole when copied.
    await expect(
      rows.nth(2).getByRole("button", { name: "Copy the transaction hash" }),
    ).toBeVisible();

    await activity.getByRole("tab", { name: "Deposits" }).click();
    await expect(rows).toHaveCount(2);
    await activity.getByRole("tab", { name: "Withdrawals" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Being checked");

    await rows.first().getByRole("button", { name: "Cancel" }).click();
    await expect(toastSaying(page, "Withdrawal cancelled")).toBeVisible();
    await expect(rows.first()).toContainText("Returned");
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("depositing", () => {
  test("is three steps down a line, with the warning read before the address is copied", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, [...signedIn(), ...wallet()]);

    await page.goto("/wallet/deposit");
    const steps = page.getByRole("list", { name: "How to deposit" });
    await expect(steps.getByRole("heading", { level: 2 })).toHaveText([
      "Coin",
      "Network",
      "Deposit address",
    ]);
    await expect(steps).toContainText(ADDRESS);
    await expect(steps.getByRole("button", { name: "Copy deposit address" })).toHaveText(
      "Copy address",
    );
    await expect(steps).toContainText("15 confirmations");

    // The networks that are coming are in the list, refused rather than missing.
    await steps.getByRole("combobox", { name: "Network" }).click();
    await expect(page.getByRole("option", { name: /Tron/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByRole("option", { name: /BNB Smart Chain/ }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);

    const warning = page.getByText("Send only USDT on BNB Smart Chain (BEP20).");
    await expect(warning).toBeVisible();
    if (!desk(page)) {
      // On a phone it comes first: above the address, not after it.
      const [warned, shown] = await Promise.all([
        warning.boundingBox(),
        page.getByText(ADDRESS).boundingBox(),
      ]);
      expect(warned?.y ?? 0).toBeLessThan(shown?.y ?? 0);
    }

    await expect(
      page.getByRole("region", { name: "Recent deposits" }).getByRole("listitem"),
    ).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("withdrawing", () => {
  test("is confirmed before anything leaves: the address in fours, the figures, the password last", async ({
    page,
    context,
  }) => {
    await withSession(context);
    const sent: unknown[] = [];
    await stubApi(page, [
      ...signedIn(),
      ...wallet(() => []),
      {
        method: "POST",
        path: /^\/v1\/wallet\/withdrawals$/,
        reply: (route, calls) => {
          sent.push(route.request().postDataJSON());
          return calls === 1
            ? {
                status: 400,
                body: {
                  error: {
                    code: "VALIDATION_FAILED",
                    message: "The request is not valid.",
                    correlationId: "test",
                    details: [{ path: "password", message: "That password is not right." }],
                  },
                },
              }
            : ok(withdrawal("w9", { amount: String(250 * USDT), stage: "PENDING" }), 201);
        },
      },
    ]);

    await page.goto("/wallet/withdraw");
    const steps = page.getByRole("list", { name: "How to withdraw" });
    await expect(steps.getByRole("heading", { level: 2 })).toHaveText([
      "Coin",
      "Send to",
      "Amount",
    ]);

    // Nothing to confirm yet: the first press says what is missing, and opens nothing.
    const withdraw = page.getByRole("button", { name: "Withdraw", exact: true });
    await withdraw.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "That is not a valid address for this network" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Confirm withdrawal" })).toHaveCount(0);

    await steps.getByLabel("Address").fill(TO);
    await steps.getByLabel("How much USDT").fill("250");
    await expect(page.getByText("249.00").first()).toBeVisible();
    if (!desk(page)) {
      const slit = await slitAbove(page, "Withdraw");
      expect(Math.abs(slit ?? 99)).toBeLessThanOrEqual(0.5);
    }
    await withdraw.click();

    const confirm = page.getByRole("dialog", { name: "Confirm withdrawal" });
    await expect(confirm).toContainText("0x51 Bc07 A9e3");
    await expect(confirm).toContainText("BNB Smart Chain (BEP20)");
    await expect(confirm).toContainText("250.00 USDT");
    await expect(confirm).toContainText("249.00 USDT");
    await expect(confirm).toContainText("cannot be reversed");
    expect(sent).toHaveLength(0);

    // A wrong password is said where the password is, and the confirmation stays.
    await confirm.getByLabel("Your password").fill("not-it");
    await confirm.getByRole("button", { name: "Confirm and withdraw" }).click();
    await expect(confirm.getByText("That password is not right.")).toBeVisible();

    await confirm.getByLabel("Your password").fill("Correct1Horse");
    await confirm.getByRole("button", { name: "Confirm and withdraw" }).click();
    await expect(toastSaying(page, "Withdrawal requested")).toBeVisible();
    await expect(confirm).toBeHidden();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      network: "BSC",
      amount: String(250 * USDT),
      destination: TO,
      password: "Correct1Horse",
    });
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("verification", () => {
  const kyc = (status: string, rejectionReason: string | null = null): Handler => ({
    method: "GET",
    path: /^\/v1\/kyc$/,
    reply: () =>
      ok({ status, submittedAt: null, reviewedAt: null, rejectionReason, documents: [] }),
  });

  test("says what it needs and what it is for before it asks for anything", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, [...signedIn(), kyc("NOT_STARTED")]);

    await page.goto("/verify");
    await expect(
      page.getByRole("heading", { level: 1, name: "Verify your identity" }),
    ).toBeVisible();
    await expect(page.getByText("An identity document")).toBeVisible();
    await expect(page.getByText("A selfie holding it")).toBeVisible();
    await expect(page.getByText("Post your own offers").filter({ visible: true })).toBeVisible();
    if (!desk(page)) {
      const slit = await slitAbove(page, "Start");
      expect(Math.abs(slit ?? 99)).toBeLessThanOrEqual(0.5);
    }
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Which document will you photograph?")).toBeVisible();
    // Where you are: five names on a desk, one line and a bar on a phone.
    if (phone(page)) {
      await expect(page.getByText("Step 1 of 5 · Document")).toBeVisible();
      await expect(page.getByRole("progressbar", { name: "Verification progress" })).toBeVisible();
    } else {
      await expect(page.getByRole("listitem").filter({ hasText: "Your details" })).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
  });

  test("after a refusal, says what the reviewer found and offers one way forward", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, [
      ...signedIn({ ...USER, kycStatus: "REJECTED" }),
      kyc("REJECTED", "The name you typed does not match the name on the document."),
    ]);

    await page.goto("/verify");
    await expect(
      page.getByRole("heading", { level: 1, name: "We could not verify your identity" }),
    ).toBeVisible();
    await expect(
      page.getByText("The name you typed does not match the name on the document."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Which document will you photograph?")).toBeVisible();
  });

  test("under review, says where it has got to", async ({ page, context }) => {
    await withSession(context);
    await stubApi(page, [...signedIn({ ...USER, kycStatus: "PENDING" }), kyc("PENDING")]);

    await page.goto("/verify");
    await expect(page.getByRole("heading", { level: 2, name: "Under review" })).toBeVisible();
    const stages = page.getByRole("listitem");
    await expect(stages.filter({ hasText: "A person is checking it" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("settings", () => {
  test("keeps its tabs, with who you are beside them and payment methods a press away", async ({
    page,
    context,
  }) => {
    await withSession(context);
    await stubApi(page, signedIn());

    await page.goto("/settings");
    const who = page.getByRole("region", { name: "Your account" });
    await expect(who).toContainText(USER.username);
    await expect(who).toContainText(USER.email);
    await expect(who.getByRole("button", { name: "Copy account number" })).toBeVisible();

    const tabs = page.getByRole("tablist", { name: "Settings sections" });
    await expect(tabs.getByRole("tab")).toHaveText([
      "Profile",
      "Appearance",
      "Account",
      "Security",
      "Session",
    ]);
    await expect(page.getByLabel("Username")).toHaveValue(USER.username);

    await tabs.getByRole("tab", { name: "Account" }).click();
    await expect(page.getByText("Identity verification")).toBeVisible();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("link", { name: "Verify", exact: true })).toHaveAttribute(
      "href",
      "/verify",
    );
    // They live under Trade; this is where a person looks for them.
    await expect(panel.getByText("Payment methods")).toBeVisible();
    await expect(panel.getByRole("link", { name: "Manage" })).toHaveAttribute(
      "href",
      "/trade/payment-methods",
    );

    await tabs.getByRole("tab", { name: "Security" }).click();
    await expect(page.getByRole("link", { name: "Change password" })).toBeVisible();
    await expect(page.getByText("Not available yet")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
