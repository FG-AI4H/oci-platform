import { execFileSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Campaign instructions page (#555): managers publish versioned
 * instructions, everyone signed in reads the current version and the
 * history.
 *
 * The seed has no instructions, so the spec clears this campaign's
 * versions and pointer before and after, via `docker exec psql` as
 * `calibration-flags.spec.ts` does. Tests run in order: each publish
 * builds on the previous one.
 *
 * Pre-conditions:
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/database db:seed:demo   (demo-rsna-* campaigns)
 *   - OCI_ENV=local pnpm --filter @oci/api dev
 *   - pnpm --filter @oci/web dev
 */

const SLUG = 'demo-rsna-classification';
const PAGE = `/annotation/campaigns/${SLUG}/instructions`;

const V1_BODY = [
  '# Step one',
  '',
  'Label each radiograph as **normal** or **abnormal**.',
  '',
  'See the [labelling guide](https://example.org/guide).',
].join('\n');
const V2_BODY = `${V1_BODY}\n\n## Edge cases\n\nIf the image is unreadable, skip it.`;
const GFM_BODY = [
  '| Finding | Segment? |',
  '| ------- | -------- |',
  '| Pleural effusion | No |',
  '| Consolidation | Yes |',
  '',
  '- [x] Read the guide',
  '- [ ] Annotate ten samples',
  '',
  'This replaces the ~~old rule~~.',
].join('\n');
const XSS_BODY =
  'Read carefully. <script>window.__xss = 1</script> <img src=x onerror="window.__xss = 2">';

function psql(sql: string): void {
  execFileSync(
    'docker',
    ['exec', 'oci-postgres', 'psql', '-U', 'oci', '-d', 'oci_dev', '-c', sql],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

function clearInstructions(): void {
  psql(`
    UPDATE annotation.annotation_campaigns SET current_instructions_version = NULL WHERE slug = '${SLUG}';
    DELETE FROM annotation.annotation_campaign_instructions
      WHERE campaign_id = (SELECT id FROM annotation.annotation_campaigns WHERE slug = '${SLUG}');
  `);
}

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

/**
 * Opens the page and waits for the editor to hydrate: typing into the
 * controlled textarea before then is overwritten by React's state.
 */
async function openEditor(page: Page): Promise<void> {
  await page.goto(PAGE, { waitUntil: 'networkidle' });
}

const body = (page: Page) => page.getByLabel('Instructions (Markdown)');
const publish = (page: Page) => page.getByRole('button', { name: 'Publish', exact: true });
const statusAlert = (page: Page) => page.getByRole('status').filter({ hasText: /version/i });

/** Reads the version hash out of the success message. */
async function publishedVersion(page: Page): Promise<string> {
  const text = (await statusAlert(page).textContent()) ?? '';
  const match = /version ([0-9a-f]+)/i.exec(text);
  expect(match, `version in "${text}"`).not.toBeNull();
  return match![1]!;
}

test.describe.configure({ mode: 'serial' });

test.describe('campaign instructions (#555)', () => {
  let v1 = '';
  let v2 = '';

  test.beforeAll(() => clearInstructions());
  test.afterAll(() => clearInstructions());

  test('manager publishes v1 from the empty state', async ({ page }) => {
    await signInAs(page, 'mgr', 'campaign-manager');
    await page.goto(`/annotation/campaigns/${SLUG}`);
    await page.getByRole('link', { name: 'View and edit instructions' }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(
      page.getByText('No instructions have been published for this campaign yet.'),
    ).toBeVisible();

    await body(page).fill(V1_BODY);
    await page.getByRole('button', { name: 'Add media' }).click();
    await page.getByLabel('URL').fill('https://example.org/normal.png');
    await page.getByLabel('Caption').fill('A normal chest radiograph');
    await publish(page).click();

    await expect(statusAlert(page)).toContainText('Published version');
    v1 = await publishedVersion(page);

    const current = page.getByRole('heading', { level: 2, name: /current version/i });
    await expect(current).toContainText(v1);
    // Markdown h1 renders one level under the card title.
    await expect(page.getByRole('heading', { level: 3, name: 'Step one' })).toBeVisible();
    await expect(page.getByText('A normal chest radiograph', { exact: true })).toBeVisible();
    const guide = page.getByRole('link', { name: /labelling guide/i });
    await expect(guide).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(guide).toHaveAttribute('target', '_blank');
  });

  test('an edit becomes v2 and v1 moves to the history as superseded', async ({ page }) => {
    await signInAs(page, 'mgr', 'campaign-manager');
    await openEditor(page);
    // The editor starts from the current version.
    await expect(body(page)).toHaveValue(V1_BODY);
    await body(page).fill(V2_BODY);
    await publish(page).click();

    await expect(statusAlert(page)).toContainText('Published version');
    v2 = await publishedVersion(page);
    expect(v2).not.toBe(v1);
    await expect(page.getByRole('heading', { level: 4, name: 'Edge cases' })).toBeVisible();

    const history = page.getByRole('list', { name: /published versions/i });
    await expect(history.getByRole('listitem')).toHaveCount(2);
    await history.getByRole('link', { name: v1 }).click();
    await expect(page).toHaveURL(new RegExp(`\\?version=${v1}$`));
    await expect(
      page.getByRole('heading', { level: 2, name: new RegExp(`superseded version ${v1}`, 'i') }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Superseded' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Edge cases' })).toHaveCount(0);
  });

  test('re-publishing the current text is a no-op; an older text becomes current again', async ({
    page,
  }) => {
    await signInAs(page, 'mgr', 'campaign-manager');
    await openEditor(page);
    await publish(page).click();
    await expect(statusAlert(page)).toContainText(`No change: version ${v2} is still current`);

    await body(page).fill(V1_BODY);
    await publish(page).click();
    await expect(statusAlert(page)).toContainText(`Version ${v1} is current again`);
    await expect(page.getByRole('heading', { level: 2, name: /current version/i })).toContainText(
      v1,
    );
  });

  test('a body over 64 KB is rejected and the text is echoed back', async ({ page }) => {
    await signInAs(page, 'mgr', 'campaign-manager');
    await openEditor(page);
    const tooBig = 'a'.repeat(64 * 1024 + 1);
    await body(page).fill(tooBig);
    await expect(page.getByText(/65,537 of 65,536 bytes/)).toBeVisible();
    await publish(page).click();

    await expect(
      page.getByRole('heading', { name: 'Could not publish the instructions' }),
    ).toBeVisible();
    await expect(page.getByText(/at most 65,536 bytes/)).toBeVisible();
    expect((await body(page).inputValue()).length).toBe(tooBig.length);
  });

  test('Cancel discards unpublished edits and clears the last error', async ({ page }) => {
    await signInAs(page, 'mgr', 'campaign-manager');
    await openEditor(page);
    const cancel = page.getByRole('button', { name: 'Cancel' });
    const mediaUrls = page.getByLabel('URL');
    // Nothing to discard yet. v1 is current again, with its one media row.
    await expect(cancel).toBeDisabled();
    await expect(body(page)).toHaveValue(V1_BODY);
    await expect(mediaUrls).toHaveCount(1);

    await body(page).fill('A draft that should not survive.');
    await page.getByRole('button', { name: 'Add media' }).click();
    await expect(mediaUrls).toHaveCount(2);
    await cancel.click();
    await expect(body(page)).toHaveValue(V1_BODY);
    await expect(mediaUrls).toHaveCount(1);
    await expect(cancel).toBeDisabled();

    // After a rejected publish, Cancel also clears the error.
    await body(page).fill('');
    await publish(page).click();
    await expect(page.getByText('Write the instructions before publishing.')).toBeVisible();
    await cancel.click();
    await expect(body(page)).toHaveValue(V1_BODY);
    await expect(
      page.getByRole('heading', { name: 'Could not publish the instructions' }),
    ).toHaveCount(0);
    await expect(page.getByText('Write the instructions before publishing.')).toHaveCount(0);
  });

  test('GitHub Flavored Markdown renders tables, task lists and strikethrough', async ({
    page,
  }) => {
    await signInAs(page, 'mgr', 'campaign-manager');
    await openEditor(page);
    await body(page).fill(GFM_BODY);
    await publish(page).click();
    await expect(statusAlert(page)).toContainText('Published version');

    const table = page.getByRole('region', { name: 'Table' }).getByRole('table');
    await expect(table.getByRole('columnheader', { name: 'Finding' })).toBeVisible();
    await expect(table.getByRole('row', { name: /Consolidation\s+Yes/ })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Done', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Not done' })).not.toBeChecked();
    await expect(page.locator('main del')).toHaveText('old rule');

    const results = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const summary = results.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`);
    expect(summary, 'axe violations').toEqual([]);
  });

  test('raw HTML in the body renders as text, never as markup', async ({ page }) => {
    await signInAs(page, 'mgr', 'campaign-manager');
    await openEditor(page);
    await body(page).fill(XSS_BODY);
    await publish(page).click();
    await expect(statusAlert(page)).toContainText('Published version');

    await page.reload();
    // The rendered body, not the editor's textarea, which holds the same text.
    const rendered = page
      .getByRole('paragraph')
      .filter({ hasText: 'Read carefully. <script>window.__xss = 1</script>' });
    await expect(rendered).toBeVisible();
    await expect(rendered).toContainText('<img src=x onerror=');
    expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
    await expect(page.locator('main script, main img[src="x"]')).toHaveCount(0);
  });

  test('annotator reads the current version, has no editor, and finds the links', async ({
    page,
  }) => {
    await signInAs(page, 'ann', 'annotator');
    await page.goto(`/annotation/campaigns/${SLUG}`);
    await page.getByRole('link', { name: 'Read instructions' }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));

    await expect(page.getByRole('heading', { level: 2, name: /current version/i })).toBeVisible();
    await expect(page.getByText('Read carefully.', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Publish instructions' })).toHaveCount(0);
    await expect(page.getByLabel('Instructions (Markdown)')).toHaveCount(0);

    await page.goto(`/annotation/campaigns/${SLUG}/annotate`);
    const link = page.getByRole('link', { name: 'Instructions (opens in new tab)' });
    await expect(link).toHaveAttribute('href', PAGE);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    for (const mode of [
      { name: 'view mode (annotator)', user: 'ann', roles: 'annotator' },
      { name: 'edit mode (campaign manager)', user: 'mgr', roles: 'campaign-manager' },
    ]) {
      test(`${mode.name} has no axe violations (${colorScheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await signInAs(page, mode.user, mode.roles);
        await page.goto(PAGE);
        await expect(page.getByRole('heading', { level: 1, name: 'Instructions' })).toBeVisible();

        const results = await new AxeBuilder({ page })
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const summary = results.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`);
        expect(summary, 'axe violations').toEqual([]);
      });
    }
  }
});
