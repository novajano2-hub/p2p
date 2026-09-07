import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/*
  AT-22: the landing page is accessible, keyboard navigable, renders at three
  widths, and carries no client-side money logic. The boundary half of that
  test lives in scripts/check-boundaries.mjs.
*/

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test.describe("landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("has no serious accessibility violations in light mode", async ({ page }) => {
    await expectNoSeriousA11yViolations(page);
  });

  test("has no serious accessibility violations in dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expectNoSeriousA11yViolations(page);
  });

  test("hero headline and primary action are visible without scrolling", async ({ page }) => {
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    const cta = page.getByRole("main").getByRole("link", { name: "Create account" }).first();
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test("never scrolls horizontally", async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("is fully keyboard navigable and starts with a skip link", async ({ page }) => {
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);

    // Every interactive element must be reachable and named.
    const unnamed = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("a, button, summary"));
      return nodes
        .filter((el) => el.offsetParent !== null)
        .filter((el) => !(el.getAttribute("aria-label") || el.textContent || "").trim())
        .map((el) => el.outerHTML.slice(0, 120));
    });
    expect(unnamed).toEqual([]);
  });

  test("FAQ items open and close from the keyboard", async ({ page }) => {
    const first = page.locator("details.faq-item").first();
    const summary = first.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(first).not.toHaveAttribute("open", "");
  });

  test("trade preview renders the final state statically under reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const status = page.getByRole("status");
    await expect(status).toHaveText("USDT released to buyer");
    await page.waitForTimeout(3500);
    await expect(status).toHaveText("USDT released to buyer");
  });

  test("trade preview cycles through escrow states when motion is allowed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();
    const status = page.getByRole("status");
    await expect(status).toHaveText("USDT locked in escrow");
    await expect(status).toHaveText("Birr sent, marked paid", { timeout: 6000 });
  });

  test("uses exactly one label per call to action intent", async ({ page }) => {
    const texts = await page.getByRole("link").allTextContents();
    const signupLike = texts.filter((t) => /sign up|get started|join|register|start/i.test(t));
    expect(signupLike, "signup intent must only ever be labelled 'Create account'").toEqual([]);
  });
});
