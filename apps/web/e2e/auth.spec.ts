import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/*
  The sign-up, log-in, recovery and legal pages. These are previews (no
  account service yet), so the tests assert the flows can be walked, that
  every final action fails honestly with the not-connected error, and that
  nothing on the landing page links to a dead route any more.
*/

const desktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const mobile = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test.describe("dead links", () => {
  test("every internal link on the landing page resolves", async ({ page, request }) => {
    await page.goto("/");
    const hrefs = await page.evaluate(() =>
      Array.from(
        new Set(
          Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')).map(
            (a) => a.getAttribute("href") ?? "",
          ),
        ),
      ),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const response = await request.get(href);
      expect(response.status(), `${href} must not be a dead link`).toBeLessThan(400);
    }
  });
});

test.describe("accessibility", () => {
  for (const path of ["/register", "/login"]) {
    test(`${path} passes axe in light and dark`, async ({ page }) => {
      test.skip(!desktop(page) && !mobile(page), "desktop and mobile cover the layouts");
      test.slow();
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      await page.emulateMedia({ colorScheme: "dark" });
      await page.reload();
      await expectNoSeriousA11yViolations(page);
    });
  }

  for (const path of ["/recover", "/terms", "/privacy"]) {
    test(`${path} renders and passes axe`, async ({ page }) => {
      test.skip(!desktop(page), "one viewport is enough for the simple pages");
      test.slow();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    });
  }

  test("auth pages focus the field on load and still start with a skip link", async ({ page }) => {
    await page.goto("/login");
    // The one field on the page is focused on arrival, so typing can start at once.
    await expect(page.getByLabel("Email")).toBeFocused();
    // And the skip link is still first in the tab order. Walk backwards from the
    // field: blur() does not reset Chrome's focus-navigation starting point, so
    // a forward Tab would continue from the field, not from the top of the page.
    const skip = page.getByRole("link", { name: "Skip to content" });
    for (let presses = 0; presses < 6; presses++) {
      await page.keyboard.press("Shift+Tab");
      if (await skip.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(skip).toBeFocused();
  });
});

test.describe("sign up", () => {
  test("walks email, code and password, then fails honestly", async ({ page }) => {
    await page.goto("/register");
    const next = page.getByRole("button", { name: "Continue", exact: true });

    // Empty submit: field error, no navigation.
    await next.click();
    await expect(page.getByText("Enter your email address")).toBeVisible();

    // Email without consent: consent error.
    await page.getByLabel("Email").fill("samlee@gmail.com");
    await next.click();
    await expect(page.getByText(/Agree to the Terms/)).toBeVisible();

    // Consent, then continue to the code step with the address masked.
    await page.getByLabel(/By creating an account/).check();
    await next.click();
    await expect(page.getByRole("heading", { level: 1, name: "Verify your email" })).toBeVisible();
    await expect(page.getByText("sam***@gmail.com")).toBeVisible();
    await expect(page.getByRole("button", { name: /Resend code in \d+s/ })).toBeDisabled();

    // Wrong shape is rejected client-side; six digits go through.
    await page.getByLabel("Verification code").fill("12");
    await next.click();
    await expect(page.getByText("Enter the 6-digit code")).toBeVisible();
    await page.getByLabel("Verification code").fill("123456");
    await next.click();
    await expect(page.getByRole("heading", { level: 1, name: "Create a password" })).toBeVisible();

    // The checklist ticks as the rules are met.
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("hello");
    await expect(page.getByText("At least 8 characters, not yet")).toBeVisible();
    await password.fill("Helloooo1");
    await expect(page.getByText("At least 8 characters, met")).toBeVisible();
    await expect(page.getByText("At least 1 number, met")).toBeVisible();
    await expect(page.getByText("At least 1 upper case letter, met")).toBeVisible();

    // Final action: the preview client fails, the page says so, nothing navigates.
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "not connected" })).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("the reveal toggle has a real name and works", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill("samlee@gmail.com");
    await page.getByLabel(/By creating an account/).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("Google is the only OAuth option and fails honestly for now", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(1);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "not connected" })).toBeVisible();
  });
});

test.describe("log in", () => {
  test("asks for email first, then password, and fails honestly", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);

    await page.getByLabel("Email").fill("samlee@gmail.com");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText("Signing in as")).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill("Helloooo1");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "not connected" })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // "Not you?" goes back to the email step.
    await page.getByRole("button", { name: "Not you?" }).click();
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("forgot password leads to recovery, which never confirms an account", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("samlee@gmail.com");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/recover$/);

    await page.getByLabel("Email").fill("samlee@gmail.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "not connected" })).toBeVisible();
  });
});

test.describe("legal pages", () => {
  for (const [path, title] of [
    ["/terms", "Terms of Service"],
    ["/privacy", "Privacy Policy"],
  ] as const) {
    test(`${path} is labelled as a placeholder`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByText("Placeholder, not yet in force")).toBeVisible();
    });
  }
});
