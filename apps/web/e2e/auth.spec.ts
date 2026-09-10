import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

/*
  The sign-up, log-in, recovery, account and legal pages.

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
  platformId: "BQ-48213967",
  username: "user_48213967",
  status: "ACTIVE",
  emailVerified: true,
};

const TICKET = { ticket: "ticket-issued-by-the-stubbed-api" };

type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** The real API sets the session cookie here; middleware routes on it, so the stub must too. */
  cookie?: "set" | "clear";
};

const SESSION_COOKIE = "birq_session";
const SESSION_VALUE = "a-session-token";
/** Matches playwright.config.ts. Cookies ignore the port, so this covers the API stub too. */
const SITE = "http://localhost:3100";
type Endpoint =
  | "start"
  | "verify"
  | "complete"
  | "login"
  | "loginVerify"
  | "loginResend"
  | "logout"
  | "me"
  | "reset"
  | "resetVerify"
  | "resetComplete"
  | "googleStart";

const DEFAULTS: Record<Endpoint, Reply> = {
  start: { status: 202, body: { status: "accepted" } },
  verify: { status: 200, body: TICKET },
  complete: { status: 201, body: { user: USER }, cookie: "set" },
  login: { status: 200, body: TICKET },
  loginVerify: { status: 200, body: { user: USER }, cookie: "set" },
  loginResend: { status: 202, body: { status: "accepted" } },
  logout: { status: 204, cookie: "clear" },
  me: { status: 200, body: { user: USER } },
  reset: { status: 202, body: { status: "accepted" } },
  resetVerify: { status: 200, body: TICKET },
  resetComplete: { status: 200, body: { status: "completed" } },
  // The real route sends the browser to Google; the stub sends it straight to
  // the outcome a cancelled sign-in produces.
  googleStart: { status: 302, headers: { location: "/login?error=google_denied" } },
};

/** The API's error envelope, so the client parses a stubbed failure as a real one. */
const rejected = (code: string, message: string, status: number): Reply => ({
  status,
  body: { error: { code, message, correlationId: "test" } },
});

function endpointOf(url: string): Endpoint | null {
  const { pathname } = new URL(url);
  const tail = pathname.slice(pathname.indexOf("/v1/auth/") + "/v1/auth/".length);
  const table: Record<string, Endpoint> = {
    "register/start": "start",
    "register/verify": "verify",
    "register/complete": "complete",
    login: "login",
    "login/verify": "loginVerify",
    "login/resend": "loginResend",
    logout: "logout",
    me: "me",
    "password-reset": "reset",
    "password-reset/verify": "resetVerify",
    "password-reset/complete": "resetComplete",
    "google/start": "googleStart",
  };
  return table[tail] ?? null;
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
    // A redirect target is relative to the page's own origin, not the API's.
    const location = reply.headers?.location;
    // What the real API's Set-Cookie does, done to the jar directly: Playwright
    // does not apply a Set-Cookie from a fulfilled cross-origin response, and
    // middleware routes on this cookie, so it has to actually be there (or not).
    if (reply.cookie === "set") {
      await page.context().addCookies([{ name: SESSION_COOKIE, value: SESSION_VALUE, url: SITE }]);
    } else if (reply.cookie === "clear") {
      await page.context().clearCookies({ name: SESSION_COOKIE });
    }

    await route.fulfill({
      status: reply.status,
      headers: {
        ...corsHeaders(route),
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...(location ? { location: new URL(location, page.url()).toString() } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(reply.body) } : {}),
    });
  });
}

/*
  Puts a session cookie in the jar, for tests that open /account directly
  instead of arriving there by signing in. Without one, middleware turns the
  request straight around to the landing page - which is the point of it.
*/
async function withSession(context: BrowserContext) {
  await context.addCookies([{ name: SESSION_COOKIE, value: SESSION_VALUE, url: SITE }]);
}

/*
  The account home's <h1> is a time-of-day greeting ("Good morning, ..."),
  not a fixed page title, so tests match the shape rather than the exact
  words - it is whichever one is true when the suite happens to run.
*/
const ACCOUNT_GREETING = /^Good (morning|afternoon|evening|night),/;

/** The first of the six boxes. Filling it with all six digits fills the rest. */
const codeBox = (page: Page) => page.getByLabel(/digit 1 of 6/);

/** Walks sign-up as far as the password step. */
async function toPasswordStep(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel(/By creating an account/).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await codeBox(page).fill("123456");
  await expect(page.getByRole("heading", { level: 1, name: "Create a password" })).toBeVisible();
}

/** Walks log-in as far as the code step. */
async function toLoginCodeStep(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USER.email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("Helloooo1");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Verify it's you" })).toBeVisible();
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

  test("the code step and the signed-in home pass axe", async ({ page, context }) => {
    test.skip(!desktop(page), "one viewport is enough for a single card");
    test.slow();
    await mockApi(page);
    await page.emulateMedia({ reducedMotion: "reduce" });

    await toLoginCodeStep(page);
    await expectNoSeriousA11yViolations(page);

    await withSession(context);
    await page.goto("/account");
    await expect(page.getByRole("heading", { level: 1, name: ACCOUNT_GREETING })).toBeVisible();
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

test.describe("the code boxes", () => {
  test("typing advances box by box and the sixth digit submits", async ({ page }) => {
    await mockApi(page);
    await toLoginCodeStep(page);

    await expect(codeBox(page)).toBeFocused();
    await page.keyboard.type("12345");
    await expect(page.getByLabel(/digit 6 of 6/)).toBeFocused();
    await expect(page.getByLabel(/digit 3 of 6/)).toHaveValue("3");
    // Nothing submitted yet: still on the code step.
    await expect(page.getByRole("heading", { level: 1, name: "Verify it's you" })).toBeVisible();

    await page.keyboard.type("6");
    await expect(page).toHaveURL(/\/account$/);
  });

  test("backspace clears and steps back", async ({ page }) => {
    await mockApi(page);
    await toLoginCodeStep(page);

    await page.keyboard.type("123");
    await page.keyboard.press("Backspace");
    await expect(page.getByLabel(/digit 3 of 6/)).toHaveValue("");
    await expect(page.getByLabel(/digit 3 of 6/)).toBeFocused();
    await page.keyboard.press("Backspace");
    await expect(page.getByLabel(/digit 2 of 6/)).toHaveValue("");
    await expect(page.getByLabel(/digit 2 of 6/)).toBeFocused();
  });

  test("a pasted code fills the boxes from the first, wherever it is pasted", async ({ page }) => {
    await mockApi(page);
    await toLoginCodeStep(page);

    // Five digits, pasted into the third box: enough to show it fills from the
    // first box rather than the one under the caret, and short of the six that
    // would submit the form out from under these assertions.
    await page.getByLabel(/digit 3 of 6/).evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text", "Your code is 65432");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    });

    await expect(page.getByLabel(/digit 1 of 6/)).toHaveValue("6");
    await expect(page.getByLabel(/digit 5 of 6/)).toHaveValue("2");
    await expect(page.getByLabel(/digit 6 of 6/)).toHaveValue("");
  });

  test("a pasted full code submits on its own", async ({ page }) => {
    await mockApi(page);
    await toLoginCodeStep(page);

    await page.getByLabel(/digit 3 of 6/).evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text", "Your code is 654321");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    });

    await expect(page).toHaveURL(/\/account$/);
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

    // Two digits and Continue is rejected client-side; six go to the server.
    await codeBox(page).fill("12");
    await next.click();
    await expect(page.getByText("Enter the 6-digit code")).toBeVisible();
    await codeBox(page).fill("123456");
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
    await expect(page.getByRole("heading", { level: 1, name: ACCOUNT_GREETING })).toBeVisible();
    // And the landing page now belongs to the signed-in app.
    await page.goto("/");
    await expect(page).toHaveURL(/\/account$/);
  });

  test("a rejected code is shown as an error and does not advance", async ({ page }) => {
    await mockApi(page, {
      verify: rejected("UNAUTHENTICATED", "That code is not valid or has expired.", 401),
    });
    await page.goto("/register");
    await page.getByLabel("Email").fill(USER.email);
    await page.getByLabel(/By creating an account/).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await codeBox(page).fill("000000");

    await expect(
      page.getByRole("alert").filter({ hasText: "not valid or has expired" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Verify your email" })).toBeVisible();
  });

  test("an address that already has an account is sent to log in", async ({ page }) => {
    await mockApi(page, {
      start: rejected("CONFLICT", "An account already exists for this email address.", 409),
    });
    await page.goto("/register");
    await page.getByLabel("Email").fill(USER.email);
    await page.getByLabel(/By creating an account/).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    const notice = page.getByRole("alert").filter({ hasText: "already exists" });
    await expect(notice).toBeVisible();
    await notice.getByRole("link", { name: "Log in instead" }).click();
    await expect(page).toHaveURL(/\/login$/);
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

  test("Google is the only OAuth option, and a cancelled sign-in reports back on /login", async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto("/register");
    await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(1);
    // A top-level navigation to the API, which answers with a redirect back.
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/\/login\?error=google_denied$/);
    await expect(page.getByRole("alert").filter({ hasText: "cancelled" })).toBeVisible();
  });
});

test.describe("log in", () => {
  test("asks for email, then password, then the emailed code, then signs in", async ({ page }) => {
    await mockApi(page);
    await page.goto("/login");
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);

    await page.getByLabel("Email").fill(USER.email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText("Signing in as")).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill("Helloooo1");
    await page.getByRole("button", { name: "Log in" }).click();
    // The password alone is not enough: no navigation, a code is asked for.
    await expect(page.getByRole("heading", { level: 1, name: "Verify it's you" })).toBeVisible();
    await expect(page.getByText("sam***@gmail.com")).toBeVisible();

    await codeBox(page).fill("123456");
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

  test("a wrong login code is shown as an error and stays on the code step", async ({ page }) => {
    await mockApi(page, {
      loginVerify: rejected("UNAUTHENTICATED", "That code is not valid or has expired.", 401),
    });
    await toLoginCodeStep(page);
    await codeBox(page).fill("000000");
    await expect(
      page.getByRole("alert").filter({ hasText: "not valid or has expired" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("password reset", () => {
  test("walks email, code and new password, then sends the person to log in", async ({ page }) => {
    await mockApi(page);
    await page.goto("/login");
    await page.getByLabel("Email").fill(USER.email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/recover$/);

    await page.getByLabel("Email").fill(USER.email);
    await page.getByRole("button", { name: "Send reset code" }).click();
    // The same words whether or not the address has an account.
    await expect(page.getByText("If an account exists for that address")).toBeVisible();

    await codeBox(page).fill("123456");
    await expect(
      page.getByRole("heading", { level: 1, name: "Choose a new password" }),
    ).toBeVisible();

    await page.getByLabel("New password").fill("Different2Horse");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Password changed" })).toBeVisible();
    await expect(page.getByText("signed out on every device")).toBeVisible();
    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("account", () => {
  test("shows the home card, and logging out returns to the landing page", async ({
    page,
    context,
  }) => {
    await mockApi(page);
    await withSession(context);
    await page.goto("/account");

    await expect(page.getByRole("heading", { level: 1, name: ACCOUNT_GREETING })).toBeVisible();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    // Signed out is a reason to be somewhere else, not something to be told.
    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a failed sign-out is reported, not pretended", async ({ page, context }) => {
    await mockApi(page, { logout: rejected("INTERNAL", "Something broke.", 500) });
    await withSession(context);
    await page.goto("/account");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /went wrong/ })).toBeVisible();
    // Still signed in, because the server still holds the session.
    await expect(page.getByRole("heading", { level: 1, name: ACCOUNT_GREETING })).toBeVisible();
  });

  test("without a session it goes to the landing page rather than saying so", async ({ page }) => {
    await mockApi(page, { me: rejected("UNAUTHENTICATED", "Sign in to continue.", 401) });
    await page.goto("/account");

    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Being signed out is normal, so nothing is dressed up as a failure.
    // Filtered on having any text: Next keeps an empty role="alert" route
    // announcer in the DOM at all times, and it is not an error message.
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  });
});

test.describe("the landing page and a session", () => {
  test("a visitor with no session sees the landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a signed-in visitor is taken from / to the account", async ({ page, context }) => {
    await mockApi(page);
    await context.addCookies([
      { name: "birq_session", value: "a-session-token", url: "http://localhost:3100" },
    ]);

    await page.goto("/");
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { level: 1, name: ACCOUNT_GREETING })).toBeVisible();
  });

  test("a stale cookie is cleared, so the landing page does not become unreachable", async ({
    page,
    context,
  }) => {
    // The cookie is still in the jar but the session behind it is gone.
    await mockApi(page, { me: rejected("UNAUTHENTICATED", "Sign in to continue.", 401) });
    await withSession(context);
    const cleared = page.waitForRequest(
      (request) => request.url().includes("/v1/auth/logout") && request.method() === "POST",
    );

    await page.goto("/");
    // Bounced to /account, which finds the session dead, clears the cookie...
    await cleared;
    // ...and comes back here, where the cleared cookie lets the page through.
    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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
