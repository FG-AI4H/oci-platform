import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { SESSION_E2E, SESSION_E2E_APP_ENV } from './e2e/fixtures/session-e2e';

/**
 * Playwright config for the session-refresh test (#643):
 *
 *   pnpm --filter @oci/web exec playwright test -c playwright.session.config.ts
 *
 * Separate from `playwright.config.ts` because it needs the web app in
 * its deployed mode (Cognito provider, tokens that expire), pointed at
 * the stand-in pool the spec starts. The main suite runs the app with
 * `OCI_ENV=local`, where nothing expires. It needs no database, no API
 * and no AWS.
 *
 * It starts its own dev server on port 3643. Next.js allows one
 * `next dev` per checkout, so stop any other first, or start the app
 * yourself with the variables in `e2e/fixtures/session-e2e.ts` plus an
 * `AUTH_SECRET` of your own, and set `PW_NO_SERVER=1`.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'session-refresh.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // The tests wait for real tokens to expire.
  timeout: 120_000,
  reporter: [['list']],
  outputDir: 'test-results/session',
  use: {
    baseURL: SESSION_E2E.appOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
        command: `pnpm exec next dev --turbopack --port ${SESSION_E2E.appPort}`,
        url: `${SESSION_E2E.appOrigin}/signin`,
        reuseExistingServer: false,
        timeout: 180_000,
        // A session-encryption key that exists for this run only.
        env: { ...SESSION_E2E_APP_ENV, AUTH_SECRET: randomBytes(32).toString('base64url') },
      },
});
