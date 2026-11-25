import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Container,
  ExternalLinkIcon,
  Section,
} from '@oci/ui';
import { DOCS_INDEX_URL, HELP_SECTIONS, guideUrl } from './guides';

/**
 * `/help` (#655): the guides for the people who use the platform, listed in
 * the interface language and linked from the footer. The guides are kept in
 * `docs/` and open on GitHub, in the same language; this page holds only
 * their titles and a sentence each, so the text is never kept twice.
 *
 * Public and static: no session, no API call.
 */

const LINK =
  'inline-flex items-center gap-1.5 rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Help');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function HelpPage() {
  const [t, locale] = await Promise.all([getTranslations('Help'), getLocale()]);

  return (
    <Container size="md">
      <Section spacing="md" className="space-y-10">
        <header className="space-y-3">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t('heading')}</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">{t('lead')}</p>
        </header>

        {HELP_SECTIONS.map((section) => (
          <section key={section.key} aria-labelledby={`help-${section.key}`} className="space-y-4">
            <h2 id={`help-${section.key}`} className="text-xl font-semibold tracking-tight">
              {t(`sections.${section.key}`)}
            </h2>
            <ul className="space-y-4">
              {section.guides.map((guide) => (
                <li key={guide.key}>
                  <Card>
                    <CardHeader>
                      <CardTitle as="h3">
                        <a
                          href={guideUrl(guide.path, locale)}
                          target="_blank"
                          rel="noreferrer"
                          className={LINK}
                        >
                          {t(`guides.${guide.key}.title`)}
                          <ExternalLinkIcon size={16} />
                          <span className="sr-only"> ({t('opensOnGitHub')})</span>
                        </a>
                      </CardTitle>
                      <CardDescription>{t(`guides.${guide.key}.description`)}</CardDescription>
                    </CardHeader>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="border-t border-[var(--color-border)] pt-6 text-sm text-[var(--color-muted-foreground)]">
          <a href={DOCS_INDEX_URL} target="_blank" rel="noreferrer" className={LINK}>
            {t('allDocs')}
            <ExternalLinkIcon size={14} />
            <span className="sr-only"> ({t('opensOnGitHub')})</span>
          </a>{' '}
          {t('allDocsNote')}
        </p>
      </Section>
    </Container>
  );
}
