import type { AppLocale } from '../../i18n/locales';

/**
 * The guides the help page lists (#655). The guides themselves live in the
 * repository's `docs/` folder and are read on GitHub: the web image is built
 * from `apps/web` and `packages` only, so the Markdown is not there to serve.
 *
 * Each guide has a French file (`.fr.md`) next to its English one, and the
 * link follows the interface language. `guides.spec.ts` checks that every
 * file named here exists.
 */

export const DOCS_BASE_URL = 'https://github.com/FG-AI4H/oci-platform/blob/main/docs';

/** A guide: its message key and its path under `docs/`, without the extension. */
export interface HelpGuide {
  key: 'submitting' | 'declaring' | 'evidence';
  path: string;
}

export interface HelpSection {
  key: 'participants' | 'reviewers';
  guides: readonly HelpGuide[];
}

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    key: 'participants',
    guides: [
      { key: 'submitting', path: 'for-participants/submitting-predictions' },
      { key: 'declaring', path: 'for-participants/declaring-a-model' },
    ],
  },
  {
    key: 'reviewers',
    guides: [{ key: 'evidence', path: 'for-governance/reading-an-evidence-summary' }],
  },
];

/** The guide's page on GitHub, in the interface language. */
export function guideUrl(path: string, locale: AppLocale): string {
  return `${DOCS_BASE_URL}/${path}${locale === 'fr' ? '.fr' : ''}.md`;
}

/** The documentation's index, organised by audience; English only. */
export const DOCS_INDEX_URL = `${DOCS_BASE_URL}/README.md`;
