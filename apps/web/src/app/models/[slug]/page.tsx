import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  DefinitionItem,
  DefinitionList,
  Section,
} from '@oci/ui';
import {
  canEditModelCard,
  modelCardMovesFor,
  type ModelCardResponse,
  type ModelFactsLabel,
  type PublicModelCard,
} from '@oci/shared-types';
import { auth } from '../../../auth';
import { apiFetch } from '../../../lib/api';
import {
  REGULATORY_STATUS_TONE,
  medicalPurposeText,
  modelClassText,
  regulatoryStatusText,
} from '../../../lib/model-card-labels';
import { modelCardViewer } from '../../../lib/model-card-viewer';
import { modelCardJsonLd } from '../../../lib/model-jsonld';
import { siteUrl } from '../../../lib/site-url';
import { ModelCardLifecyclePanel } from './lifecycle-panel';
import { ModelFactsLabelCard } from './model-facts-label';

/**
 * Model card page (#591, #651).
 *
 * Anonymous callers get the public page: no session is forwarded, so the API
 * serves PUBLISHED cards only and 404s the rest. A signed-in caller's token
 * is forwarded (#651), so the card's submitter and the reviewers also reach
 * a DRAFT or SUBMITTED card, with its status and the moves they may make.
 * What a signed-in caller may see is still the API's decision
 * (`findVisible`); the page renders the public fields only whatever comes
 * back, and the JSON-LD only for a PUBLISHED card.
 */

async function loadCard(slug: string): Promise<PublicModelCard | null> {
  return apiFetch<PublicModelCard>(`/v2/prediction/model-cards/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [card, t] = await Promise.all([
    loadCard(slug).catch(() => null),
    getTranslations('Models'),
  ]);
  return {
    title: t('detail.metaTitle', { slug }),
    ...(card?.clinicalSummary ? { description: card.clinicalSummary } : {}),
    // Not public (a draft, a submission): nothing for a crawler to index.
    ...(card ? {} : { robots: { index: false, follow: false } }),
  };
}

export default async function ModelCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [t, tForm, session] = await Promise.all([
    getTranslations('Models'),
    getTranslations('ModelCardForm'),
    auth(),
  ]);
  const signedIn = Boolean(session?.user);

  let card: PublicModelCard | null = null;
  let label: ModelFactsLabel | null = null;
  let error: string | null = null;
  try {
    card = signedIn
      ? await apiFetch<ModelCardResponse>(
          `/v2/prediction/model-cards/${encodeURIComponent(slug)}`,
          { session, revalidate: 0 },
        )
      : await loadCard(slug);
    // A DRAFT has no label (the API answers 409): say so instead of asking.
    if (card && card.status !== 'DRAFT') {
      label = await apiFetch<ModelFactsLabel>(
        `/v2/prediction/model-cards/${encodeURIComponent(slug)}/model-facts`,
        signedIn ? { session, revalidate: 0 } : {},
      );
    }
  } catch (err) {
    error = err instanceof Error ? err.message : t('unavailable.fallback');
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle>{t('unavailable.title')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        </Section>
      </Container>
    );
  }

  if (!card) notFound();

  const ius = card.intendedUse;
  const approval = card.regulatoryApproval;
  const published = card.status === 'PUBLISHED';
  const jsonLd = published ? modelCardJsonLd(card, siteUrl()) : null;
  const viewer = signedIn ? await modelCardViewer(session, card.slug) : null;
  const showLifecycle = viewer !== null && (viewer.isSubmitter || viewer.isReviewer || !published);

  return (
    <>
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      ) : null}

      <Section spacing="md" surface="hero">
        <Container size="xl">
          <Link
            href="/models"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('detail.back')}</span>
          </Link>
          <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1 min-w-0">
              {card.modelDeveloper ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {card.modelDeveloper}
                </p>
              ) : null}
              <h1 className="mt-2 break-words text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-foreground)]">
                {card.slug}
              </h1>
              {card.clinicalSummary ? (
                <p className="mt-4 max-w-2xl text-[var(--color-muted-foreground)]">
                  {card.clinicalSummary}
                </p>
              ) : null}
            </div>
            <div className="flex flex-row flex-wrap items-start gap-2 lg:flex-col lg:items-end">
              <Badge tone="primary">v{card.versionMajorMinorPatch}</Badge>
              <Badge tone="neutral">{modelClassText(t, card.modelClass)}</Badge>
              <Badge tone="info">{t('riskTier', { tier: ius.riskTier })}</Badge>
              {card.generativeAi ? <Badge tone="accent">{t('generativeAi')}</Badge> : null}
              {approval ? (
                <Badge tone={REGULATORY_STATUS_TONE[approval.status]}>
                  {regulatoryStatusText(t, approval.status)}
                </Badge>
              ) : null}
            </div>
          </div>
        </Container>
      </Section>

      {showLifecycle && viewer ? (
        <Container size="xl">
          <div className="pt-8">
            <ModelCardLifecyclePanel
              slug={card.slug}
              status={card.status}
              moves={modelCardMovesFor(card.status, viewer)}
              canEdit={canEditModelCard(card.status, viewer)}
            />
          </div>
        </Container>
      ) : null}

      <Container size="xl">
        <Section spacing="md" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle as="h2">{t('detail.about')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term={t('detail.developer')}>
                  {card.modelDeveloper ?? '—'}
                </DefinitionItem>
                <DefinitionItem term={t('detail.contact')}>
                  {card.developerContact ?? '—'}
                </DefinitionItem>
                <DefinitionItem term={t('detail.modelClass')}>
                  {modelClassText(t, card.modelClass)}
                </DefinitionItem>
                <DefinitionItem term={t('detail.version')} mono>
                  {card.versionMajorMinorPatch}
                </DefinitionItem>
                <DefinitionItem term={t('detail.medicalPurpose')}>
                  {ius.medicalPurpose === 'other' && ius.medicalPurposeOther
                    ? ius.medicalPurposeOther
                    : medicalPurposeText(t, ius.medicalPurpose)}
                </DefinitionItem>
                {ius.bodySystemOrSite ? (
                  <DefinitionItem term={t('detail.bodySystem')}>
                    {ius.bodySystemOrSite}
                  </DefinitionItem>
                ) : null}
                <DefinitionItem term={t('detail.trainingDataFrom')}>
                  {card.trainingDataJurisdictions.length > 0
                    ? card.trainingDataJurisdictions.join(', ')
                    : '—'}
                </DefinitionItem>
                <DefinitionItem term={t('detail.regulatoryApproval')}>
                  {approval ? (
                    <>
                      {regulatoryStatusText(t, approval.status)} · {approval.pathway}
                      {approval.jurisdictions.length > 0
                        ? ` · ${approval.jurisdictions.join(', ')}`
                        : null}
                      {approval.identifier ? (
                        <span className="block font-mono text-xs">{approval.identifier}</span>
                      ) : null}
                    </>
                  ) : (
                    t('detail.notDeclared')
                  )}
                </DefinitionItem>
                <DefinitionItem term={t('detail.architecture')}>
                  {card.architectureSummary}
                </DefinitionItem>
                {card.biasMitigationApproaches ? (
                  <DefinitionItem term={t('detail.biasMitigation')}>
                    {card.biasMitigationApproaches}
                  </DefinitionItem>
                ) : null}
              </DefinitionList>
            </CardContent>
          </Card>

          {label ? (
            <ModelFactsLabelCard label={label} />
          ) : card.status === 'DRAFT' ? (
            <Alert tone="info" className="h-fit">
              <AlertTitle>{tForm('lifecycle.factsDraftTitle')}</AlertTitle>
              <AlertDescription>{tForm('lifecycle.factsDraft')}</AlertDescription>
            </Alert>
          ) : (
            <Alert tone="info" className="h-fit">
              <AlertTitle>{t('detail.factsUnavailableTitle')}</AlertTitle>
              <AlertDescription>{t('detail.factsUnavailableBody')}</AlertDescription>
            </Alert>
          )}
        </Section>
      </Container>
    </>
  );
}
