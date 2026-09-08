import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/*
  The sign-up, log-in, account and legal pages.

  The API is stubbed at the network boundary rather than run alongside these
  tests. What is under test here is the browser half: that the flows can be
  walked, that a rejection from the server becomes a visible inline error
  rather than a silent nothing, and that success actually navigates. That the
  server rejects the right things is the API's own suite (apps/api/test), and
  duplicating it here would only mean two places to keep honest.
*/

const desktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const mobile = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

const USER = {
  id: "0199f0b1-2c3d-7e4f-8a9b-0c1d2e3f4a5b",
  email: "samlee@gmail.com",
  status: "ACTIVE",
  emailVerified: true,
};

type Reply = { status: number; body?: unknown };
type Endpoint = "start" | "verify" | "complete" | "login" | "logout" | "me" | "reset";

const DEFAULTS: Record<Endpoint, Reply> = {
  start: { status: 202, body: { status: "accepted" } },
  verify: { status: 200, body: { ticket: "ticket-issued-by-the-stubbed-api" } },
  complete: { status: 201, body: { user: USER } },
  login: { status: 200, body: { user: USER } },
  logout: { status: 204 },
  me: { status: 200, body: { user: USER } },
  reset: { status: 202, body: { status: "accepted" } },
};

/** The API's error envelope, so the client parses a stubbed failure as a real one. */
const rejected = (code: string, message: string, status: number): Reply => ({
  status,
  body: { error: { code, message, correlationId: "test" } },
});

function endpointOf(url: string): Endpoint | null {
  const { pathname } = new URL(url);
  if (pathname.endsWith("/auth/register/start")) return "start";
  if (pathname.endsWith("/auth/register/verify")) return "verify";
  if (pathname.endsWith("/auth/register/complete")) return "complete";
  if (pathname.endsWith("/auth/login")) return "login";
  if (pathname.endsWith("/auth/logout")) return "logout";
  if (pathname.endsWith("/auth/me")) return "me";
  if (pathname.endsWith("/auth/password-reset")) return "reset";
  return null;
}

/*
  The client sends credentialed cross-origin requests, so the browser enforces
  CORS on every reply and preflights the ones carrying a JSON body. A stub that
  omits these headers fails exactly the way a misconfigured server would, and
  every test would then be passing or failing for the wrong reason.
*/
function corsHeaders(route: Route): Record<string, string> {
  return {
    "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };
}

async function mockApi(page: Page, overrides: Partial<Record<Endpoint, Reply>> = {}) {
  const replies = { ...DEFAULTS, ...overrides };

  await page.route("**/v1/auth/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders(route) });
      return;
    }

    const endpoint = endpointOf(route.request().url());
    if (!endpoint) {
      await route.fulfill({ status: 404, headers: corsHeaders(route) });
      return;
    }

    const reply = replies[endpoint];
    const hasBody = reply.body !== undefined;
    await route.fulfill({
      status: reply.status,
      headers: {
        ...corsHeaders(route),
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(reply.body) } : {}),
    });
  });
}

/** Walks sign-up as far as the password step. */
async function toPasswordStep(page: Page) {
  await page.goto("/register");
  const next = page.getByRole("button", { name: "Continue", exact: true });
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel(/By creating an account/).check();
  await next.click();
  await page.getByLabel("Verification code").fill("123456");
  await next.click();
  await expect(page.getByRole("heading", { level: 1, name: "Create a password" })).toBeVisible();
}

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

  test("the signed-in account page passes axe", async ({ page }) => {
    test.skip(!desktop(page), "one viewport is enough for a single card");
    test.slow();
    await mockApi(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/account");
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

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
  test("walks email, code and password, and lands on the account", async ({ page }) => {
    await mockApi(page);
    await page.goto("/register");
    const next = page.getByRole("button", { name: "Continue", exact: true });

    // Empty submit: field error, no navigation.
    await next.click();
    await expect(page.getByText("Enter your email address")).toBeVisible();

    // Email without consent: consent error.
    await page.getByLabel("Email").fill(USER.email);
    await next.click();
    await expect(page.getByText(/Agree to the Terms/)).toBeVisible();

    // Consent, then continue to the code step with the address masked.
    await page.getByLabel(/By creating an account/).check();
    await next.click();
    await expect(page.getByRole("heading", { level: 1, name: "Verify your email" })).toBeVisible();
    await expect(page.getByText("sam***@gmail.com")).toBeVisible();
    await expect(page.getByRole("button", { name: /Resend code in \d+s/ })).toBeDisabled();

    // Wrong shape is rejected client-side; six digits go to the server.
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

    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByText(USER.email)).toBeVisible();
  });

  test("a rejected code is shown as an error and does not advance", async ({ page }) => {
    await mockApi(page, {
      verify: rejected("UNAUTHENTICATED", "That code is not valid or has expired.", 401),
    });
    await page.goto("/register");
    await page.getByLabel("Email").fill(USER.email);
    await page.getByLabel(/By creating an account/).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "not valid or has expired" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Verify your email" })).toBeVisible();
  });

  test("an address that is already taken is shown as an error", async ({ page }) => {
    await mockApi(page, {
      complete: rejected("CONFLICT", "An account already exists for that email address.", 409),
    });
    await toPasswordStep(page);
    await page.getByLabel("Password", { exact: true }).fill("Helloooo1");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("an unreachable API says so instead of failing silently", async ({ page }) => {
    await page.route("**/v1/auth/**", (route) => route.abort("connectionrefused"));
    await page.goto("/register");
    await page.getByLabel("Email").fill(USER.email);
    await page.getByLabel(/By creating an account/).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "could not reach the server" }),
    ).toBeVisible();
  });

  test("the reveal toggle has a real name and works", async ({ page }) => {
    await mockApi(page);
    await toPasswordStep(page);

    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("Google is the only OAuth option and says it is not available yet", async ({ page }) => {
    await mockApi(page);
    await page.goto("/register");
    await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(1);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "not available yet" })).toBeVisible();
  });
});

test.describe("log in", () => {
  test("asks for email first, then password, then signs in", async ({ page }) => {
    await mockApi(page);
    await page.goto("/login");
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);

    await page.getByLabel("Email").fill(USER.email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText("Signing in as")).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill("Helloooo1");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/account$/);
  });

  test("a wrong password stays on the form and says so", async ({ page }) => {
    await mockApi(page, {
      login: rejected("UNAUTHENTICATED", "That email or password is not correct.", 401),
    });
    await page.goto("/login");
    await page.getByLabel("Email").fill(USER.email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Password", { exact: true }).fill("Wrong1Password");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "not correct" })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // "Not you?" goes back to the email step.
    await page.getByRole("button", { name: "Not you?" }).click();
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("forgot password leads to recovery, which never confirms an account", async ({ page }) => {
    await mockApi(page);
    await page.goto("/login");
    await page.getByLabel("Email").fill(USER.email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/recover$/);

    await page.getByLabel("Email").fill(USER.email);
    await page.getByRole("button", { name: "Send reset code" }).click();
    // The same words whether or not the address has an account: the page never
    // says "sent", only "if an account exists".
    await expect(page.getByText("If an account exists for")).toBeVisible();
  });
});

test.describe("account", () => {
  test("shows who is signed in, and logging out ends the session", async ({ page }) => {
    await mockApi(page);
    await page.goto("/account");

    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    await expect(page.getByText(USER.email)).toBeVisible();
    await expect(page.getByText("Verified", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You are signed out" })).toBeVisible();
  });

  test("without a session it offers the way in rather than an error", async ({ page }) => {
    await mockApi(page, { me: rejected("UNAUTHENTICATED", "Sign in to continue.", 401) });
    await page.goto("/account");

    await expect(page.getByRole("heading", { level: 1, name: "You are signed out" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
    // A missing session is normal, so it must not be dressed up as a failure.
    // Filtered on having any text: Next keeps an empty role="alert" route
    // announcer in the DOM at all times, and it is not an error message.
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
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
