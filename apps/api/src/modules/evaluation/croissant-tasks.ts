import type {
  EvaluationSubmissionResult,
  EvaluationTaskDetail,
  EvaluationTaskKindDb,
  TaskKindScores,
} from '@oci/shared-types';
import { acceptsItemScores } from './scoring-registry.js';

/**
 * Croissant Tasks export (#803).
 *
 * MLCommons Croissant Tasks (ontology, SHACL shapes and validator in the
 * `tasks/` folder of `mlcommons/croissant`) describes a benchmark as a
 * `croissant:TaskProblem` and each result as a `croissant:EvaluationTask`
 * that scores a `croissant:TaskSolution` against it. This module maps the
 * PUBLIC task detail (`EvaluationTaskDetail`, the body of
 * `GET /v2/evaluation/tasks/:slug`) to both documents.
 *
 * Input is the public detail on purpose: it is the same object the task page
 * reads, so the export cannot carry anything that endpoint does not already
 * disclose. No ground truth, no label-derived value.
 *
 * Models are out of scope: Croissant does not describe models. A solution
 * here is the submitted method, named as the participant named it.
 */

const CONTEXT = {
  croissant: 'http://mlcommons.org/croissant/',
  schema: 'https://schema.org/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
} as const;

type JsonLd = Record<string, unknown>;

/** One metric a task kind reports, in the order the kind reports them. */
interface MetricDef {
  /** Key in the scores object. */
  key: string;
  name: string;
  description: string;
}

/**
 * Per kind, the reported metrics, primary metric FIRST (the one results are
 * ordered by; see `primaryMetricLabel` in the scoring registry). Every metric
 * here is higher-is-better. Per-class tables, confusion counts and prevalence
 * are left out: they are descriptive, not scores a solution is ranked on.
 */
const METRICS: Readonly<Record<EvaluationTaskKindDb, readonly MetricDef[]>> = {
  GRADING: [
    {
      key: 'qwk',
      name: 'Quadratic-weighted kappa',
      description: 'Ordinal agreement between predicted and reference grades.',
    },
    { key: 'accuracy', name: 'Accuracy', description: 'Exact-match accuracy over matched items.' },
    {
      key: 'referableSensitivity',
      name: 'Referable sensitivity',
      description: 'Sensitivity for the referable class (grade at or above the threshold).',
    },
    {
      key: 'referableSpecificity',
      name: 'Referable specificity',
      description: 'Specificity for the non-referable class (grade below the threshold).',
    },
    {
      key: 'coverage',
      name: 'Coverage',
      description: 'Fraction of the reference items that were predicted.',
    },
  ],
  CLASSIFICATION: [
    { key: 'macroF1', name: 'Macro F1', description: 'Mean per-class F1.' },
    { key: 'accuracy', name: 'Accuracy', description: 'Exact-match accuracy over matched items.' },
    {
      key: 'balancedAccuracy',
      name: 'Balanced accuracy',
      description: 'Mean per-class recall.',
    },
    { key: 'microF1', name: 'Micro F1', description: 'Pooled F1 over all items.' },
    {
      key: 'coverage',
      name: 'Coverage',
      description: 'Fraction of the reference items that were predicted.',
    },
  ],
  BINARY_DIAGNOSTIC: [
    {
      key: 'balancedAccuracy',
      name: 'Balanced accuracy',
      description: 'Mean of sensitivity and specificity.',
    },
    {
      key: 'sensitivity',
      name: 'Sensitivity',
      description: 'True-positive rate, with a Wilson 95% interval.',
    },
    {
      key: 'specificity',
      name: 'Specificity',
      description: 'True-negative rate, with a Wilson 95% interval.',
    },
    {
      key: 'positivePredictiveValue',
      name: 'Positive predictive value',
      description: 'Precision for the positive class, with a Wilson 95% interval.',
    },
    {
      key: 'negativePredictiveValue',
      name: 'Negative predictive value',
      description: 'Precision for the negative class, with a Wilson 95% interval.',
    },
    { key: 'accuracy', name: 'Accuracy', description: 'With a Wilson 95% interval.' },
    {
      key: 'auc',
      name: 'Area under the ROC curve',
      description:
        'From per-item scores, with a bootstrap 95% interval; present only when every item carried a score.',
    },
    {
      key: 'coverage',
      name: 'Coverage',
      description: 'Fraction of the reference items that were predicted.',
    },
  ],
};

export function metricDefsFor(kind: EvaluationTaskKindDb): readonly MetricDef[] {
  // eslint-disable-next-line security/detect-object-injection -- closed enum key
  return METRICS[kind];
}

export interface CroissantTaskUrls {
  /** Public origin, e.g. `https://dev.oci.ai4h.net`. */
  baseUrl: string;
}

export function problemId(baseUrl: string, slug: string): string {
  return `${baseUrl}/v2/evaluation/tasks/${slug}/croissant-task.jsonld`;
}

export function resultsId(baseUrl: string, slug: string): string {
  return `${baseUrl}/v2/evaluation/tasks/${slug}/croissant-results.jsonld`;
}

function metricSpecId(problem: string, key: string): string {
  return `${problem}#metric-${key}`;
}

function kindDescription(t: EvaluationTaskDetail): string {
  switch (t.taskKind) {
    case 'GRADING':
      return `Ordinal grading into ${t.numClasses} grades (0 to ${t.numClasses - 1}); grades at or above ${t.referableThreshold} are referable.`;
    case 'CLASSIFICATION':
      return `Single-label classification into ${t.numClasses} classes (0 to ${t.numClasses - 1}).`;
    case 'BINARY_DIAGNOSTIC':
      return `Binary diagnostic test: label 1 is ${t.positiveClassName ?? 'the positive class'}, label 0 the negative class.`;
  }
}

/** The task as a `croissant:TaskProblem`. */
export function toTaskProblem(t: EvaluationTaskDetail, { baseUrl }: CroissantTaskUrls): JsonLd {
  const id = problemId(baseUrl, t.slug);
  const withScore = acceptsItemScores(t.taskKind);
  const fields: JsonLd[] = [
    {
      '@type': 'croissant:Field',
      '@id': `${id}#field-item_id`,
      'schema:name': 'item_id',
      'schema:description': 'Item identifier, one of the identifiers published with the task.',
      'croissant:dataType': { '@id': 'schema:Text' },
    },
    {
      '@type': 'croissant:Field',
      '@id': `${id}#field-label`,
      'schema:name': 'label',
      'schema:description': `Predicted label, an integer from 0 to ${t.numClasses - 1}.`,
      'croissant:dataType': { '@id': 'schema:Integer' },
    },
  ];
  if (withScore) {
    fields.push({
      '@type': 'croissant:Field',
      '@id': `${id}#field-score`,
      'schema:name': 'score',
      'schema:description':
        'Optional per-item score in [0, 1] for the positive class; when every item has one, AUC is reported.',
      'croissant:dataType': { '@id': 'schema:Float' },
    });
  }

  return {
    '@context': CONTEXT,
    '@type': 'croissant:TaskProblem',
    '@id': id,
    'schema:name': t.name,
    'schema:description': `${kindDescription(t)} Submissions are scored against reference labels the platform does not disclose.`,
    'schema:url': `${baseUrl}/evaluation/${t.slug}`,
    'schema:identifier': t.slug,
    'schema:dateCreated': t.createdAt,
    'schema:dateModified': t.updatedAt,
    'schema:publisher': { '@type': 'schema:Organization', 'schema:name': 'OCI Platform (GI-AI4H)' },
    'croissant:input': {
      '@type': 'schema:Dataset',
      '@id': `${baseUrl}/v2/catalog/datasets/${t.datasetSlug}`,
      'schema:identifier': t.datasetSlug,
      'schema:url': `${baseUrl}/v2/catalog/datasets/${t.datasetSlug}/croissant`,
    },
    'croissant:output': {
      '@type': 'croissant:OutputSpec',
      '@id': `${id}#output`,
      'schema:name': 'Predictions',
      'schema:description': `One row per item, keyed on the ${t.itemCount} published item identifiers. Missing items lower coverage; unknown identifiers are refused.`,
      'schema:encodingFormat': ['text/csv', 'application/json'],
      'croissant:schema': {
        '@type': 'croissant:RecordSet',
        '@id': `${id}#predictions`,
        'schema:name': 'predictions',
        'croissant:field': fields,
      },
    },
    'croissant:evaluation': {
      '@type': 'croissant:EvaluationSpec',
      '@id': `${id}#evaluation`,
      'croissant:expectedMetric': metricDefsFor(t.taskKind).map((m, i) => ({
        '@type': 'croissant:MetricSpec',
        '@id': metricSpecId(id, m.key),
        'schema:name': m.name,
        'schema:identifier': m.key,
        'schema:description':
          i === 0 ? `${m.description} Primary metric: results are ordered by it.` : m.description,
        'croissant:lowerIsBetter': false,
      })),
    },
  };
}

/**
 * A result goes into the export only if it would be in published reporting:
 * scored, produced by a route version that is published, and not retracted.
 * LEGACY rows (scored before the route registry) are excluded, as they are
 * from published reporting (LEGACY_ATTRIBUTION_NOTE).
 */
export function isExportableResult(s: EvaluationSubmissionResult): boolean {
  if (s.status !== 'SCORED' || s.scores === null || s.attribution === null) return false;
  if (s.attribution.kind !== 'ROUTED') return false;
  return s.attribution.published && s.attribution.retractedAt === null;
}

/** A metric's value: a plain number, or a QuantitativeValue carrying its 95% interval. */
function metricValue(raw: unknown): number | JsonLd | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw && typeof raw === 'object' && 'estimate' in raw) {
    const r = raw as { estimate: number; lower?: number; upper?: number };
    if (!Number.isFinite(r.estimate)) return null;
    return {
      '@type': 'schema:QuantitativeValue',
      'schema:value': r.estimate,
      ...(typeof r.lower === 'number' ? { 'schema:minValue': r.lower } : {}),
      ...(typeof r.upper === 'number' ? { 'schema:maxValue': r.upper } : {}),
      'schema:description': '95% interval in minValue and maxValue.',
    };
  }
  return null;
}

function resultsFor(scores: TaskKindScores, problem: string): JsonLd[] {
  const metrics = scores.metrics as Record<string, unknown>;
  const out: JsonLd[] = [];
  for (const m of metricDefsFor(scores.kind)) {
    const value = metricValue(metrics[m.key]);
    if (value === null) continue;
    out.push({
      '@type': 'croissant:EvaluationResult',
      'croissant:metric': { '@id': metricSpecId(problem, m.key) },
      'croissant:value': value,
      'croissant:lowerIsBetter': false,
    });
  }
  return out;
}

/** The task's published results, one `croissant:EvaluationTask` per scored submission. */
export function toEvaluationResults(
  t: EvaluationTaskDetail,
  { baseUrl }: CroissantTaskUrls,
): JsonLd {
  const problem = problemId(baseUrl, t.slug);
  const graph = t.submissions.filter(isExportableResult).map((s) => {
    const attribution = s.attribution as Extract<
      EvaluationSubmissionResult['attribution'],
      { kind: 'ROUTED' }
    >;
    const submissionUrl = `${baseUrl}/evaluation/${t.slug}/submissions/${s.id}`;
    return {
      '@type': 'croissant:EvaluationTask',
      '@id': `${submissionUrl}#evaluation`,
      'schema:dateCreated': s.createdAt,
      'croissant:evaluatedSolution': {
        '@type': 'croissant:TaskSolution',
        '@id': submissionUrl,
        'schema:name': s.methodName,
        'schema:isBasedOn': { '@id': problem },
        'croissant:implementation': {
          '@type': 'schema:SoftwareApplication',
          '@id': `${submissionUrl}#method`,
          'schema:name': s.methodName,
        },
      },
      'croissant:execution': {
        '@type': 'croissant:ExecutionInfo',
        'schema:name': `Evaluation route ${attribution.routeSlug} ${attribution.routeVersion}`,
        'schema:identifier': `${attribution.routeSlug}@${attribution.routeVersion}`,
      },
      // `isExportableResult` guarantees non-null scores.
      'croissant:evaluationResults': resultsFor(s.scores as TaskKindScores, problem),
    };
  });
  // No top-level `@id`: next to `@graph` it would make the results a named
  // graph, which JSON-LD readers that load into a default graph drop.
  return {
    '@context': CONTEXT,
    '@graph': graph,
  };
}
