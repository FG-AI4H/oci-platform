import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeftIcon, Container, Section } from '@oci/ui';
import { auth } from '../../../auth';
import { emptyModelCardFormValues } from '../../../lib/model-card-form';
import { ModelCardForm } from '../model-card-form';
import { modelCardFormOptions } from '../model-card-form-options';
import { createModelCardAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ModelCardForm');
  return { title: t('metaTitleNew'), robots: { index: false, follow: false } };
}

/**
 * `/models/new` (#651). Mirrors the API's rule: creating a card needs a
 * signed-in user and no particular role (`POST /v2/prediction/model-cards`
 * sits behind `CognitoJwtGuard` only).
 */
export default async function NewModelCardPage() {
  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent('/models/new')}`);

  const [t, options] = await Promise.all([
    getTranslations('ModelCardForm'),
    modelCardFormOptions(session),
  ]);

  return (
    <Container size="xl">
      <Section spacing="md">
        <header className="mb-8 max-w-3xl space-y-3">
          <Link
            href="/models"
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
        <ModelCardForm
          mode="create"
          action={createModelCardAction}
          initialValues={emptyModelCardFormValues()}
          options={options}
        />
      </Section>
    </Container>
  );
}
