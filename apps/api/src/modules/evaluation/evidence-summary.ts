import { extractProvenance, normalize } from '@oci/croissant';
import {
  EVIDENCE_MIN_POSITIVE_CASES,
  IntendedUseStatementSchema,
  type DatasetDetail,
  type ClassificationScores,
  type EvidenceDataset,
  type EvidenceDerivedDiagnostic,
  type EvidenceGap,
  type EvidenceMethod,
  type EvidenceModelCard,
  type EvidenceReferenceLabels,
  type EvidenceStanding,
  type EvidenceSummary,
  type ModelCardStatus,
  type SubgroupResults,
  type TaskKindScores,
} from '@oci/shared-types';
import { parseScores } from './evaluation.service.js';
import type { EvidenceSubmissionRow, EvidenceTraceRow } from './evidence-summary.repository.js';
import { attributionFor } from './route-registry.js';
import { proportion } from './scoring-binary-diagnostic.js';
import { parseSubgroupResults } from './subgroup-config.js';

/**
 * The evidence summary of one submission (#652), assembled from rows already
 * read. Pure: no I/O, no clock (the caller passes `now`), so every branch,
 * including each "missing" one, is unit-tested.
 *
 * Nothing is computed here that the platform does not already publish
 * elsewhere. The scores are the stored ones; the subgroup results are read
 * with the same parser as the submission page, so a group withheld there is
 * withheld here (ADR-0030); where the result stands is decided by
 * `attributionFor`, the one rule that decides publication. What this module
 * adds is the list of gaps: what the evidence does not show.
 */

/** A model card as the summary reads it (#587 links cards to submissions). */
export interface EvidenceModelCardRow {
  slug: string;
  versionMajorMinorPatch: string;
  status: ModelCardStatus;
  modelDeveloper: string | null;
  clinicalSummary: string | null;
  /** Raw JSON as stored. */
  intendedUse: unknown;
  knownBiasesOrEthicalConsiderations: string | null;
}

export interface EvidenceInput {
  now: Date;
  viewerIsSubmitter: boolean;
  submission: EvidenceSubmissionRow;
  /** The task's dataset as the reader may see it; null when it is not in the catalogue for them. */
  dataset: DatasetDetail | null;
  modelCard: EvidenceModelCardRow | null;
  trace: { rows: EvidenceTraceRow[]; limit: number };
}

type Unsectioned = Omit<EvidenceSummary, 'gaps'>;

export function assembleEvidence(input: EvidenceInput): EvidenceSummary {
  const { submission: row } = input;
  const scores = row.status === 'SCORED' ? parseScores(row.scores) : null;
  const data = datasetEvidence(input.dataset);
  const truncated = input.trace.rows.length > input.trace.limit;

  const summary: Unsectioned = {
    format: 'oci-evidence-summary/v1',
    generatedAt: input.now.toISOString(),
    submission: {
      id: row.id,
      methodName: row.methodName,
      mode: row.mode,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      viewerIsSubmitter: input.viewerIsSubmitter,
    },
    task: {
      slug: row.task.slug,
      name: row.task.name,
      taskKind: row.task.taskKind,
      numClasses: row.task.numClasses,
      referableThreshold: row.task.referableThreshold,
      positiveClassName: row.task.positiveClassName,
      datasetSlug: row.task.datasetSlug,
      itemCount: row.task.itemCount,
    },
    modelCard: input.modelCard ? modelCardEvidence(input.modelCard) : null,
    data,
    method: methodEvidence(row),
    performance: {
      standing: standingOf(row, scores),
      scores,
      positiveCases: positiveCasesOf(scores),
      minPositiveCases: EVIDENCE_MIN_POSITIVE_CASES,
      derivedDiagnostic:
        scores?.kind === 'CLASSIFICATION' ? deriveTwoClassDiagnostic(scores.metrics) : null,
    },
    // Only a scored submission has results by subgroup to show.
    subgroups: scores ? parseSubgroupResults(row.subgroupScores) : null,
    trace: {
      events: input.trace.rows.slice(0, input.trace.limit).map((e) => ({
        sequenceNumber: e.sequenceNumber.toString(),
        occurredAt: e.occurredAt.toISOString(),
        eventType: `${e.module}.${e.action}`,
        payloadHash: e.payloadHash,
        previousHash: e.previousHash,
        recordHash: e.recordHash,
      })),
      truncated,
    },
  };
  return { ...summary, gaps: evidenceGaps(summary) };
}

/** Section 1. A statement that does not read as a valid one is reported as absent. */
export function modelCardEvidence(card: EvidenceModelCardRow): EvidenceModelCard {
  const intendedUse = IntendedUseStatementSchema.safeParse(card.intendedUse);
  return {
    slug: card.slug,
    version: card.versionMajorMinorPatch,
    status: card.status,
    modelDeveloper: card.modelDeveloper,
    clinicalSummary: card.clinicalSummary,
    intendedUse: intendedUse.success ? intendedUse.data : null,
    knownBiases: card.knownBiasesOrEthicalConsiderations,
  };
}

/**
 * Section 2, from the dataset's published manifest. The evaluation task names
 * a dataset, not a version, so the version shown is the latest published one.
 */
export function datasetEvidence(detail: DatasetDetail | null): EvidenceSummary['data'] {
  if (!detail) return { dataset: null, referenceLabels: null };
  const manifest = normalize(detail.croissant ?? {}) as Record<string, unknown>;
  const provenance = extractProvenance(detail.croissant);
  const latest = detail.versions.find((v) => v.version === detail.latestVersion) ?? null;

  const dataset: EvidenceDataset = {
    slug: detail.slug,
    name: detail.name,
    version: detail.latestVersion,
    publishedAt: latest?.publishedAt ?? null,
    manifestSha256: latest?.croissantHash ?? null,
    licence: licenceOf(manifest['license']),
    synthetic: manifest['synthetic'] === true,
    sourceOrganizations: provenance.sourceOrganizations,
    derivedFrom: provenance.derivedFrom,
    collection: text(manifest['dataCollection']),
    collectionTimeframe: provenance.collectionTimeframeText,
  };
  return { dataset, referenceLabels: referenceLabelsOf(manifest) };
}

function referenceLabelsOf(manifest: Record<string, unknown>): EvidenceReferenceLabels | null {
  const protocol = isObject(manifest['labelProtocol']) ? manifest['labelProtocol'] : null;
  const annotationProtocol = text(manifest['dataAnnotationProtocol']);
  if (!protocol && !annotationProtocol) return null;
  const readers = protocol?.['gradersPerItem'];
  const agreement = isObject(protocol?.['interRaterAgreement'])
    ? protocol['interRaterAgreement']
    : null;
  const metric = text(agreement?.['metric']);
  const value = agreement?.['value'];
  return {
    protocolVersion: text(protocol?.['version']),
    labelScale: text(protocol?.['labelScale']),
    readersPerItem:
      typeof readers === 'number' && Number.isInteger(readers) && readers > 0 ? readers : null,
    readerQualification: text(protocol?.['graderQualification']),
    adjudication: text(protocol?.['adjudication']),
    agreement:
      metric !== null && typeof value === 'number' && Number.isFinite(value)
        ? { metric, value }
        : null,
    annotationProtocol,
  };
}

/** The manifest's licence as written: a string, an IRI object, or a list of either. */
function licenceOf(raw: unknown): string | null {
  const one = (v: unknown): string | null =>
    typeof v === 'string'
      ? text(v)
      : isObject(v)
        ? (text(v['@id']) ?? text(v['url']) ?? text(v['name']))
        : null;
  if (Array.isArray(raw)) {
    const all = raw.map(one).filter((v): v is string => v !== null);
    return all.length > 0 ? all.join(', ') : null;
  }
  return one(raw);
}

/** Section 3: the method version pinned on the submission, if any. */
export function methodEvidence(row: EvidenceSubmissionRow): EvidenceMethod {
  const ref = row.routeVersionRef;
  if (!ref) return { kind: 'NOT_ATTRIBUTED' };
  return {
    kind: 'ROUTED',
    routeSlug: ref.route.slug,
    routeName: ref.route.name,
    providerName: ref.route.providerName,
    isReference: ref.route.isReference,
    version: ref.version,
    reviewStatus: ref.reviewStatus,
    reviewedAt: ref.reviewedAt ? ref.reviewedAt.toISOString() : null,
    reviewNotes: ref.reviewNotes,
  };
}

/** Section 4: where the result stands, by `attributionFor` (WP5). */
export function standingOf(
  row: EvidenceSubmissionRow,
  scores: TaskKindScores | null,
): EvidenceStanding {
  if (!scores) return 'NOT_SCORED';
  const attribution = attributionFor({ ...row, scores });
  if (!attribution || attribution.kind === 'LEGACY') return 'NOT_ATTRIBUTED';
  if (attribution.retractedAt !== null) return 'RETRACTED';
  if (attribution.reviewStatus === 'REJECTED' || attribution.reviewStatus === 'WITHDRAWN') {
    return 'RETRACTED';
  }
  return attribution.published ? 'PUBLISHED' : 'PROVISIONAL';
}

/**
 * Positive reference cases among the scored items, from published counts
 * only: TP + FN of a binary finding, or the support of label 1 of a
 * two-class classification. A grading task and a multi-class one have no
 * single positive class.
 */
export function positiveCasesOf(scores: TaskKindScores | null): number | null {
  if (!scores) return null;
  if (scores.kind === 'BINARY_DIAGNOSTIC') {
    return scores.metrics.truePositives + scores.metrics.falseNegatives;
  }
  if (scores.kind === 'CLASSIFICATION' && scores.metrics.perClass.length === 2) {
    return scores.metrics.perClass.find((c) => c.label === 1)?.support ?? null;
  }
  return null;
}

/** Stored rates are rounded to 4 decimals: a count reproduces one within this. */
const STORED_ROUNDING = 0.00005 + 1e-12;

/**
 * The integer `k` in [0, total] whose `k / total` rounds to `rate`, when there
 * is exactly one. Null when none or several do: the count is then not known.
 */
function countFromRate(rate: number, total: number): number | null {
  if (total === 0) return rate === 0 ? 0 : null;
  const lo = Math.max(0, Math.floor((rate - STORED_ROUNDING) * total));
  const hi = Math.min(total, Math.ceil((rate + STORED_ROUNDING) * total));
  const found: number[] = [];
  for (let k = lo; k <= hi; k += 1) {
    if (Math.abs(k / total - rate) <= STORED_ROUNDING) found.push(k);
  }
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** The stored rate a count gives, by the scorer's conventions (0 on an empty denominator). */
function agrees(stored: number, numerator: number, denominator: number): boolean {
  const exact = denominator === 0 ? 0 : numerator / denominator;
  return Math.abs(exact - stored) <= STORED_ROUNDING;
}

/**
 * Sensitivity, specificity and predictive values of a two-class
 * classification result, class 1 positive (#652).
 *
 * The four counts come from what is stored per class, exactly: the class
 * supports are the positive and negative reference counts, and each class's
 * recall times its support is its correct count (TP for class 1, TN for
 * class 0). A recall is stored rounded to 4 decimals, so the count is the one
 * integer that rounds back to it; if none or several do, or the counts do not
 * reproduce the stored precisions and accuracy, the result is
 * `NOT_RECOVERABLE` and nothing is shown. The rates and Wilson intervals come
 * from `proportion`, the function `BINARY_DIAGNOSTIC` scoring uses.
 *
 * Null when the result does not have exactly the classes 0 and 1.
 */
export function deriveTwoClassDiagnostic(
  m: ClassificationScores,
): EvidenceDerivedDiagnostic | null {
  const negative = m.perClass.find((c) => c.label === 0);
  const positive = m.perClass.find((c) => c.label === 1);
  if (m.perClass.length !== 2 || !negative || !positive) return null;

  const tp = countFromRate(positive.recall, positive.support);
  const tn = countFromRate(negative.recall, negative.support);
  if (tp === null || tn === null) return { status: 'NOT_RECOVERABLE' };
  const fn = positive.support - tp;
  const fp = negative.support - tn;
  const n = positive.support + negative.support;

  const consistent =
    agrees(positive.precision, tp, tp + fp) &&
    agrees(negative.precision, tn, tn + fn) &&
    agrees(m.accuracy, tp + tn, n);
  if (!consistent) return { status: 'NOT_RECOVERABLE' };

  return {
    status: 'DERIVED',
    positiveLabel: 1,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    sensitivity: proportion(tp, tp + fn),
    specificity: proportion(tn, tn + fp),
    positivePredictiveValue: proportion(tp, tp + fp),
    negativePredictiveValue: proportion(tn, tn + fn),
  };
}

/**
 * Section 6: what this evidence does not show, in section order. Each entry
 * is a fact read off the summary, never a judgement of the model.
 */
export function evidenceGaps(s: Unsectioned): EvidenceGap[] {
  const gaps: EvidenceGap[] = [];
  const gap = (code: EvidenceGap['code'], section: number, params: EvidenceGap['params'] = {}) =>
    gaps.push({ code, section, params });

  // 1 · Intended use and risk tier
  if (!s.modelCard) {
    gap('NO_MODEL_CARD', 1);
  } else {
    if (s.modelCard.status !== 'PUBLISHED') {
      gap('MODEL_CARD_NOT_PUBLISHED', 1, { status: s.modelCard.status });
    }
    if (!s.modelCard.intendedUse) gap('NO_INTENDED_USE', 1);
  }

  // 2 · Data
  const { dataset, referenceLabels } = s.data;
  if (!dataset) {
    gap('DATASET_NOT_AVAILABLE', 2);
  } else {
    if (dataset.synthetic) gap('SYNTHETIC_DATA', 2);
    const readers = referenceLabels?.readersPerItem ?? null;
    if (readers === null) gap('REFERENCE_LABELS_UNDOCUMENTED', 2);
    else if (readers === 1) gap('SINGLE_READER_LABELS', 2);
    else if (!referenceLabels?.agreement) {
      gap('READER_AGREEMENT_NOT_REPORTED', 2, { readers });
    }
  }

  // 3 · Method
  if (s.method.kind === 'NOT_ATTRIBUTED') {
    gap('METHOD_NOT_ATTRIBUTED', 3);
  } else if (s.method.reviewStatus === 'REJECTED' || s.method.reviewStatus === 'WITHDRAWN') {
    gap('METHOD_RETRACTED', 3, { status: s.method.reviewStatus });
  } else if (s.method.reviewStatus !== 'APPROVED') {
    gap('METHOD_NOT_APPROVED', 3, { status: s.method.reviewStatus });
  }

  // 4 · Performance, and 5 · Subgroups, which only a scored result has.
  const scores = s.performance.scores;
  if (!scores) {
    gap('NOT_SCORED', 4, { status: s.submission.status });
  } else {
    // A two-class result whose counts were recovered has its intervals.
    const derived = s.performance.derivedDiagnostic?.status === 'DERIVED';
    if (scores.kind !== 'BINARY_DIAGNOSTIC' && !derived) {
      gap('NO_INTERVALS', 4, { taskKind: scores.kind });
    }
    const positives = s.performance.positiveCases;
    if (positives !== null && positives < s.performance.minPositiveCases) {
      gap('FEW_POSITIVE_CASES', 4, {
        positives,
        minimum: s.performance.minPositiveCases,
      });
    }
    if (scores.metrics.coverage < 1) {
      gap('INCOMPLETE_COVERAGE', 4, { coverage: scores.metrics.coverage });
    }

    if (!s.subgroups) {
      gap('NO_SUBGROUP_DATA', 5);
    } else {
      const { withheld, total } = withheldGroups(s.subgroups);
      if (withheld > 0) gap('SUBGROUPS_WITHHELD', 5, { withheld, total });
    }
  }

  // 7 · Trace
  if (s.trace.events.length === 0) {
    gap('NO_AUDIT_EVENTS', 7);
  } else if (!s.trace.truncated) {
    const expected =
      s.submission.status === 'SCORED'
        ? 'evaluation.scored'
        : s.submission.status === 'FAILED'
          ? 'evaluation.failed'
          : null;
    if (expected && !s.trace.events.some((e) => e.eventType === expected)) {
      gap('AUDIT_RESULT_EVENT_MISSING', 7, { eventType: expected });
    }
  }

  return gaps;
}

function withheldGroups(results: SubgroupResults): { withheld: number; total: number } {
  let withheld = 0;
  let total = 0;
  for (const field of results.fields) {
    for (const cell of field.cells) {
      total += 1;
      if (cell.status === 'SUPPRESSED') withheld += 1;
    }
  }
  return { withheld, total };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}
