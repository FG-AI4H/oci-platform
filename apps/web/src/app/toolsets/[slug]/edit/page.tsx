import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription, ArrowLeftIcon, Container, Section } from '@oci/ui';
import { ToolsetKindSchema, ToolsetSlugSchema, type ToolsetResponse } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { toolsetFormValuesFrom } from '../../../../lib/toolset-form';
import { updateToolsetAction } from '../../actions';
import { ToolsetForm } from '../../toolset-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('ToolsetForm');
  return { title: t('metaTitleEdit', { slug }), robots: { index: false, follow: false } };
}

/**
 * `/toolsets/[slug]/edit` (#830). The API says whether this caller may edit
 * (`canEdit`: a DRAFT, its declarer); anyone else who can see the toolset is
 * told why it cannot be edited.
 */
export default async function EditToolsetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!ToolsetSlugSchema.safeParse(slug).success) notFound();
  const page = `/toolsets/${encodeURIComponent(slug)}`;
  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent(`${page}/edit`)}`);

  const [t, tList, toolset] = await Promise.all([
    getTranslations('ToolsetForm'),
    getTranslations('Toolsets'),
    apiFetch<ToolsetResponse>(`/v2/toolsets/${encodeURIComponent(slug)}`, {
      session,
      revalidate: 0,
    }),
  ]);
  if (!toolset) notFound();
  const kinds = ToolsetKindSchema.options.map((k) => ({ value: k, label: tList(`kind.${k}`) }));

  return (
    <Container size="xl">
      <Section spacing="md">
        <header className="mb-8 max-w-3xl space-y-3">
          <Link
            href={page}
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('backToToolset')}</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('eyebrow')}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('headingEdit')}</h1>
          <p className="text-[var(--color-muted-foreground)]">{t('introEdit')}</p>
        </header>
        {toolset.canEdit ? (
          <ToolsetForm
            mode="edit"
            action={updateToolsetAction.bind(null, toolset.slug)}
            initialValues={toolsetFormValuesFrom(toolset)}
            kinds={kinds}
            cancelHref={page}
          />
        ) : (
          <Alert tone="info" className="max-w-3xl">
            <AlertDescription>{t('notEditable')}</AlertDescription>
          </Alert>
        )}
      </Section>
    </Container>
  );
}
