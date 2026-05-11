import { resetTestRows } from './global-setup';

/**
 * Playwright global teardown. Runs ONCE after the test suite and
 * wipes the same test-pattern rows that `global-setup.ts` wipes on
 * the way in. Symmetric cleanup keeps the catalog list visually
 * tidy during interactive dev between test runs — without it,
 * every run's `e2e-*` / `ux-*` / `audit-*` rows linger in the
 * Datasets list until the *next* run starts.
 *
 * Skip with `PW_NO_RESET=1` (mirrors the setup behaviour) for cases
 * where you want to inspect what a failing run wrote.
 */
export default async function globalTeardown(): Promise<void> {
  resetTestRows();
}
