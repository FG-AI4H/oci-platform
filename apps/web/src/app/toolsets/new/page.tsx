import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeftIcon, Container, Section } from '@oci/ui';
import { ToolsetKindSchema } from '@oci/shared-types';
import { auth } from '../../../auth';
import { emptyToolsetFormValues } from '../../../lib/toolset-form';
import { declareToolsetAction } from '../actions';
import { ToolsetForm } from '../toolset-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ToolsetForm');
  return { title: t('metaTitleNew'), robots: { index: false, follow: false } };
}

/**
 * `/toolsets/new` (#830). Mirrors the API's rule: declaring a toolset needs a
 * signed-in user and no particular role (ADR-0031 decision 5).
 */
export default async function NewToolsetPage() {
  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent('/toolsets/new')}`);

  const [t, tList] = await Promise.all([
    getTranslations('ToolsetForm'),
    getTranslations('Toolsets'),
  ]);
  const kinds = ToolsetKindSchema.options.map((k) => ({ value: k, label: tList(`kind.${k}`) }));

  return (
    <Container size="xl">
      <Section spacing="md">
        <header className="mb-8 max-w-3xl space-y-3">
          <Link
            href="/toolsets"
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('back')}</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('eyebrow')}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('headingNew')}</h1>
          <p className="text-[var(--color-muted-foreground)]">{t('introNew')}</p>
        </header>
        <ToolsetForm
          mode="create"
          action={declareToolsetAction}
          initialValues={emptyToolsetFormValues()}
          kinds={kinds}
          cancelHref="/toolsets"
        />
      </Section>
    </Container>
  );
}
