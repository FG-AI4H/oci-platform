import { expect, test, type Page } from '@playwright/test';
import { DUO_REGISTRY } from '@oci/croissant';

/**
 * The workshop path in French (#654). A browser set to French walks the
 * pages translated in this slice and must find no English left on them:
 * header, footer and home; sign-in; dashboard; catalogue list, dataset
 * page and the publish wizard; model pages; settings.
 *
 * "English left" means an English word from the list below, in the
 * visible text or in an `aria-label`, `title`, `placeholder` or `alt`.
 * Not counted, by design:
 *
 *   - content that comes from the API: dataset and model names,
 *     descriptions, keywords, manifest values and keys (every string in
 *     the API responses behind the page is removed before the check);
 *   - code: anything inside `<code>`, `<pre>`, `<kbd>`, `<samp>` or an
 *     element marked `translate="no"`;
 *   - the proper names and fixed vocabularies in `EXCEPTIONS`, among
 *     them the DUO ontology's own English labels, which come from
 *     `@oci/croissant` and are shown as published by the ontology.
 *
 * Pre-conditions: the API and the web app running locally as for the
 * rest of the suite, with the demo seed (it needs one public dataset
 * and one published model card).
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

test.use({ locale: 'fr-FR' });

/** Words that are English and not French. Matched as whole words, any case. */
const ENGLISH_WORDS = [
  'the',
  'and',
  'with',
  'your',
  'you',
  'this',
  'that',
  'from',
  'for',
  'are',
  'is',
  'has',
  'have',
  'will',
  'not',
  'sign in',
  'sign out',
  'settings',
  'dashboard',
  'catalog',
  'search',
  'browse',
  'download',
  'upload',
  'files',
  'view',
  'open',
  'close',
  'required',
  'optional',
  'loading',
  'submit',
  'save',
  'back',
  'next',
  'previous',
  'show',
  'hide',
  'more',
  'request',
  'access',
  'dataset',
  'datasets',
  'models',
  'published',
  'draft',
  'create',
  'license',
  'none',
  'step',
];

/** Proper names and fixed vocabularies allowed in English. */
const EXCEPTIONS = [
  'Open Code Infrastructure',
  'OCI Platform',
  'Model Facts',
  'BIOCroissant',
  'BioCroissant',
  'Croissant',
  'GitHub',
  'Cognito',
  'NextAuth',
  'aws-jwt-verify',
  'Safe Harbor',
  // File names inside the bulk ZIP.
  'LICENSE.txt',
  'CITATION.txt',
  ...DUO_REGISTRY.flatMap((term) => [term.label, term.summary, term.code]),
];

const WORD_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}_-])(${ENGLISH_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}_-])`,
  'giu',
);

/** Every string value and key in an API response. */
function stringsIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.trim().length >= 3) out.add(value.trim());
  } else if (Array.isArray(value)) {
    for (const item of value) stringsIn(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key.length >= 3) out.add(key);
      stringsIn(item, out);
    }
  }
  return out;
}

async function apiStrings(page: Page, paths: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const path of paths) {
    const res = await page.request.get(`${API}${path}`);
    if (res.ok()) stringsIn(await res.json(), out);
  }
  return out;
}

/**
 * The page's text and labelling attributes, code left out. Text that is
 * in the page but not on screen (screen-reader-only text, a closed
 * menu, the document title) counts too: it is read out.
 */
async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.body.cloneNode(true) as HTMLElement;
    root
      .querySelectorAll(
        'code, pre, kbd, samp, script, style, noscript, template, [translate="no"], [aria-hidden="true"]',
      )
      .forEach((el) => el.remove());
    const attributes: string[] = [];
    root.querySelectorAll('[aria-label], [title], [placeholder], [alt]').forEach((el) => {
      for (const name of ['aria-label', 'title', 'placeholder', 'alt']) {
        const value = el.getAttribute(name);
        if (value) attributes.push(value);
      }
    });
    // Block boundaries become spaces, so words of adjacent elements do not merge.
    root.querySelectorAll('*').forEach((el) => el.append(' '));
    return `${document.title}\n${root.textContent ?? ''}\n${attributes.join('\n')}`;
  });
}

/** English words left on the page, each with a little context. */
async function englishLeft(page: Page, content: Set<string> = new Set()): Promise<string[]> {
  let text = await pageText(page);
  const removable = [...EXCEPTIONS, ...content].sort((a, b) => b.length - a.length);
  for (const s of removable) text = text.split(s).join(' ');
  const hits: string[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const at = match.index;
    hits.push(text.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' '));
  }
  return hits;
}

async function expectFrench(page: Page, content?: Set<string>) {
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  expect(await englishLeft(page, content), `English left on ${page.url()}`).toEqual([]);
}

async function signInAsFrenchHost(page: Page, user: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('Utilisateur').fill(user);
  await page.getByLabel('Rôles').fill('host');
  await page.getByRole('button', { name: /se connecter.*développement local/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe('French interface — workshop path (#654)', () => {
  test('signed-out pages: home, sign-in, catalogue, dataset, models', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'pour une IA en santé digne de confiance',
    );
    await expectFrench(page, await apiStrings(page, ['/v2/catalog/datasets?limit=1']));

    await page.goto('/signin');
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    await expectFrench(page);

    const list = await apiStrings(page, ['/v2/catalog/datasets?limit=24']);
    await page.goto('/catalog');
    await expectFrench(page, list);

    const res = await page.request.get(`${API}/v2/catalog/datasets?limit=1`);
    const { items } = (await res.json()) as { items: { slug: string }[] };
    const slug = items[0]?.slug;
    expect(slug, 'the demo seed has a public dataset').toBeTruthy();
    await page.goto(`/catalog/${slug}`);
    await expectFrench(
      page,
      await apiStrings(page, [
        `/v2/catalog/datasets/${slug}`,
        `/v2/catalog/datasets/${slug}/dicom/series`,
      ]),
    );

    const models = await page.request.get(`${API}/v2/prediction/model-cards`);
    const modelList = (await models.json()) as { items: { slug: string }[] };
    await page.goto('/models');
    await expectFrench(page, stringsIn(modelList));

    const modelSlug = modelList.items[0]?.slug;
    expect(modelSlug, 'the demo seed has a published model card').toBeTruthy();
    await page.goto(`/models/${modelSlug}`);
    await expectFrench(
      page,
      await apiStrings(page, [
        `/v2/prediction/model-cards/${modelSlug}`,
        `/v2/prediction/model-cards/${modelSlug}/model-facts`,
      ]),
    );
  });

  test('signed-in pages: dashboard, settings, new dataset and every wizard step', async ({
    page,
  }) => {
    await signInAsFrenchHost(page, `fr-host-${Date.now()}`);
    await expectFrench(page);

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Paramètres' })).toBeVisible();
    await expectFrench(page);

    const slug = `e2e-fr-${Date.now()}`;
    await page.goto('/catalog/new');
    await expectFrench(page);
    await page.getByLabel(/^Slug/).fill(slug);
    await page.getByLabel(/^Nom/).fill('Jeu de données de test');
    await page.getByRole('button', { name: /créer le brouillon/i }).click();
    await page.waitForURL(new RegExp(`/catalog/${slug}/publish$`));
    const draft = await apiStrings(page, [`/v2/catalog/datasets/${slug}`]);
    await expectFrench(page, draft);

    // Through the wizard, filling what each step requires to move on
    // (the same as manifest-wizard.spec.ts does in English).
    await page.getByLabel(/^Nom du jeu de données/).fill('Jeu de données de test');
    await page
      .getByLabel(/^Description/)
      .fill('Jeu de données créé par le test de l’interface en français.');
    await page.getByLabel(/^Page d’accueil/).fill('https://example.org/');
    await page.getByRole('button', { name: /^Suivant\s*:/ }).click();
    await expectFrench(page, draft);
    await page.locator('#wiz-creator-0-name').fill('Autrice de test');
    for (let step = 1; step < 6; step += 1) {
      await page.getByRole('button', { name: /^Suivant\s*:/ }).click();
      await expectFrench(page, draft);
    }
  });

  test('the header switch changes the language at once, on the same page', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-GB' });
    const page = await context.newPage();
    await page.goto('/catalog');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('button', { name: /FR Français/ }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(page.getByRole('button', { name: /FR Français/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The cookie keeps it on the next visit.
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await page.getByRole('button', { name: /EN English/ }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await context.close();
  });

  test('the preference in settings switches the language at once and wins over the browser', async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'en-GB' });
    const page = await context.newPage();
    await page.goto('/signin?callbackUrl=%2Fsettings');
    await page.getByLabel('User').fill(`fr-pref-${Date.now()}`);
    await page.getByLabel('Roles').fill('participant');
    await page.getByRole('button', { name: /sign in.*local dev/i }).click();
    await page.waitForURL(/\/settings/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
    await page.getByRole('button', { name: /save preferences/i }).click();
    await expect(page).toHaveURL(/\/settings\?saved=1/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('status')).toContainText('Préférences enregistrées.');

    // Back to following the browser (English here); leaves the row clean.
    await page.getByRole('combobox', { name: 'Langue' }).selectOption('');
    await page.getByRole('button', { name: /enregistrer les préférences/i }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await context.close();
  });
});
