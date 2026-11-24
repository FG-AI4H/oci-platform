import {
  ModelFactsLabelSchema,
  type ModelCardResponse,
  type ModelFactsPerformanceEntry,
  type ModelFactsStanding,
} from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import type { ModelCardPerformance } from '../../evaluation/model-card-evidence.js';
import { buildModelFactsLabel } from './model-facts-label.js';
import { renderModelFactsMarkdown } from './render-model-facts-markdown.js';

/**
 * #587 — the Model Facts performance rows: published results apart from the
 * rest, in the JSON and in the markdown, with the gaps that say what is not
 * shown. The subgroup note stays as it is.
 */

const CARD = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'acme-retina',
  submitterUserId: null,
  intendedUse: {
    v: 1,
    medicalPurpose: 'triage',
    foreseeableMisuse: 'Use outside the validated population.',
    contraindications: '',
    riskTier: 'II',
  },
  modelClass: 'classical',
  architectureSummary: 'CNN.',
  trainingDataLineage: {},
  parentModelCardId: null,
  versionMajorMinorPatch: '1.0.0',
  changeJustification: null,
  materialChange: false,
  trainingDataJurisdictions: [],
  generativeAi: false,
  lmmSpecificLimitations: null,
  status: 'PUBLISHED',
  modelDeveloper: 'Acme',
  developerContact: 'contact@acme.example',
  clinicalSummary: 'Grades retinopathy.',
  regulatoryApproval: null,
  knownBiasesOrEthicalConsiderations: null,
  biasMitigationApproaches: null,
  ongoingMaintenance: null,
  securityPosture: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
} as unknown as ModelCardResponse;

let n = 0;
function entry(standing: ModelFactsStanding, over: Partial<ModelFactsPerformanceEntry> = {}) {
  n += 1;
  const routed = standing !== 'NOT_ATTRIBUTED';
  return {
    submissionId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    taskSlug: 'idrid-grading',
    taskName: 'Retinopathy grading',
    taskKind: 'GRADING',
    primaryMetricLabel: 'Quadratic-weighted kappa',
    primaryMetricValue: 0.81234,
    coverage: 0.95,
    datasetSlug: 'idrid',
    datasetVersion: '1.1.0',
    routeSlug: routed ? 'oci-predictions-scoring' : null,
    routeVersion: routed ? '1.0.0' : null,
    routeReviewStatus: standing === 'PUBLISHED' ? 'APPROVED' : routed ? 'UNDER_REVIEW' : null,
    standing,
    evaluatedAt: '2026-11-20T10:00:00.000Z',
    ...over,
  } satisfies ModelFactsPerformanceEntry;
}

function label(performance: ModelCardPerformance) {
  const out = buildModelFactsLabel({
    card: CARD,
    performance,
    generatedAt: new Date('2026-11-24T00:00:00.000Z'),
  });
  // The label is what the API returns: it must satisfy the shared schema.
  return ModelFactsLabelSchema.parse(out);
}

const gapsOf = (l: ReturnType<typeof label>) => l.gaps.join('\n');

describe('Model Facts performance (#587)', () => {
  it('with nothing linked, says so and lists nothing', () => {
    const l = label({ entries: [], retracted: 0, notEstimable: 0 });
    expect(l.validationAndPerformance.entries).toEqual([]);
    expect(l.validationAndPerformance.provisional).toEqual([]);
    expect(gapsOf(l)).toContain('no evaluation results are linked');
    expect(renderModelFactsMarkdown(l)).toContain(
      '_No evaluation results are linked to this model card._',
    );
  });

  it('puts published results in `entries` and every other one in `provisional`', () => {
    const published = entry('PUBLISHED');
    const underReview = entry('PROVISIONAL');
    const legacy = entry('NOT_ATTRIBUTED');
    const l = label({ entries: [published, underReview, legacy], retracted: 0, notEstimable: 0 });

    expect(l.validationAndPerformance.entries).toEqual([published]);
    expect(l.validationAndPerformance.provisional).toEqual([underReview, legacy]);
    expect(l.validationAndPerformance.entries.every((e) => e.standing === 'PUBLISHED')).toBe(true);
    expect(gapsOf(l)).not.toContain('no published performance');
    expect(gapsOf(l)).toContain('Not attributed: 1 linked result carries no evaluation method');
    expect(gapsOf(l)).toContain('Provisional: 1 linked result comes from');
    expect(gapsOf(l)).toContain('Dataset version:');
  });

  it('LEGACY results only (every result until #583): nothing is published', () => {
    const l = label({
      entries: [entry('NOT_ATTRIBUTED'), entry('NOT_ATTRIBUTED')],
      retracted: 0,
      notEstimable: 0,
    });

    expect(l.validationAndPerformance.entries).toEqual([]);
    expect(l.validationAndPerformance.provisional).toHaveLength(2);
    expect(gapsOf(l)).toContain('none of the linked results comes from an approved');
    expect(gapsOf(l)).toContain('Not attributed: 2 linked results carry');

    const md = renderModelFactsMarkdown(l);
    const published = md.slice(md.indexOf('### Published results'), md.indexOf('### Provisional'));
    expect(published).toContain('_None. No linked result comes from an approved');
    expect(published).not.toContain('idrid-grading');
    expect(md).toContain('### Provisional results (not published evidence)');
    expect(md).toContain('Provisional (no method version recorded)');
    expect(md).not.toContain('| Published |');
  });

  it('renders a published row with task, metric, value, dataset version, method version and date', () => {
    const l = label({ entries: [entry('PUBLISHED')], retracted: 0, notEstimable: 0 });
    const md = renderModelFactsMarkdown(l);

    expect(md).toContain(
      '| Task | Primary metric | Value | Coverage | Dataset | Method version | Standing | Evaluated |',
    );
    expect(md).toContain(
      '| Retinopathy grading (`idrid-grading`) | Quadratic-weighted kappa | 0.812 | 95.0% | idrid 1.1.0 | oci-predictions-scoring 1.0.0 | Published | 2026-11-20T10:00:00.000Z |',
    );
    expect(md).not.toContain('### Provisional');
  });

  it('labels a result from a version under review as provisional', () => {
    const md = renderModelFactsMarkdown(
      label({ entries: [entry('PROVISIONAL')], retracted: 0, notEstimable: 0 }),
    );
    expect(md).toContain('Provisional (method version under review)');
  });

  it('counts retracted and not-estimable results in the gaps', () => {
    const l = label({ entries: [], retracted: 2, notEstimable: 1 });
    expect(gapsOf(l)).toContain('Retracted: 2 linked results are not shown');
    expect(gapsOf(l)).toContain('Not estimable: 1 linked result has no estimable primary metric');
    // Linked, but nothing showable: not the "nothing linked" sentence.
    expect(gapsOf(l)).not.toContain('no evaluation results are linked');
  });

  it('keeps the subgroup gap note', () => {
    const l = label({ entries: [entry('PUBLISHED')], retracted: 0, notEstimable: 0 });
    expect(l.validationAndPerformance.subgroupAvailable).toBe(false);
    expect(gapsOf(l)).toContain('Per-subgroup performance');
    expect(renderModelFactsMarkdown(l)).toContain('**Per-subgroup:**');
  });

  it('cannot break a table row with a pipe in a task name', () => {
    const md = renderModelFactsMarkdown(
      label({
        entries: [entry('PUBLISHED', { taskName: 'Left | right' })],
        retracted: 0,
        notEstimable: 0,
      }),
    );
    expect(md).toContain('Left \\| right');
  });
});
