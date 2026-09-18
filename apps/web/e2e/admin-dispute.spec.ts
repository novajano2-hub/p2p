import { expect, test } from "@playwright/test";

import { adminSignedIn, expectNoHorizontalOverflow, ok, stubApi } from "./support";

/*
  The resolver's screen. What it has to show, beyond the money and the chat,
  is the terms the order was taken under: an advertiser who rewrites their ad
  after a dispute opens must not be able to rewrite what was agreed to.
*/

const CUSTOMER = {
  userId: "u1",
  platformId: "BQ-48213967",
  username: "user_48213967",
  email: "buyer@example.com",
  status: "ACTIVE",
  kycStatus: "APPROVED",
};

const PARTY = { customer: CUSTOMER, tradesTotal: 3, tradesCompleted: 3, tradesFailed: 0 };

const DISPUTE = {
  id: "d1",
  status: "OPEN",
  reason: "PAYMENT_NOT_RELEASED",
  description: "I paid an hour ago and sent the receipt.",
  openedBy: "BUYER",
  outcome: null,
  resolutionNote: null,
  resolvedByEmail: null,
  evidenceCount: 0,
  createdAt: "2026-09-17T09:10:00.000Z",
  withdrawnAt: null,
  resolvedAt: null,
  correlationId: "corr-1",
  trade: {
    id: "t1",
    offerSide: "SELL",
    status: "DISPUTED",
    amount: "40000000",
    fee: "0",
    priceSantim: "15850",
    fiatSantim: "634000",
    paymentKind: "TELEBIRR",
    paymentLabel: "Telebirr ····5678",
    paymentReference: "FT-2409-1123",
    createdAt: "2026-09-17T09:00:00.000Z",
    paidAt: "2026-09-17T09:05:00.000Z",
    paymentDeadline: "2026-09-17T09:30:00.000Z",
    closedAt: null,
    closeReason: null,
  },
  buyer: PARTY,
  seller: { ...PARTY, customer: { ...CUSTOMER, userId: "u2", email: "seller@example.com" } },
  terms: "Pay from an account in your own name. No third parties.",
  payment: {
    kind: "TELEBIRR",
    label: "Telebirr ····5678",
    instructions: {
      kind: "TELEBIRR",
      accountHolder: "Abebe Bikila",
      accountNumber: "0912345678",
    },
  },
  evidence: [],
  messages: [],
  events: [],
};

test("the resolver reads the terms the order was taken under", async ({ page }) => {
  await stubApi(page, [
    ...adminSignedIn({ roles: ["DISPUTE_RESOLVER"] }),
    { method: "GET", path: /^\/v1\/admin\/disputes\/d1$/, reply: () => ok(DISPUTE) },
  ]);

  await page.goto("/admin/disputes/d1");

  const terms = page.getByRole("region", { name: "The advertiser's terms" });
  await expect(terms).toContainText("No third parties");
  await expect(terms).toContainText("As they stood when the order opened");
  await expectNoHorizontalOverflow(page);
});
