import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, ok, signedIn, stubApi, TRADE, withSession } from "./support";

/*
  An order carries the advertiser's terms as they were when it opened. The ad
  may be edited afterwards - or closed - and this is what was agreed to.
*/

test("an order shows the terms it was taken under", async ({ page, context }) => {
  await withSession(context);
  await stubApi(page, [
    ...signedIn(),
    { method: "GET", path: /^\/v1\/trades\/t1$/, reply: () => ok(TRADE) },
    { method: "GET", path: /^\/v1\/trades\/t1\/events$/, reply: () => ok({ events: [] }) },
    {
      method: "GET",
      path: /^\/v1\/trades\/t1\/messages$/,
      reply: () =>
        ok({ messages: [], lastSeq: 0, myLastReadSeq: 0, theirLastReadSeq: 0, open: true }),
    },
  ]);

  await page.goto("/orders/t1");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Buy 6.31 USDT");
  const terms = page.getByRole("region", { name: "The advertiser's terms" });
  await expect(terms).toContainText("No third-party payments");
  await expect(terms).toContainText("As they stood when this order opened");
  await expectNoHorizontalOverflow(page);
});
