import { test, expect } from '@playwright/test';

/**
 * E2E coverage for the evaluation web surface (ADR-0017, Phase C-lite).
 *
 * Both `/evaluation` and `/evaluation/[slug]` read public, anonymous
 * endpoints (`GET /v2/evaluation/tasks`, `GET /v2/evaluation/tasks/:slug`),
 * so there is no sign-in step here.
 *
 * The suite is written to pass on an environment with **no** evaluation
 * tasks seeded — which is the current state of `dev` — as well as on one
 * where a task exists. Nothing is mocked: the list page is asserted either
 * on its populated form or on its empty state, and the detail assertions
 * are skipped when the list is empty rather than failing.
 *
 * Pre-conditions: API on :3000 + web on :3001 (same as the rest of the
 * suite).
 */

/** Card title links on the list page all point at `/evaluation/<slug>`. */
const TASK_LINK = 'a[href^="/evaluation/"]';

test.describe('evaluation surface (ADR-0017)', () => {
  test('list page renders, populated or empty', async ({ page }) => {
    await page.goto('/evaluation');

    // Page identity + the lede that explains ground truth is withheld.
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
    await expect(
      page.getByText('the reference labels are never published', { exact: false }),
    ).toBeVisible();

    // The API must have answered — the error state must not be showing.
    await expect(page.getByRole('heading', { name: 'Evaluation unavailable' })).toHaveCount(0);

    const taskLinks = page.locator(TASK_LINK);
    if ((await taskLinks.count()) === 0) {
      // Empty state is a first-class state, not a fallback.
      await expect(page.getByRole('heading', { name: 'No evaluation tasks yet.' })).toBeVisible();
    } else {
      // Every card links to its dataset in the catalog.
      await expect(page.locator('a[href^="/catalog/"]').first()).toBeVisible();
    }
  });

  test('detail page shows task metadata and results when a task exists', async ({ page }) => {
    await page.goto('/evaluation');

    const firstTask = page.locator(TASK_LINK).first();
    const taskCount = await page.locator(TASK_LINK).count();
    test.skip(taskCount === 0, 'no evaluation task seeded on this environment');

    await firstTask.click();
    await expect(page).toHaveURL(/\/evaluation\/[^/]+$/);

    // Task summary card: the referable cut-off is explained, not just
    // printed as a bare integer.
    await expect(page.getByRole('heading', { level: 2, name: 'About this task' })).toBeVisible();
    await expect(page.getByText('Referable threshold', { exact: true })).toBeVisible();
    await expect(page.getByText('referable means grade ≥', { exact: false })).toBeVisible();

    // #441 — the item-ID key set is published on the task page. This is the
    // half of that issue a participant actually hits: the identifiers were
    // reachable only by reading the dataset manifest and stripping the file
    // extension, so a guessed convention scored as coverage 0. Assert both the
    // list and the two rules that make it usable.
    await expect(page.getByRole('heading', { level: 2, name: 'Item identifiers' })).toBeVisible();
    const itemIds = page.getByRole('list', { name: /item identifiers for /i });
    await expect(itemIds).toBeVisible();
    expect(await itemIds.getByRole('listitem').count()).toBeGreaterThan(0);
    await expect(page.getByText('reduced coverage', { exact: false })).toBeVisible();
    await expect(
      page.getByText('Read this list rather than generating it', { exact: false }),
    ).toBeVisible();

    // The per-task / not-cross-task-comparable note is a product
    // commitment (ADR-0017), so assert it is actually on the page.
    await expect(
      page.getByRole('heading', { name: 'Metrics are per task, not a global ranking' }),
    ).toBeVisible();

    // Results card renders either the leaderboard or its own empty state.
    await expect(page.getByRole('heading', { level: 2, name: 'Results' })).toBeVisible();
    const submissions = page
      .getByRole('list', { name: 'Submissions, best first' })
      .getByRole('listitem');
    if ((await submissions.count()) === 0) {
      await expect(page.getByText('No submissions scored yet.', { exact: false })).toBeVisible();
    } else {
      // Headline metric plus the four supporting rates are all labelled.
      const first = submissions.first();
      await expect(first.getByText('QWK', { exact: true })).toBeVisible();
      await expect(first.getByText('Accuracy', { exact: true })).toBeVisible();
      await expect(first.getByText('Referable sensitivity', { exact: true })).toBeVisible();
      await expect(first.getByText('Referable specificity', { exact: true })).toBeVisible();
      await expect(first.getByText('Coverage', { exact: true })).toBeVisible();

      // #486 — every SCORED row carries its attribution, as a badge whose
      // text (not colour) names the state. The seeded `demo-baseline-v1` on
      // dev predates the route registry, so when it is present it must read
      // as legacy and carry no rank number.
      const rowCount = await submissions.count();
      for (let i = 0; i < rowCount; i += 1) {
        const row = submissions.nth(i);
        if ((await row.getByText('scored', { exact: true }).count()) === 0) continue;
        await expect(
          row.getByText(/^(published|provisional|withdrawn|retracted|legacy)$/),
        ).toBeVisible();
      }
      const legacyBaseline = submissions.filter({
        has: page.getByRole('heading', { level: 3, name: /demo-baseline-v1/ }),
      });
      if ((await legacyBaseline.count()) > 0) {
        await expect(legacyBaseline.getByText('legacy', { exact: true })).toBeVisible();
        await expect(legacyBaseline.getByRole('heading', { level: 3 })).not.toContainText('#');
      }
    }

    // Footer reports published results separately from scored ones.
    await expect(page.getByText(/\d+ of \d+ submissions scored · \d+ published/)).toBeVisible();
  });

  test('unknown task slug renders the 404 page', async ({ page }) => {
    const response = await page.goto('/evaluation/no-such-evaluation-task');
    expect(response?.status()).toBe(404);
  });
});
