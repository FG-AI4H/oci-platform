import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription, AlertTitle, ArrowLeftIcon, Container, Section } from '@oci/ui';
import type { EvaluationRouteResponse } from '@oci/shared-types';
import { auth } from '../../../../../../auth';
import { apiFetch } from '../../../../../../lib/api';
import { sortVersionsLatestFirst } from '../../../../../../components/evaluation/route-labels';
import { readRoutePermissions } from '../../../permissions';
import { DeclareForm } from './declare-form';
import { draftFromVersion, emptyDraft } from './declaration-draft';

/**
 * Declare a new version of an evaluation method (#649). Open to the
 * method's submitter (and `admin`), as `GET …/permissions` reports; anyone
 * else gets the reason instead of a form. The fields start from the latest
 * version, because a new version is usually a change to the last one.
 *
 * In the interface language (#654); the declarations prefilled from the
 * latest version are shown as the method's provider wrote them.
 */

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTranslations('EvaluationDeclare');
  return { title: t('metaTitle', { slug }), robots: { index: false } };
}

export default async function DeclareVersionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations('EvaluationDeclare');
  const route = await apiFetch<EvaluationRouteResponse>(
    `/v2/evaluation/routes/${encodeURIComponent(slug)}`,
    { revalidate: 0 },
  );
  if (!route) notFound();

  const session = await auth();
  const access = await readRoutePermissions(route.slug, session);
  const versions = sortVersionsLatestFirst(route.versions);
  const latest = versions[0] ?? null;
  const backHref = `/evaluation/routes/${route.slug}`;

  return (
    <Container size="lg">
      <Section spacing="md" className="space-y-6">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          <ArrowLeftIcon size={14} />
          <span>{t('back')}</span>
        </Link>
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('eyebrow')}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{route.name}</h1>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">{t('lead')}</p>
          {latest && access.status === 'ok' && access.permissions.canDeclareVersion ? (
            <p className="max-w-2xl text-sm">{t('startsFrom', { version: latest.version })}</p>
          ) : null}
        </header>

        {access.status === 'anonymous' ? (
          <Alert tone="info">
            <AlertTitle as="h2">{t('signedOutTitle')}</AlertTitle>
            <AlertDescription>
              {t('signedOut')}{' '}
              <Link
                href={`/signin?callbackUrl=${encodeURIComponent(`${backHref}/versions/new`)}`}
                className="underline underline-offset-2"
              >
                {t('signIn')}
              </Link>
            </AlertDescription>
          </Alert>
        ) : access.status === 'unavailable' ? (
          <Alert tone="warning">
            <AlertDescription>{t('unavailable')}</AlertDescription>
          </Alert>
        ) : !access.permissions.canDeclareVersion ? (
          <Alert tone="info">
            <AlertTitle as="h2">{t('notAllowedTitle')}</AlertTitle>
            <AlertDescription>{t('notAllowed')}</AlertDescription>
          </Alert>
        ) : (
          <DeclareForm
            slug={route.slug}
            existingVersions={versions.map((v) => v.version)}
            start={latest ? draftFromVersion(latest) : emptyDraft()}
          />
        )}
      </Section>
    </Container>
  );
}
