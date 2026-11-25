import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The help page (#655): reached from the footer, it lists the guides in the
 * interface language and links each one to its file on GitHub in that
 * language. Static: it needs the web app only, no API data.
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const DOCS = 'https://github.com/FG-AI4H/oci-platform/blob/main/docs';

const CASES = [
  {
    locale: 'en-GB',
    footerLink: 'Help',
    heading: 'Help',
    guide: 'Declaring a model',
    href: `${DOCS}/for-participants/declaring-a-model.md`,
  },
  {
    locale: 'fr-FR',
    footerLink: 'Aide',
    heading: 'Aide',
    guide: 'Déclarer un modèle',
    href: `${DOCS}/for-participants/declaring-a-model.fr.md`,
  },
] as const;

for (const c of CASES) {
  test.describe(`help page (${c.locale})`, () => {
    test.use({ locale: c.locale });

    test('is linked from the footer and lists the guides in the interface language', async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByRole('contentinfo').getByRole('link', { name: c.footerLink }).click();
      await expect(page).toHaveURL(/\/help$/);
      await expect(page.getByRole('heading', { level: 1, name: c.heading })).toBeVisible();

      const main = page.getByRole('main');
      const guide = main.getByRole('link', { name: new RegExp(`^${c.guide}`) });
      await expect(guide).toHaveAttribute('href', c.href);
      await expect(guide).toHaveAttribute('target', '_blank');
      // Three guides, in two groups.
      await expect(main.getByRole('heading', { level: 2 })).toHaveCount(2);
      await expect(main.getByRole('heading', { level: 3 })).toHaveCount(3);
    });

    test('has no axe violations', async ({ page }) => {
      await page.goto('/help');
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      const summary = results.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`);
      expect(summary).toEqual([]);
    });
  });
}
