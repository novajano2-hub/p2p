import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

/*
  E2E runs against a production build (next start), not the dev server, so
  what is tested is what ships. Three viewports per AT-22.
*/
export default defineConfig({
  testDir: "./e2e",
  // axe scans of a page with a live WebGL canvas take 20-30s on their own.
  timeout: 60_000,
  fullyParallel: true,
  // Each worker drives a WebGL page; more than three contend for the GPU locally.
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    // When the bundled Chromium cannot be downloaded (flaky local network),
    // run against an installed browser instead: PW_BROWSER_CHANNEL=chrome
    ...(process.env.PW_BROWSER_CHANNEL ? { channel: process.env.PW_BROWSER_CHANNEL } : {}),
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
