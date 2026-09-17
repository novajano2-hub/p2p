import { expect, test, type Page } from "@playwright/test";

import { ok, signedIn, stubApi, withSession } from "./support";

/*
  The select drawn from our own tokens (components/ui/select.tsx), on the
  payment-methods form, where choosing a bank changes what the form asks
  for next. A desktop gets a panel and the keyboard; a phone gets a sheet.
*/

const desktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const mobile = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

const WALLETS = ["Telebirr", "CBE Birr", "M-Pesa"];
const BANKS = ["CBE", "Dashen Bank", "Bank of Abyssinia", "Awash Bank"];

test.beforeEach(async ({ page, context }) => {
  await withSession(context);
  await stubApi(page, [
    ...signedIn(),
    { method: "GET", path: /^\/v1\/payment-methods$/, reply: () => ok({ paymentMethods: [] }) },
  ]);
  await page.goto("/trade/payment-methods");
});

test.describe("the select", () => {
  test("lists the wallets and the four banks, and a bank asks for an account number", async ({
    page,
  }) => {
    test.skip(!desktop(page), "the panel is the desktop's; the phone's sheet has its own test");
    const type = page.getByRole("combobox", { name: "Type" });
    await expect(type).toHaveText("Telebirr");
    await expect(page.getByLabel("Telebirr phone number")).toBeVisible();

    await type.click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await expect(list.getByRole("option")).toHaveText([...WALLETS, ...BANKS]);
    await expect(list.getByRole("option", { name: "Telebirr" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await list.getByRole("option", { name: "Awash Bank" }).click();
    await expect(list).toBeHidden();
    await expect(type).toHaveText("Awash Bank");
    await expect(page.getByLabel("Account number")).toBeVisible();
    await expect(page.getByLabel("Telebirr phone number")).toBeHidden();
    // Focus comes back to the field, so the keyboard carries on from here.
    await expect(type).toBeFocused();
  });

  test("works from the keyboard the way a native select does", async ({ page }) => {
    test.skip(!desktop(page), "one viewport is enough for the keyboard");
    const type = page.getByRole("combobox", { name: "Type" });
    await type.focus();

    // Arrow down opens it on the current choice; End goes to the last; Enter takes it.
    await type.press("ArrowDown");
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await expect(list.getByRole("option", { name: "Telebirr" })).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.keyboard.press("End");
    await expect(list.getByRole("option", { name: "Awash Bank" })).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.keyboard.press("Enter");
    await expect(list).toBeHidden();
    await expect(type).toHaveText("Awash Bank");

    // Escape leaves without choosing.
    await type.press("ArrowDown");
    await expect(list).toBeVisible();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(type).toHaveText("Awash Bank");

    // Typing while closed jumps, as a native select does.
    await type.press("d");
    await expect(type).toHaveText("Dashen Bank");
    await expect(page.getByLabel("Account number")).toBeVisible();
  });

  test("comes up as a sheet on a phone", async ({ page }) => {
    test.skip(!mobile(page), "the sheet is the phone's");
    const type = page.getByRole("combobox", { name: "Type" });
    await type.click();

    const sheet = page.getByRole("dialog", { name: "Type" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("option")).toHaveCount(7);
    // The page behind it does not scroll.
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await sheet.getByRole("option", { name: "Dashen Bank" }).click();
    await expect(sheet).toBeHidden();
    await expect(type).toHaveText("Dashen Bank");
    await expect(page.getByLabel("Account number")).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });
});
