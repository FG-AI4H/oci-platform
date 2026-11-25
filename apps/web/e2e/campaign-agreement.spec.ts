import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

/**
 * Agreement between readers, and the annotation export (#648).
 *
 * The campaigns are built through the API with local-mode bearer
 * tokens (`dev:<user>:<roles>`), as readers and an arbiter would: a
 * campaign manager creates and starts a classification campaign, three
 * readers read twelve samples, they disagree on three, and an arbiter
 * settles one with a reason. A second campaign has three tasks only.
 * Nothing is written to the database directly.
 *
 * Pre-conditions: the local stack with `db:seed:demo` (the
 * `demo-rsna-classification` campaign gives the dataset and the tool),
 * the API with `OCI_ENV=local`. `NEXT_PUBLIC_API_BASE_URL` points the
 * spec at the API.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const STAMP = Date.now();
const SLUG = `e2e-agreement-${STAMP}`;
const SMALL_SLUG = `e2e-agreement-small-${STAMP}`;
const READERS = ['e2e-648-ra', 'e2e-648-rb', 'e2e-648-rc'] as const;
const HEADER =
  'task,sampleRef,taskStatus,reader,gate,label,comment,submittedAt,arbitrationReason,finalLabel';

/** Per sample: the three readers' answers. */
const PLAN: ReadonlyArray<readonly [string, string, string]> = [
  ['normal', 'normal', 'normal'],
  ['normal', 'normal', 'normal'],
  ['normal', 'normal', 'normal'],
  ['normal', 'normal', 'normal'],
  ['normal', 'normal', 'normal'],
  ['abnormal', 'abnormal', 'abnormal'],
  ['abnormal', 'abnormal', 'abnormal'],
  ['abnormal', 'abnormal', 'abnormal'],
  ['abnormal', 'abnormal', 'abnormal'],
  ['normal', 'normal', 'abnormal'],
  ['normal', 'abnormal', 'abnormal'],
  ['normal', 'abnormal', 'cannot-assess'],
];

function auth(user: string, roles: string) {
  return { Authorization: `Bearer dev:${user}:${roles}` };
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!res.ok()) throw new Error(`${res.url()} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

async function buildCampaign(
  api: APIRequestContext,
  slug: string,
  plan: ReadonlyArray<readonly [string, string, string]>,
  arbitrate: boolean,
) {
  const manager = auth('e2e-648-cm', 'campaign-manager');
  const demo = await ok<{ datasetId: string; toolIntegration: { id: string } }>(
    await api.get(`${API}/v2/annotation/campaigns/demo-rsna-classification`, { headers: manager }),
  );
  await ok(
    await api.post(`${API}/v2/annotation/campaigns`, {
      headers: manager,
      data: {
        slug,
        name: `Agreement ${slug}`,
        datasetId: demo.datasetId,
        toolIntegrationId: demo.toolIntegration.id,
        taskKind: 'CLASSIFICATION',
        outputLicense: 'CC-BY-NC-4.0',
        workflowConfig: {
          nAnnotators: 3,
          classificationLabels: {
            labels: [
              { value: 'normal', display: 'Normal' },
              { value: 'abnormal', display: 'Abnormal' },
            ],
            cannotAssess: true,
            allowComment: true,
          },
        },
      },
    }),
  );
  for (const action of ['mark-ready', 'start']) {
    await ok(
      await api.post(`${API}/v2/annotation/campaigns/${slug}/transitions`, {
        headers: manager,
        data: { action },
      }),
    );
  }
  await ok(
    await api.post(`${API}/v2/annotation/campaigns/${slug}/tasks`, {
      headers: manager,
      data: { sampleRefs: plan.map((_, i) => `${slug}-s${i}`) },
    }),
  );

  for (let round = 0; round < plan.length; round += 1) {
    for (const [r, reader] of READERS.entries()) {
      const headers = auth(reader, 'annotator');
      const { assignment } = await ok<{ assignment: { id: string; sampleRef: string } | null }>(
        await api.post(`${API}/v2/annotation/campaigns/${slug}/tasks/next`, { headers }),
      );
      if (!assignment) throw new Error(`${reader}: no task in round ${round}`);
      const index = Number(assignment.sampleRef.slice(`${slug}-s`.length));
      const label = plan.at(index)?.at(r);
      const comment = index === 0 && r === 0 ? { comment: '=SUM(A1), "quoted"\nsecond line' } : {};
      await ok(
        await api.post(`${API}/v2/annotation/assignments/${assignment.id}/submissions`, {
          headers,
          data: { submission: { label, ...comment } },
        }),
      );
    }
  }

  if (arbitrate) {
    const headers = auth('e2e-648-arb', 'arbitration-annotator');
    const { assignment } = await ok<{ assignment: { id: string } | null }>(
      await api.post(`${API}/v2/annotation/campaigns/${slug}/tasks/next`, { headers }),
    );
    if (!assignment) throw new Error('no arbitration task');
    await ok(
      await api.post(`${API}/v2/annotation/assignments/${assignment.id}/submissions`, {
        headers,
        data: { submission: { label: 'abnormal', reason: 'Opacity at the base, see apex' } },
      }),
    );
  }
}

async function signIn(page: Page, user: string, roles: string, lang: 'en' | 'fr' = 'en') {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel(lang === 'fr' ? 'Utilisateur' : 'User').fill(user);
  await page.getByLabel(lang === 'fr' ? 'Rôles' : 'Roles').fill(roles);
  await page
    .getByRole('button', {
      name: lang === 'fr' ? /se connecter.*développement local/i : /sign in.*local dev/i,
    })
    .click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

const card = (page: Page) => page.locator('#campaign-agreement');

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext();
  try {
    await buildCampaign(api, SLUG, PLAN, true);
    await buildCampaign(api, SMALL_SLUG, PLAN.slice(0, 3), false);
  } finally {
    await api.dispose();
  }
});

test.describe('agreement card and export (#648), English', () => {
  test('a manager sees kappa, its interval, the reading and the pairwise table', async ({
    page,
  }) => {
    await signIn(page, 'e2e-648-cm', 'campaign-manager');
    await page.goto(`/annotation/campaigns/${SLUG}`);
    const c = card(page);
    await expect(c.getByRole('heading', { name: 'Agreement between readers' })).toBeVisible();
    await expect(c.getByTestId('fleiss-kappa')).toHaveText(/^\d\.\d{2}$/);
    await expect(c).toContainText(/95% CI -?\d\.\d{2} to \d\.\d{2}/);
    await expect(c).toContainText(/On the conventional bands of Landis and Koch, this is/);
    await expect(c).toContainText('The bands are a convention, not a quality standard');
    await expect(c.getByTestId('cannot-assess-rule')).toContainText(
      '“Cannot assess” counts as an answer of its own',
    );
    // Twelve tasks, three readers each, three sent to arbitration.
    await expect(
      c.getByRole('term').filter({ hasText: 'Tasks counted' }).locator('+ dd'),
    ).toHaveText('12');
    await expect(
      c.getByRole('term').filter({ hasText: 'Sent to arbitration' }).locator('+ dd'),
    ).toHaveText('3 (25%)');
    const pairs = c.getByRole('table', { name: /Cohen’s kappa for each pair/ });
    await expect(pairs.locator('tbody tr')).toHaveCount(3);
    await expect(pairs.locator('tbody th').first()).toHaveText(/^r-[0-9a-f]{8} and r-[0-9a-f]{8}$/);
    // No reader identity anywhere on the card.
    for (const reader of READERS) await expect(c).not.toContainText(reader);

    const axe = await new AxeBuilder({ page })
      .include('#campaign-agreement')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  });

  test('the CSV export downloads with a byte-order mark and the right header row', async ({
    page,
  }) => {
    await signIn(page, 'e2e-648-cm', 'campaign-manager');
    await page.goto(`/annotation/campaigns/${SLUG}`);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      card(page).getByRole('link', { name: 'Export annotations as CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^annotations-${SLUG}-\\d{8}T\\d{6}Z\\.csv$`),
    );
    const bytes = readFileSync(await download.path());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.subarray(3).toString('utf8');
    expect(text.split('\r\n')[0]).toBe(HEADER);
    // 36 readings and one arbitration answer.
    expect(text.trimEnd().split('\r\n').length - 1).toBeGreaterThanOrEqual(37);
    expect(text).toContain(`"'=SUM(A1), ""quoted""\nsecond line"`);
    for (const reader of READERS) expect(text).not.toContain(reader);
  });

  test('the JSON export downloads with every row and the final label', async ({ page }) => {
    await signIn(page, 'e2e-648-cm', 'campaign-manager');
    await page.goto(`/annotation/campaigns/${SLUG}`);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      card(page).getByRole('link', { name: 'Export annotations as JSON' }).click(),
    ]);
    const doc = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
      format: string;
      rowCount: number;
      rows: Array<{ gate: string; finalLabel: string | null; arbitrationReason: string | null }>;
    };
    expect(doc.format).toBe('oci-annotation-export/v1');
    expect(doc.rowCount).toBe(37);
    const arbitration = doc.rows.find((r) => r.gate === 'arbitration');
    expect(arbitration?.finalLabel).toBe('abnormal');
    expect(arbitration?.arbitrationReason).toBe('Opacity at the base, see apex');
  });

  test('a supervisor sees the card and can download the export', async ({ page }) => {
    await signIn(page, 'e2e-648-sup', 'task-supervisor');
    await page.goto(`/annotation/campaigns/${SLUG}`);
    const c = card(page);
    await expect(c.getByTestId('fleiss-kappa')).toBeVisible();
    for (const [format, name] of [
      ['csv', 'Export annotations as CSV'],
      ['json', 'Export annotations as JSON'],
    ] as const) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        c.getByRole('link', { name }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^annotations-${SLUG}-\\d{8}T\\d{6}Z\\.${format}$`),
      );
      const bytes = readFileSync(await download.path());
      if (format === 'csv') {
        expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        expect(bytes.subarray(3).toString('utf8').split('\r\n')[0]).toBe(HEADER);
      } else {
        expect((JSON.parse(bytes.toString('utf8')) as { rowCount: number }).rowCount).toBe(37);
      }
    }
  });

  test('a reader sees no card', async ({ page }) => {
    await signIn(page, READERS[0], 'annotator');
    await page.goto(`/annotation/campaigns/${SLUG}`);
    await expect(page.getByRole('heading', { name: 'Agreement between readers' })).toHaveCount(0);
  });

  test('below 10 tasks: the counts and "not enough tasks yet"', async ({ page }) => {
    await signIn(page, 'e2e-648-cm', 'campaign-manager');
    await page.goto(`/annotation/campaigns/${SMALL_SLUG}`);
    const c = card(page);
    await expect(c.getByTestId('agreement-state')).toHaveText(
      'Not enough tasks yet. Agreement is computed once 10 tasks have all their independent readings: 3 so far.',
    );
    await expect(c.getByTestId('fleiss-kappa')).toHaveCount(0);
    await expect(
      c.getByRole('term').filter({ hasText: 'Tasks counted' }).locator('+ dd'),
    ).toHaveText('3');
    await expect(c).toContainText('Under 10 tasks');
  });
});

test.describe('agreement card and export (#648), French', () => {
  test.use({ locale: 'fr-FR' });

  test('« Accord entre lecteurs » with a decimal comma and « IC 95 % : x à y »', async ({
    page,
  }) => {
    await signIn(page, 'e2e-648-cm', 'campaign-manager', 'fr');
    await page.goto(`/annotation/campaigns/${SLUG}`);
    const c = card(page);
    await expect(c.getByRole('heading', { name: 'Accord entre lecteurs' })).toBeVisible();
    await expect(c.getByTestId('fleiss-kappa')).toHaveText(/^\d,\d{2}$/);
    await expect(c).toContainText(/IC 95\u202f%\u00a0: \u2212?\d,\d{2} à \d,\d{2}/);
    await expect(c).toContainText('Selon les catégories conventionnelles de Landis et Koch');
    await expect(c.getByTestId('cannot-assess-rule')).toContainText(
      '« Non interprétable » compte comme une réponse à part entière',
    );
    await expect(
      c.getByRole('term').filter({ hasText: 'Envoyées en arbitrage' }).locator('+ dd'),
    ).toHaveText('3 (25 %)');
    await expect(c.getByRole('table', { name: /Kappa de Cohen pour chaque paire/ })).toBeVisible();

    const axe = await new AxeBuilder({ page })
      .include('#campaign-agreement')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`)).toEqual([]);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      c.getByRole('link', { name: 'Exporter les annotations en CSV' }).click(),
    ]);
    const bytes = readFileSync(await download.path());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8').split('\r\n')[0]).toBe(HEADER);
  });

  test('pas encore assez de tâches', async ({ page }) => {
    await signIn(page, 'e2e-648-cm', 'campaign-manager', 'fr');
    await page.goto(`/annotation/campaigns/${SMALL_SLUG}`);
    await expect(card(page).getByTestId('agreement-state')).toContainText(
      'Pas encore assez de tâches. L’accord est calculé dès que 10 tâches ont toutes leurs lectures indépendantes',
    );
  });
});
