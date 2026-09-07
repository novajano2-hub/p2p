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
  // The hero visual is desktop-only, so wait on the headline, which exists at every width.
  await page.getByRole("heading", { level: 1 }).waitFor();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .exclude("canvas")
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

/** Waits for `scroll-behavior: smooth` to finish, so positions are measured at rest. */
async function waitForScrollToSettle(page: Page) {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        let last = window.scrollY;
        let still = 0;
        const tick = () => {
          if (window.scrollY === last) {
            if (++still >= 3) return resolve(true);
          } else {
            still = 0;
            last = window.scrollY;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    undefined,
    { timeout: 10_000 },
  );
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

  test("the 3D hero mounts on desktop and is absent below it", async ({ page }) => {
    const visual = page.locator("[data-hero-visual]");
    const desktop = (page.viewportSize()?.width ?? 0) >= 1024;

    if (!desktop) {
      // Below lg the scene must not render at all, and nothing 3D may be fetched.
      await expect(visual).toBeHidden();
      await expect(page.locator("canvas")).toHaveCount(0);
      return;
    }

    await expect(visual).toHaveAttribute("data-state", "ready");
    // Either a WebGL canvas or the static fallback must appear once the lazy chunk loads.
    await expect(visual.locator("canvas, .rounded-full").first()).toBeAttached({ timeout: 20_000 });
  });

  test("the ledger card is shown only where it can sit beside the steps", async ({ page }) => {
    const card = page.locator("[data-ledger-card]");
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await expect(card).toBeVisible();
    } else {
      await expect(card).toBeHidden();
    }
  });

  test("ledger shows the finished trade statically under reduced motion", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, "the card is desktop-only");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const buyer = page.locator('[data-ledger-row="buyer"] [data-amount]');
    await expect(buyer).toHaveText("250.00");
    await expect(page.locator('[data-ledger-status="released"]')).toBeVisible();
  });

  test("scrolling the steps moves the USDT from seller to buyer", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, "the card is desktop-only");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();

    const seller = page.locator('[data-ledger-row="seller"] [data-amount]');
    const buyer = page.locator('[data-ledger-row="buyer"] [data-amount]');
    await expect(seller).toHaveText("250.00");
    await expect(buyer).toHaveText("0.00");

    // Ordinary scrolling only: nothing is pinned and the scrollbar is never taken over.
    await page.locator("#how-it-works [data-step]").last().scrollIntoViewIfNeeded();
    await expect(buyer).toHaveText("250.00", { timeout: 8000 });
    await expect(seller).toHaveText("0.00");
  });

  test("the how-it-works section never pins or hijacks the scroll", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();
    await page.locator("#how-it-works").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    // A pinned section leaves a pin-spacer and fixes its stage; neither may exist.
    expect(await page.locator(".pin-spacer").count()).toBe(0);
    const stagePositions = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#how-it-works *"))
        .map((el) => getComputedStyle(el).position)
        .filter((p) => p === "fixed"),
    );
    expect(stagePositions).toEqual([]);
  });

  test("every nav anchor jumps to its section on the first click", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, "the desktop nav is hidden below lg");

    // The first hash click on a freshly loaded page is the one that used to
    // land at the top of the document instead of at the section.
    for (const [label, id] of [
      ["How it works", "how-it-works"],
      ["Fees", "fees"],
      ["Safety", "safety"],
      ["FAQ", "faq"],
    ] as const) {
      await page.goto("/");
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: label, exact: true })
        .click();

      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await waitForScrollToSettle(page);

      const { top, atEnd } = await page.locator(`#${id}`).evaluate((el) => ({
        top: el.getBoundingClientRect().top,
        // A section near the document end cannot reach the top of the viewport,
        // because there is nothing left to scroll past it.
        atEnd: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
      }));

      expect(
        atEnd || Math.abs(top - 88) < 24,
        `#${id} landed at ${Math.round(top)}px: the first click did not reach it`,
      ).toBe(true);
      // Either way it has to be on screen, which is exactly what the bug broke.
      expect(top, `#${id} should be in view`).toBeLessThan(900);
    }
  });

  test("uses exactly one label per call to action intent", async ({ page }) => {
    const texts = await page.getByRole("link").allTextContents();
    const signupLike = texts.filter((t) => /sign up|get started|join|register|start/i.test(t));
    expect(signupLike, "signup intent must only ever be labelled 'Create account'").toEqual([]);
  });
});
