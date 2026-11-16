import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InfoIcon,
} from '@oci/ui';
import type { ModelFactsLabel } from '@oci/shared-types';
import { humanise, modelClassLabel } from '../../../lib/model-card-labels';

/**
 * WHO Fig. 7 Model Facts Label (#261), rendered from
 * `GET /v2/prediction/model-cards/:slug/model-facts` (#591).
 *
 * The label is the API's rendering — this component only lays it out. Its
 * `gaps` are shown, not hidden: the label states what it could not populate
 * so a reader can tell "not applicable" from "not known yet".
 */

const DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

export function ModelFactsLabelCard({ label }: { label: ModelFactsLabel }) {
  const uses = label.usesAndDirections;
  const perf = label.validationAndPerformance;
  return (
    <Card role="region" aria-labelledby="model-facts-heading">
      <CardHeader>
        <CardTitle as="h2" id="model-facts-heading">
          Model Facts
        </CardTitle>
        <CardDescription>
          WHO model facts label, generated from this card on{' '}
          {DATE.format(new Date(label.generatedAt))}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FactsSection title="Summary">
          <p>{label.summary.text}</p>
        </FactsSection>

        <FactsSection title="Mechanism">
          <p>{label.mechanism.text}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="neutral">{modelClassLabel(label.mechanism.modelClass)}</Badge>
            {label.mechanism.generativeAi ? <Badge tone="accent">Generative AI</Badge> : null}
          </p>
        </FactsSection>

        <FactsSection title="Validation and performance">
          {perf.entries.length === 0 ? (
            <p className="text-[var(--color-muted-foreground)]">No measured performance yet.</p>
          ) : (
            <ul className="space-y-1">
              {perf.entries.map((e) => (
                <li key={e.taskSlug}>
                  <span className="font-mono">{e.taskSlug}</span>: {e.primaryMetricLabel}{' '}
                  <span className="tabular-nums">{e.primaryMetricValue.toFixed(3)}</span>
                </li>
              ))}
            </ul>
          )}
          {!perf.subgroupAvailable ? (
            <p className="mt-2 text-[var(--color-muted-foreground)]">{perf.subgroupNote}</p>
          ) : null}
        </FactsSection>

        <FactsSection title="Uses and directions">
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
            <Fact term="Medical purpose">{humanise(uses.medicalPurpose)}</Fact>
            <Fact term="Intended users">{listOrDash(uses.intendedUsers)}</Fact>
            <Fact term="Clinical pathway">
              {uses.clinicalPathway ? humanise(uses.clinicalPathway) : '—'}
            </Fact>
            <Fact term="Operating environments">{listOrDash(uses.operatingEnvironments)}</Fact>
            <Fact term="Target population">{uses.targetPopulation ?? '—'}</Fact>
          </dl>
        </FactsSection>

        <FactsSection title="Warnings">
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
            <Fact term="Risk tier">{label.warnings.riskTier}</Fact>
            <Fact term="Foreseeable misuse">{label.warnings.foreseeableMisuse}</Fact>
            <Fact term="Contraindications">{label.warnings.contraindications || '—'}</Fact>
            <Fact term="Known biases">
              {label.warnings.knownBiasesOrEthicalConsiderations ?? '—'}
            </Fact>
          </dl>
        </FactsSection>

        <FactsSection title="Generalisability">
          <p>{label.generalisability.statement}</p>
        </FactsSection>

        <FactsSection title="When to discontinue use">
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
              Known gaps in this label
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

function listOrDash(values: string[]): string {
  return values.length > 0 ? values.map(humanise).join(', ') : '—';
}
