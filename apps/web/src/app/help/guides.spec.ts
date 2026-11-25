import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../i18n/locales';
import { DOCS_BASE_URL, DOCS_INDEX_URL, HELP_SECTIONS, guideUrl } from './guides';

/** The repository's `docs/` folder, from this file. */
const DOCS_DIR = fileURLToPath(new URL('../../../../../docs/', import.meta.url));

describe('help guides (#655)', () => {
  it('links to the French file in French and to the English one otherwise', () => {
    expect(guideUrl('for-participants/declaring-a-model', 'fr')).toBe(
      `${DOCS_BASE_URL}/for-participants/declaring-a-model.fr.md`,
    );
    expect(guideUrl('for-participants/declaring-a-model', 'en')).toBe(
      `${DOCS_BASE_URL}/for-participants/declaring-a-model.md`,
    );
  });

  // A renamed or moved guide would leave the help page pointing at nothing.
  it.each(
    HELP_SECTIONS.flatMap((section) =>
      section.guides.flatMap((guide) => LOCALES.map((locale) => ({ path: guide.path, locale }))),
    ),
  )('$path exists in $locale', ({ path, locale }) => {
    const file = guideUrl(path, locale).slice(DOCS_BASE_URL.length + 1);
    expect(existsSync(`${DOCS_DIR}${file}`), file).toBe(true);
  });

  it('has the documentation index it links to', () => {
    expect(existsSync(`${DOCS_DIR}${DOCS_INDEX_URL.slice(DOCS_BASE_URL.length + 1)}`)).toBe(true);
  });
});
