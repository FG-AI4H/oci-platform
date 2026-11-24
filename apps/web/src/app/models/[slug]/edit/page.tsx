import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Button,
  Container,
  Section,
} from '@oci/ui';
import { ModelCardSlugSchema, canEditModelCard, type ModelCardResponse } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { formValuesFromCard } from '../../../../lib/model-card-form';
import { modelCardViewer } from '../../../../lib/model-card-viewer';
import { ModelCardForm } from '../../model-card-form';
import { modelCardFormOptions } from '../../model-card-form-options';
import { updateModelCardAction } from './actions';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('ModelCardForm');
  return { title: t('metaTitleEdit', { slug }), robots: { index: false, follow: false } };
}

/**
 * `/models/[slug]/edit` (#651). Mirrors the API's edit rule
 * (`canEditModelCard`: DRAFT, submitter only). Anyone else is told why the
 * card cannot be edited; the API's 403/409 stays authoritative.
 */
export default async function EditModelCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/models/${encodeURIComponent(slug)}/edit`;
  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent(path)}`);
  if (!ModelCardSlugSchema.safeParse(slug).success) notFound();

  const [t, card, viewer] = await Promise.all([
    getTranslations('ModelCardForm'),
    apiFetch<ModelCardResponse>(`/v2/prediction/model-cards/${encodeURIComponent(slug)}`, {
      session,
      revalidate: 0,
    }),
    modelCardViewer(session, slug),
  ]);
  if (!card) notFound();

  const editable = canEditModelCard(card.status, viewer);
  const backLink = (
    <Link
      href={`/models/${encodeURIComponent(slug)}`}
      className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
    >
      <ArrowLeftIcon size={14} />
      <span>{t('backToCard')}</span>
    </Link>
  );

  return (
    <Container size="xl">
      <Section spacing="md">
        <header className="mb-8 max-w-3xl space-y-3">
          {backLink}
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('eyebrow')}
          </p>
          <h1 className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('headingEdit', { slug: card.slug })}
          </h1>
          {editable ? (
            <p className="text-[var(--color-muted-foreground)]">{t('introEdit')}</p>
          ) : null}
        </header>
        {editable ? (
          <ModelCardForm
            mode="edit"
            action={updateModelCardAction.bind(null, card.slug)}
            initialValues={formValuesFromCard(card)}
            options={await modelCardFormOptions()}
          />
        ) : (
          <Alert tone="warning" className="max-w-3xl">
            <AlertTitle>{t('notEditable.title')}</AlertTitle>
            <AlertDescription>
              <p>{t('notEditable.body')}</p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href={`/models/${encodeURIComponent(slug)}`}>{t('backToCard')}</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </Section>
    </Container>
  );
}
