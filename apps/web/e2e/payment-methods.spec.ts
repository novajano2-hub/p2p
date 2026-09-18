import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, ok, signedIn, stubApi, withSession } from "./support";

/*
  The payment-methods page with methods on it - the state it is in for almost
  everybody who has used the app once. A row carries a colour bar, a name, an
  institution and a Remove that turns into a question, and all of it has to
  fit a phone.
*/

const method = (id: string, kind: string, label: string) => ({
  id,
  kind,
  label,
  hint: label.slice(-4),
  status: "ACTIVE",
  createdAt: "2026-09-17T09:00:00.000Z",
});

const METHODS = [
  method("pm1", "TELEBIRR", "Telebirr ····5678"),
  method("pm2", "CBE", "CBE ····6789"),
  method("pm3", "ABYSSINIA", "Bank of Abyssinia ····0193"),
];

test("a list of methods fits the screen, with a removal being confirmed", async ({
  page,
  context,
}) => {
  await withSession(context);
  await stubApi(page, [
    ...signedIn(),
    {
      method: "GET",
      path: /^\/v1\/payment-methods$/,
      reply: () => ok({ paymentMethods: METHODS }),
    },
  ]);

  await page.goto("/trade/payment-methods");
  await expect(page.getByText("Bank of Abyssinia ····0193")).toBeVisible();
  await expect(page.getByText("Commercial Bank of Ethiopia")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Asking "Remove it?" puts two more buttons in the row.
  await page.getByRole("button", { name: "Remove" }).last().click();
  await expect(page.getByText("Remove it?")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
