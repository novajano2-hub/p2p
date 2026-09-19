import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  ok,
  signedIn,
  stubApi,
  toastSaying,
  withSession,
} from "./support";

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

test("there is one account for each type: a taken type says so, and the next free one is ready", async ({
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
  await page.getByRole("button", { name: "Add a payment method" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a payment method" });
  await expect(sheet).toBeVisible();

  // Telebirr, CBE and Abyssinia have accounts: shown, and not to be picked.
  await expect(sheet.getByRole("radio", { name: "Telebirr Added" })).toBeDisabled();
  await expect(sheet.getByRole("radio", { name: "CBE Added", exact: true })).toBeDisabled();
  await expect(sheet.getByRole("radio", { name: "Bank of Abyssinia Added" })).toBeDisabled();
  // The first type without one is already chosen, and the form asks for its number.
  await expect(sheet.getByRole("radio", { name: "CBE Birr" })).toBeChecked();
  await expect(sheet.getByLabel("CBE Birr phone number")).toBeVisible();
  await expect(sheet).toContainText("One account for each type.");
  await expectNoHorizontalOverflow(page);
});

test("replacing an account keeps its type, and says what happens to the ads", async ({
  page,
  context,
}) => {
  await withSession(context);
  let sent: unknown = null;
  let methods = METHODS;
  await stubApi(page, [
    ...signedIn(),
    {
      method: "GET",
      path: /^\/v1\/payment-methods$/,
      reply: () => ok({ paymentMethods: methods }),
    },
    {
      method: "POST",
      path: /^\/v1\/payment-methods\/pm1\/replace$/,
      reply: (route) => {
        sent = route.request().postDataJSON();
        const fresh = method("pm9", "TELEBIRR", "Telebirr ····1111");
        methods = [fresh, ...METHODS.slice(1)];
        return ok(fresh);
      },
    },
  ]);

  await page.goto("/trade/payment-methods");
  await page.getByRole("button", { name: "Replace Telebirr ····5678" }).click();
  const sheet = page.getByRole("dialog", { name: "Replace your Telebirr account" });
  await expect(sheet).toBeVisible();
  // The type is not a choice here, and the sheet says what becomes of the old account.
  await expect(sheet.getByRole("radio")).toHaveCount(0);
  await expect(sheet).toContainText("your ads that used it will use the new account");
  await expectNoHorizontalOverflow(page);

  await sheet.getByLabel("Name on the account").fill("Abebe Bikila");
  await sheet.getByLabel("Telebirr phone number").fill("0911111111");
  await sheet.getByRole("button", { name: "Replace account" }).click();

  await expect(toastSaying(page, "Payment method replaced")).toBeVisible();
  await expect(sheet).toBeHidden();
  expect(sent).toEqual({ kind: "TELEBIRR", accountHolder: "Abebe Bikila", phone: "0911111111" });
  // In the list, the new account where the old one was. (The toast names it too.)
  const cards = page.getByRole("main").getByRole("listitem");
  await expect(cards.filter({ hasText: "Telebirr ····1111" })).toBeVisible();
  await expect(cards.filter({ hasText: "Telebirr ····5678" })).toHaveCount(0);
});
