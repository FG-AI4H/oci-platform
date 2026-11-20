/**
 * UI/UX audit diagnostic for submitting predictions and reading a result
 * (#645): /evaluation/[slug]/submit and /evaluation/[slug]/submissions/[id],
 * plus the task page that links to both. Scaffolding, not regression coverage.
 *
 * Run with the local stack up:
 *   PW_NO_SERVER=1 PW_NO_RESET=1 pnpm --filter @oci/web exec playwright test e2e/_diagnostic-evaluation-submit.spec.ts
 *
 * Creates its own tasks and submissions through the API, then captures each
 * state that matters for layout across the viewport × colour-scheme matrix and
 * runs axe-core on every capture. Artefacts land in
 * apps/web/test-results/audit/evaluation-submit-<tag>/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const TAG = process.env.AUDIT_TAG ?? 'before';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const SCHEMES = ['light', 'dark'] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const stamp = Date.now();
const GRADING = `e2e-eval-audit-g-${stamp}`;
const CLASSES = `e2e-eval-audit-c-${stamp}`;
const USER = `e2e-audit-${stamp}`;
const TOKEN = `dev:${USER}:researcher`;

/** 24 items, so the lists of identifiers are long enough to show how they wrap. */
const IDS = Array.from({ length: 24 }, (_, i) => `00000${String(i + 1).padStart(3, '0')}_000.png`);

interface Run {
  state: string;
  viewport: string;
  scheme: string;
  url: string;
  /** Widest element overflow past the viewport, in px. 0 means no sideways scroll. */
  overflowX: number;
  violations: { id: string; impact: string | null; nodes: number }[];
}

const runs: Run[] = [];

const csv = (name: string, text: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text, 'utf8'),
});

async function post(request: APIRequestContext, path: string, token: string, data: unknown) {
  const res = await request.post(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  return (await res.json()) as Record<string, unknown>;
}

async function signInAs(page: Page, user: string, callback: string) {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles', { exact: false }).fill('researcher');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === callback);
}

async function capture(
  browser: Browser,
  state: string,
  prepare: (page: Page) => Promise<void>,
): Promise<void> {
  const outDir = join('test-results', 'audit', `evaluation-submit-${TAG}`);
  mkdirSync(outDir, { recursive: true });
  for (const vp of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      await prepare(page);
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: join(outDir, `${state}-${vp.name}-${scheme}.png`),
        fullPage: true,
      });
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      runs.push({
        state,
        viewport: vp.name,
        scheme,
        url: page.url(),
        overflowX,
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact ?? null,
          nodes: v.nodes.length,
        })),
      });
      await ctx.close();
    }
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(runs, null, 2));
}

test.describe('ui/ux diagnostic — submit predictions (#645)', () => {
  test.describe.configure({ mode: 'serial' });
  // Eight states × six captures, each with a sign-in: well past the default.
  test.setTimeout(600_000);

  let gradingScored = '';
  let gradingFailed = '';
  let classesScored = '';

  test.beforeAll(async ({ request }) => {
    const host = 'dev:e2e-audit-host:host';
    await post(request, '/v2/evaluation/tasks', host, {
      slug: CLASSES,
      name: 'Audit: chest radiograph, three findings',
      datasetSlug: 'e2e-eval-audit-dataset',
      taskKind: 'CLASSIFICATION',
      numClasses: 3,
      referableThreshold: 1,
      groundTruth: Object.fromEntries(IDS.map((id, i) => [id, i % 3])),
    });
    await post(request, '/v2/evaluation/tasks', host, {
      slug: GRADING,
      name: 'Audit: chest radiograph, finding present or absent',
      datasetSlug: 'e2e-eval-audit-dataset',
      taskKind: 'GRADING',
      numClasses: 2,
      referableThreshold: 1,
      groundTruth: Object.fromEntries(IDS.map((id, i) => [id, i % 2])),
    });

    const submissions = `/v2/evaluation/tasks/${GRADING}/submissions`;
    const scored = await post(request, submissions, TOKEN, {
      methodName: 'First reading, resident',
      predictions: IDS.slice(0, 20).map((imageId, i) => ({
        imageId,
        grade: i % 4 === 0 ? 1 : i % 2,
      })),
    });
    gradingScored = String(scored.id);
    await post(request, submissions, 'dev:e2e-audit-other:researcher', {
      methodName: 'Baseline model v2 with a deliberately long method name to see how it wraps',
      predictions: IDS.map((imageId, i) => ({ imageId, grade: i % 2 })),
    });
    const failed = await post(request, submissions, TOKEN, {
      methodName: 'Scripted attempt',
      predictions: [
        { imageId: IDS.at(0), grade: 0 },
        { imageId: IDS.at(0), grade: 1 },
      ],
    });
    gradingFailed = String(failed.submissionId);
    const classes = await post(request, `/v2/evaluation/tasks/${CLASSES}/submissions`, TOKEN, {
      methodName: 'Three-class model',
      predictions: IDS.map((imageId, i) => ({ imageId, grade: i % 5 === 0 ? 1 : i % 3 })),
    });
    classesScored = String(classes.id);
  });

  test('task page', async ({ browser }) => {
    await capture(browser, '1-task', async (page) => {
      await page.goto(`/evaluation/${GRADING}`);
    });
  });

  test('submit — signed out', async ({ browser }) => {
    await capture(browser, '2-submit-signed-out', async (page) => {
      await page.goto(`/evaluation/${GRADING}/submit`);
    });
  });

  test('submit — signed in, file that cannot be read', async ({ browser }) => {
    await capture(browser, '3-submit-unreadable', async (page) => {
      await signInAs(page, USER, `/evaluation/${GRADING}/submit`);
      await page.getByLabel('Method name').fill('First reading, resident');
      const lines = IDS.map((id, i) => (i < 3 ? `${id},1` : `${id},`));
      await page
        .getByLabel('Predictions file')
        .setInputFiles(csv('template-not-finished.csv', ['item_id,label', ...lines].join('\n')));
      await page.getByRole('button', { name: 'Check format' }).click();
      await page.locator('#submit-result').getByRole('heading').first().waitFor();
    });
  });

  test('submit — signed in, file with problems', async ({ browser }) => {
    await capture(browser, '4-submit-problems', async (page) => {
      await signInAs(page, USER, `/evaluation/${GRADING}/submit`);
      await page.getByLabel('Method name').fill('First reading, resident');
      const lines = [
        `${IDS.at(0)},0`,
        `${IDS.at(0)},1`,
        `${IDS.at(1)},4`,
        'patient_17_frontal.png,1',
        'patient_18_frontal.png,0',
      ];
      await page
        .getByLabel('Predictions file')
        .setInputFiles(csv('reading.csv', ['item_id,label', ...lines].join('\n')));
      await page.getByRole('button', { name: 'Check format' }).click();
      await page.locator('#submit-result').getByRole('heading').first().waitFor();
    });
  });

  test('submit — signed in, valid file', async ({ browser }) => {
    await capture(browser, '5-submit-valid', async (page) => {
      await signInAs(page, USER, `/evaluation/${GRADING}/submit`);
      await page.getByLabel('Method name').fill('First reading, resident');
      const lines = IDS.slice(0, 20).map((id, i) => `${id};${i % 2}`);
      await page
        .getByLabel('Predictions file')
        .setInputFiles(csv('reading.csv', ['item_id;label', ...lines].join('\n')));
      await page.getByRole('button', { name: 'Check format' }).click();
      await page.getByRole('heading', { name: 'The format is valid' }).waitFor();
    });
  });

  test('submission — scored, grading', async ({ browser }) => {
    await capture(browser, '6-submission-grading', async (page) => {
      await signInAs(page, USER, `/evaluation/${GRADING}/submissions/${gradingScored}`);
    });
  });

  test('submission — scored, classification', async ({ browser }) => {
    await capture(browser, '7-submission-classification', async (page) => {
      await page.goto(`/evaluation/${CLASSES}/submissions/${classesScored}`);
    });
  });

  test('submission — failed, seen by its submitter', async ({ browser }) => {
    await capture(browser, '8-submission-failed', async (page) => {
      await signInAs(page, USER, `/evaluation/${GRADING}/submissions/${gradingFailed}`);
    });
  });
});
