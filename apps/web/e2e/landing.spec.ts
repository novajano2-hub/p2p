import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/*
  AT-22: the landing page is accessible, keyboard navigable, renders at three
  widths, and carries no client-side money logic. The boundary half of that
  test lives in scripts/check-boundaries.mjs.
*/

/*
  Scans run under reduced motion: GSAP does nothing and the 3D scene renders a
  single frame, so contrast is measured at rest and the scan is not competing
  with a render loop. The canvas itself is decorative (aria-hidden) and excluded.
*/
async function expectNoSeriousA11yViolations(page: Page, colorScheme: "light" | "dark" = "light") {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme });
  await page.reload();
  await page.locator("[data-hero-visual][data-state='ready']").waitFor();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .exclude("canvas")
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

  test("has no serious accessibility violations", async ({ page }) => {
    test.slow();
    await expectNoSeriousA11yViolations(page);
  });

  test("stays on its single light theme under a dark-mode preference", async ({ page }) => {
    test.slow();
    await expectNoSeriousA11yViolations(page, "dark");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(246, 244, 238)");
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
    await page.waitForTimeout(1500);
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
    await summary.scrollIntoViewIfNeeded();
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(first).not.toHaveAttribute("open", "");
  });

  test("the 3D hero mounts, or falls back, without breaking the page", async ({ page }) => {
    const visual = page.locator("[data-hero-visual]");
    await expect(visual).toHaveAttribute("data-state", "ready");
    // Either a WebGL canvas or the static fallback must appear once the lazy chunk loads.
    await expect(visual.locator("canvas, .rounded-full").first()).toBeAttached({ timeout: 20_000 });
  });

  test("ledger shows the finished trade statically under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const buyer = page.locator('[data-ledger-row="buyer"] [data-amount]');
    await expect(buyer).toHaveText("250.00");
    await expect(page.getByText("USDT released", { exact: true })).toBeVisible();
  });

  test("scrolling the narrative moves the USDT from seller to buyer", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 1024,
      "the pinned narrative only runs on desktop widths",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();

    const seller = page.locator('[data-ledger-row="seller"] [data-amount]');
    const buyer = page.locator('[data-ledger-row="buyer"] [data-amount]');
    await expect(seller).toHaveText("250.00");
    await expect(buyer).toHaveText("0.00");

    await page.locator("#how-it-works").scrollIntoViewIfNeeded();
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(60);
    }
    await expect(buyer).toHaveText("250.00", { timeout: 8000 });
    await expect(seller).toHaveText("0.00");
  });

  test("uses exactly one label per call to action intent", async ({ page }) => {
    const texts = await page.getByRole("link").allTextContents();
    const signupLike = texts.filter((t) => /sign up|get started|join|register|start/i.test(t));
    expect(signupLike, "signup intent must only ever be labelled 'Create account'").toEqual([]);
  });
});
