import type { EvaluationSubmissionResult, EvaluationTaskDetail } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import {
  isExportableResult,
  metricDefsFor,
  problemId,
  toEvaluationResults,
  toTaskProblem,
} from './croissant-tasks.js';
import { acceptsItemScores } from './scoring-registry.js';

const BASE = 'https://dev.oci.ai4h.net';

const ROUTED = {
  kind: 'ROUTED' as const,
  routeSlug: 'predictions-file',
  routeVersion: '1.0.0',
  reviewStatus: 'APPROVED' as const,
  published: true,
  retractedAt: null,
};

function grading(overrides: Partial<EvaluationTaskDetail> = {}): EvaluationTaskDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'idrid-dr-grading',
    name: 'IDRiD — diabetic retinopathy severity grading (demo)',
    datasetSlug: 'idrid-grading-demo',
    taskKind: 'GRADING',
    numClasses: 5,
    referableThreshold: 2,
    positiveClassName: null,
    createdAt: '2026-09-09T15:44:31.003Z',
    updatedAt: '2026-11-19T14:00:00.000Z',
    itemIds: ['IDRiD_001', 'IDRiD_002'],
    itemCount: 2,
    subgroupFields: [],
    submissions: [],
    ...overrides,
  } as EvaluationTaskDetail;
}

function scoredGrading(
  id: string,
  qwk: number,
  extra: Partial<EvaluationSubmissionResult> = {},
): EvaluationSubmissionResult {
  return {
    id,
    methodName: `method ${id.slice(0, 4)}`,
    status: 'SCORED',
    scores: {
      kind: 'GRADING',
      metrics: {
        qwk,
        accuracy: 0.6,
        referableSensitivity: 0.8,
        referableSpecificity: 0.7,
        coverage: 1,
      },
    },
    attribution: ROUTED,
    createdAt: '2026-11-19T14:10:00.000Z',
    ...extra,
  } as EvaluationSubmissionResult;
}

describe('toTaskProblem', () => {
  const doc = toTaskProblem(grading(), { baseUrl: BASE });

  it('is a TaskProblem identified by its own URL', () => {
    expect(doc['@type']).toBe('croissant:TaskProblem');
    expect(doc['@id']).toBe(`${BASE}/v2/evaluation/tasks/idrid-dr-grading/croissant-task.jsonld`);
    expect(doc['@context']).toMatchObject({ croissant: 'http://mlcommons.org/croissant/' });
  });

  it('points its input at the dataset with the same identifier the Croissant index uses', () => {
    expect(doc['croissant:input']).toMatchObject({
      '@type': 'schema:Dataset',
      '@id': `${BASE}/v2/catalog/datasets/idrid-grading-demo`,
      'schema:url': `${BASE}/v2/catalog/datasets/idrid-grading-demo/croissant`,
    });
  });

  it('declares the expected output as an OutputSpec, which makes it a valid TaskProblem', () => {
    const output = doc['croissant:output'] as Record<string, unknown>;
    expect(output['@type']).toBe('croissant:OutputSpec');
    const fields = (
      output['croissant:schema'] as { 'croissant:field': { 'schema:name': string }[] }
    )['croissant:field'].map((f) => f['schema:name']);
    expect(fields).toEqual(['item_id', 'label']);
  });

  it('lists the kind metrics, primary first, all higher-is-better', () => {
    const metrics = (
      doc['croissant:evaluation'] as { 'croissant:expectedMetric': Record<string, unknown>[] }
    )['croissant:expectedMetric'];
    expect(metrics.map((m) => m['schema:identifier'])).toEqual(
      metricDefsFor('GRADING').map((m) => m.key),
    );
    expect(metrics[0]?.['schema:identifier']).toBe('qwk');
    expect(metrics[0]?.['schema:description']).toMatch(/Primary metric/);
    expect(metrics.every((m) => m['croissant:lowerIsBetter'] === false)).toBe(true);
  });

  it('adds the score column only for a kind that accepts per-item scores', () => {
    const binary = toTaskProblem(
      grading({ taskKind: 'BINARY_DIAGNOSTIC', numClasses: 2, positiveClassName: 'referable DR' }),
      { baseUrl: BASE },
    );
    const names = (
      (binary['croissant:output'] as Record<string, unknown>)['croissant:schema'] as {
        'croissant:field': { 'schema:name': string }[];
      }
    )['croissant:field'].map((f) => f['schema:name']);
    expect(names.includes('score')).toBe(acceptsItemScores('BINARY_DIAGNOSTIC'));
    expect(String(binary['schema:description'])).toContain('referable DR');
  });

  it('never carries the item identifiers or anything label-derived', () => {
    const text = JSON.stringify(doc);
    expect(text).not.toContain('IDRiD_001');
    expect(text).not.toContain('groundTruth');
  });
});

describe('isExportableResult', () => {
  it('keeps a scored, routed, published, unretracted result', () => {
    expect(isExportableResult(scoredGrading('aaaaaaaa-0000-4000-8000-000000000001', 0.7))).toBe(
      true,
    );
  });

  it.each([
    ['failed', { status: 'FAILED', scores: null, attribution: null }],
    ['pending', { status: 'PENDING', scores: null, attribution: null }],
    ['legacy', { attribution: { kind: 'LEGACY', note: 'n' } }],
    ['unpublished route', { attribution: { ...ROUTED, published: false } }],
    ['retracted', { attribution: { ...ROUTED, retractedAt: '2026-11-20T00:00:00.000Z' } }],
  ])('drops a %s result', (_label, extra) => {
    expect(
      isExportableResult(
        scoredGrading(
          'aaaaaaaa-0000-4000-8000-000000000002',
          0.7,
          extra as Partial<EvaluationSubmissionResult>,
        ),
      ),
    ).toBe(false);
  });
});

describe('toEvaluationResults', () => {
  const kept = scoredGrading('aaaaaaaa-0000-4000-8000-000000000003', 0.81);
  const doc = toEvaluationResults(
    grading({
      submissions: [
        kept,
        scoredGrading('aaaaaaaa-0000-4000-8000-000000000004', 0.5, {
          attribution: { kind: 'LEGACY', note: 'n' },
        } as Partial<EvaluationSubmissionResult>),
      ],
    }),
    { baseUrl: BASE },
  );
  const graph = doc['@graph'] as Record<string, unknown>[];

  it('has no top-level @id, so readers load it into the default graph', () => {
    expect(doc['@id']).toBeUndefined();
  });

  it('emits one EvaluationTask per exportable result', () => {
    expect(graph).toHaveLength(1);
    expect(graph[0]?.['@type']).toBe('croissant:EvaluationTask');
  });

  it('links the solution to the problem and names the method', () => {
    const solution = graph[0]?.['croissant:evaluatedSolution'] as Record<string, unknown>;
    expect(solution['@type']).toBe('croissant:TaskSolution');
    expect(solution['schema:isBasedOn']).toEqual({ '@id': problemId(BASE, 'idrid-dr-grading') });
    expect(solution['schema:name']).toBe(kept.methodName);
    expect(solution['@id']).toBe(`${BASE}/evaluation/idrid-dr-grading/submissions/${kept.id}`);
  });

  it('reports each metric against the MetricSpec of the problem', () => {
    const results = graph[0]?.['croissant:evaluationResults'] as Record<string, unknown>[];
    expect(results[0]).toEqual({
      '@type': 'croissant:EvaluationResult',
      'croissant:metric': { '@id': `${problemId(BASE, 'idrid-dr-grading')}#metric-qwk` },
      'croissant:value': 0.81,
      'croissant:lowerIsBetter': false,
    });
    expect(results).toHaveLength(5);
  });

  it('carries the route that produced the score', () => {
    expect(graph[0]?.['croissant:execution']).toMatchObject({
      '@type': 'croissant:ExecutionInfo',
      'schema:identifier': 'predictions-file@1.0.0',
    });
  });

  it('writes interval estimates as QuantitativeValue and skips metrics that are not estimable', () => {
    const est = (estimate: number) => ({
      estimate,
      lower: estimate - 0.1,
      upper: estimate + 0.05,
      numerator: 8,
      denominator: 10,
    });
    const binary = toEvaluationResults(
      grading({
        taskKind: 'BINARY_DIAGNOSTIC',
        numClasses: 2,
        positiveClassName: 'referable DR',
        submissions: [
          {
            ...kept,
            scores: {
              kind: 'BINARY_DIAGNOSTIC',
              metrics: {
                truePositives: 8,
                falsePositives: 1,
                trueNegatives: 9,
                falseNegatives: 2,
                prevalence: est(0.5),
                sensitivity: est(0.8),
                specificity: est(0.9),
                positivePredictiveValue: est(0.89),
                negativePredictiveValue: null,
                accuracy: est(0.85),
                balancedAccuracy: 0.85,
                auc: null,
                coverage: 1,
              },
            },
          } as EvaluationSubmissionResult,
        ],
      }),
      { baseUrl: BASE },
    );
    const results = (binary['@graph'] as Record<string, unknown>[])[0]?.[
      'croissant:evaluationResults'
    ] as Record<string, unknown>[];
    const ids = results.map(
      (r) => String((r['croissant:metric'] as { '@id': string })['@id']).split('#metric-')[1],
    );
    expect(ids).toEqual([
      'balancedAccuracy',
      'sensitivity',
      'specificity',
      'positivePredictiveValue',
      'accuracy',
      'coverage',
    ]);
    expect(results[1]?.['croissant:value']).toMatchObject({
      '@type': 'schema:QuantitativeValue',
      'schema:value': 0.8,
      'schema:minValue': expect.closeTo(0.7, 10),
      'schema:maxValue': expect.closeTo(0.85, 10),
    });
  });
});
