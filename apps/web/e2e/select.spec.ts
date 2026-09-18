import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, ok, signedIn, stubApi, withSession } from "./support";

/*
  The select drawn from our own tokens (components/ui/select.tsx), on the
  market's payment filter, where choosing a bank asks the market for the ads
  paid through it. A desktop gets a panel and the keyboard; a phone gets a
  sheet.
*/

const desktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const mobile = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

const ALL = "All payment methods";
const WALLETS = ["Telebirr", "CBE Birr", "M-Pesa"];
const BANKS = ["CBE", "Dashen Bank", "Bank of Abyssinia", "Awash Bank"];

let asked: string[] = [];

test.beforeEach(async ({ page, context }) => {
  asked = [];
  await withSession(context);
  await stubApi(page, [
    ...signedIn(),
    {
      method: "GET",
      path: /^\/v1\/offers$/,
      reply: (route) => {
        asked.push(new URL(route.request().url()).search);
        return ok({ offers: [], nextCursor: null });
      },
    },
  ]);
  await page.goto("/trade");
});

test.describe("the select", () => {
  test("lists every way to pay, and a bank narrows the market to it", async ({ page }) => {
    test.skip(!desktop(page), "the panel is the desktop's; the phone's sheet has its own test");
    const type = page.getByRole("combobox", { name: "Payment method" });
    await expect(type).toHaveText(ALL);

    await type.click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await expect(list.getByRole("option")).toHaveText([ALL, ...WALLETS, ...BANKS]);
    await expect(list.getByRole("option", { name: ALL })).toHaveAttribute("aria-selected", "true");

    await expectNoHorizontalOverflow(page);
    await list.getByRole("option", { name: "Awash Bank" }).click();
    await expect(list).toBeHidden();
    await expect(type).toHaveText("Awash Bank");
    await expect.poll(() => asked.at(-1)).toContain("paymentKind=AWASH");
    await expectNoHorizontalOverflow(page);
    // Focus comes back to the field, so the keyboard carries on from here.
    await expect(type).toBeFocused();
  });

  test("works from the keyboard the way a native select does", async ({ page }) => {
    test.skip(!desktop(page), "one viewport is enough for the keyboard");
    const type = page.getByRole("combobox", { name: "Payment method" });
    await type.focus();

    // Arrow down opens it on the current choice; End goes to the last; Enter takes it.
    await type.press("ArrowDown");
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await expect(list.getByRole("option", { name: ALL })).toHaveAttribute("data-active", "true");
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
    await expect.poll(() => asked.at(-1)).toContain("paymentKind=DASHEN");
  });

  test("comes up as a sheet on a phone", async ({ page }) => {
    test.skip(!mobile(page), "the sheet is the phone's");
    const type = page.getByRole("combobox", { name: "Payment method" });
    await type.click();

    const sheet = page.getByRole("dialog", { name: "Payment method" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("option")).toHaveCount(8);
    // The page behind it does not scroll.
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await expectNoHorizontalOverflow(page);
    await sheet.getByRole("option", { name: "Dashen Bank" }).click();
    await expect(sheet).toBeHidden();
    await expect(type).toHaveText("Dashen Bank");
    await expect.poll(() => asked.at(-1)).toContain("paymentKind=DASHEN");
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });
});
