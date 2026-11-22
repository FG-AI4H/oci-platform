import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InfoIcon,
} from '@oci/ui';
import { useLocale, useTranslations } from 'next-intl';
import type { ModelFactsLabel } from '@oci/shared-types';
import { formattersFor } from '../../../i18n/format';
import {
  clinicalPathwayText,
  intendedUserText,
  medicalPurposeText,
  modelClassText,
  operatingEnvironmentText,
  type ModelLabelTranslator,
} from '../../../lib/model-card-labels';

/**
 * WHO Fig. 7 Model Facts Label (#261), rendered from
 * `GET /v2/prediction/model-cards/:slug/model-facts` (#591).
 *
 * The label is the API's rendering — this component only lays it out. Its
 * `gaps` are shown, not hidden: the label states what it could not populate
 * so a reader can tell "not applicable" from "not known yet".
 */

export function ModelFactsLabelCard({ label }: { label: ModelFactsLabel }) {
  const t = useTranslations('Models');
  const f = formattersFor(useLocale());
  const uses = label.usesAndDirections;
  const perf = label.validationAndPerformance;
  return (
    <Card role="region" aria-labelledby="model-facts-heading">
      <CardHeader>
        <CardTitle as="h2" id="model-facts-heading">
          {t('facts.title')}
        </CardTitle>
        <CardDescription>
          {t('facts.generatedOn', { date: f.date(label.generatedAt, { dateStyle: 'medium' }) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FactsSection title={t('facts.summary')}>
          <p>{label.summary.text}</p>
        </FactsSection>

        <FactsSection title={t('facts.mechanism')}>
          <p>{label.mechanism.text}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="neutral">{modelClassText(t, label.mechanism.modelClass)}</Badge>
            {label.mechanism.generativeAi ? <Badge tone="accent">{t('generativeAi')}</Badge> : null}
          </p>
        </FactsSection>

        <FactsSection title={t('facts.validation')}>
          {perf.entries.length === 0 ? (
            <p className="text-[var(--color-muted-foreground)]">{t('facts.noPerformance')}</p>
          ) : (
            <ul className="space-y-1">
              {perf.entries.map((e) => (
                <li key={e.taskSlug}>
                  <span className="font-mono">{e.taskSlug}</span>: {e.primaryMetricLabel}{' '}
                  <span className="tabular-nums">
                    {f.number(e.primaryMetricValue, {
                      minimumFractionDigits: 3,
                      maximumFractionDigits: 3,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!perf.subgroupAvailable ? (
            <p className="mt-2 text-[var(--color-muted-foreground)]">{perf.subgroupNote}</p>
          ) : null}
        </FactsSection>

        <FactsSection title={t('facts.uses')}>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
            <Fact term={t('facts.medicalPurpose')}>
              {medicalPurposeText(t, uses.medicalPurpose)}
            </Fact>
            <Fact term={t('facts.intendedUsers')}>
              {listOrDash(t, uses.intendedUsers, intendedUserText)}
            </Fact>
            <Fact term={t('facts.clinicalPathway')}>
              {uses.clinicalPathway ? clinicalPathwayText(t, uses.clinicalPathway) : '—'}
            </Fact>
            <Fact term={t('facts.operatingEnvironments')}>
              {listOrDash(t, uses.operatingEnvironments, operatingEnvironmentText)}
            </Fact>
            <Fact term={t('facts.targetPopulation')}>{uses.targetPopulation ?? '—'}</Fact>
          </dl>
        </FactsSection>

        <FactsSection title={t('facts.warnings')}>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
            <Fact term={t('facts.riskTier')}>{label.warnings.riskTier}</Fact>
            <Fact term={t('facts.foreseeableMisuse')}>{label.warnings.foreseeableMisuse}</Fact>
            <Fact term={t('facts.contraindications')}>
              {label.warnings.contraindications || '—'}
            </Fact>
            <Fact term={t('facts.knownBiases')}>
              {label.warnings.knownBiasesOrEthicalConsiderations ?? '—'}
            </Fact>
          </dl>
        </FactsSection>

        <FactsSection title={t('facts.generalisability')}>
          <p>{label.generalisability.statement}</p>
        </FactsSection>

        <FactsSection title={t('facts.discontinue')}>
          <p>{label.discontinueUse.statement}</p>
        </FactsSection>

        {label.gaps.length > 0 ? (
          <section
            aria-labelledby="model-facts-gaps"
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4"
          >
            <h3
              id="model-facts-gaps"
              className="flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]"
            >
              <InfoIcon size={14} aria-hidden="true" />
              {t('facts.gaps')}
            </h3>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-[var(--color-muted-foreground)]">
              {label.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FactsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--color-border)] pt-4 first:border-t-0 first:pt-0 text-sm">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[var(--color-muted-foreground)]">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function listOrDash(
  t: ModelLabelTranslator,
  values: string[],
  text: (t: ModelLabelTranslator, value: string) => string,
): string {
  return values.length > 0 ? values.map((v) => text(t, v)).join(', ') : '—';
}
