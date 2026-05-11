import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the OCI web app.
 *
 * Local dev: assumes the API + web are already up (docker compose +
 * `pnpm --filter @oci/api dev` + `pnpm --filter @oci/web dev` on :3001).
 * The runner does NOT spawn its own server because the suite reuses the
 * tsx-watched processes you'll iterate against during the test session
 * (Playwright's `webServer.reuseExistingServer` is set so CI can spawn
 * a fresh one with `--with-deps`).
 *
 * CI: configured via `PW_BASE_URL` + `PW_NO_SERVER=1` env.
 */
const baseURL = process.env.PW_BASE_URL ?? 'http://localhost:3001';
const reuseExisting = process.env.CI ? false : true;

export default defineConfig({
  testDir: './e2e',
  // Wipes test-pattern rows from the dev Postgres so the suite starts
  // from a known state. Skip with PW_NO_RESET=1.
  globalSetup: './e2e/global-setup.ts',
  // Symmetric cleanup after the suite — same PW_NO_RESET escape hatch.
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false, // shared local state — keep tests serial
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: process.env.PW_NO_SERVER
    ? undefined
    : {
        command: 'PORT=3001 pnpm dev',
        url: baseURL,
        reuseExistingServer: reuseExisting,
        timeout: 120_000,
      },
});
