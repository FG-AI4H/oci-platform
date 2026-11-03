import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import type { ModelFactsLabel, PublicModelCard } from '@oci/shared-types';
import { apiFetch } from '../../../lib/api';
import {
  REGULATORY_STATUS_LABEL,
  REGULATORY_STATUS_TONE,
  humanise,
  modelClassLabel,
} from '../../../lib/model-card-labels';
import { modelCardJsonLd } from '../../../lib/model-jsonld';
import { siteUrl } from '../../../lib/site-url';
import { ModelFactsLabelCard } from './model-facts-label';

/**
 * Public model card page (#591). Anonymous on purpose — no session is
 * forwarded, so the API serves PUBLISHED cards only and 404s the rest, and
 * this page never shows a draft to someone who happens to be signed in.
 */

async function loadCard(slug: string): Promise<PublicModelCard | null> {
  return apiFetch<PublicModelCard>(`/v2/prediction/model-cards/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await loadCard(slug).catch(() => null);
  return {
    title: `${slug} — OCI Models`,
    ...(card?.clinicalSummary ? { description: card.clinicalSummary } : {}),
  };
}

export default async function ModelCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let card: PublicModelCard | null = null;
  let label: ModelFactsLabel | null = null;
  let error: string | null = null;
  try {
    card = await loadCard(slug);
    if (card) {
      label = await apiFetch<ModelFactsLabel>(
        `/v2/prediction/model-cards/${encodeURIComponent(slug)}/model-facts`,
      );
    }
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach the model catalogue API';
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle>Model catalogue unavailable</AlertTitle>
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
  const jsonLd = modelCardJsonLd(card, siteUrl());

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      <Section spacing="md" surface="hero">
        <Container size="xl">
          <Link
            href="/models"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>Models</span>
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
              <Badge tone="neutral">{modelClassLabel(card.modelClass)}</Badge>
              <Badge tone="info">Risk tier {ius.riskTier}</Badge>
              {card.generativeAi ? <Badge tone="accent">Generative AI</Badge> : null}
              {approval ? (
                <Badge tone={REGULATORY_STATUS_TONE[approval.status]}>
                  {REGULATORY_STATUS_LABEL[approval.status]}
                </Badge>
              ) : null}
            </div>
          </div>
        </Container>
      </Section>

      <Container size="xl">
        <Section spacing="md" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle as="h2">About this model</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term="Developer">{card.modelDeveloper ?? '—'}</DefinitionItem>
                <DefinitionItem term="Contact">{card.developerContact ?? '—'}</DefinitionItem>
                <DefinitionItem term="Model class">
                  {modelClassLabel(card.modelClass)}
                </DefinitionItem>
                <DefinitionItem term="Version" mono>
                  {card.versionMajorMinorPatch}
                </DefinitionItem>
                <DefinitionItem term="Medical purpose">
                  {ius.medicalPurpose === 'other' && ius.medicalPurposeOther
                    ? ius.medicalPurposeOther
                    : humanise(ius.medicalPurpose)}
                </DefinitionItem>
                {ius.bodySystemOrSite ? (
                  <DefinitionItem term="Body system or site">{ius.bodySystemOrSite}</DefinitionItem>
                ) : null}
                <DefinitionItem term="Training data from">
                  {card.trainingDataJurisdictions.length > 0
                    ? card.trainingDataJurisdictions.join(', ')
                    : '—'}
                </DefinitionItem>
                <DefinitionItem term="Regulatory approval">
                  {approval ? (
                    <>
                      {REGULATORY_STATUS_LABEL[approval.status]} · {approval.pathway}
                      {approval.jurisdictions.length > 0
                        ? ` · ${approval.jurisdictions.join(', ')}`
                        : null}
                      {approval.identifier ? (
                        <span className="block font-mono text-xs">{approval.identifier}</span>
                      ) : null}
                    </>
                  ) : (
                    'Not declared'
                  )}
                </DefinitionItem>
                <DefinitionItem term="Architecture">{card.architectureSummary}</DefinitionItem>
                {card.biasMitigationApproaches ? (
                  <DefinitionItem term="Bias mitigation">
                    {card.biasMitigationApproaches}
                  </DefinitionItem>
                ) : null}
                {card.securityPosture ? (
                  <DefinitionItem term="Security posture">{card.securityPosture}</DefinitionItem>
                ) : null}
              </DefinitionList>
            </CardContent>
          </Card>

          {label ? (
            <ModelFactsLabelCard label={label} />
          ) : (
            <Alert tone="info">
              <AlertTitle>Model Facts label unavailable</AlertTitle>
              <AlertDescription>
                The label for this model could not be generated right now. The card details are
                still accurate.
              </AlertDescription>
            </Alert>
          )}
        </Section>
      </Container>
    </>
  );
}
