import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  EVIDENCE_MIN_POSITIVE_CASES,
  EvidenceSummarySchema,
  MIN_SUBGROUP_CELL_SIZE,
  type DatasetDetail,
  type EvidenceGapCode,
  type SubgroupField,
  type ClassificationScores,
  type TaskKindScores,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { describe, expect, it, vi } from 'vitest';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { EvaluationRepository, LinkedModelCardEvidenceRow } from './evaluation.repository.js';
import {
  assembleEvidence,
  deriveTwoClassDiagnostic,
  positiveCasesOf,
  type EvidenceInput,
  type EvidenceModelCardRow,
} from './evidence-summary.js';
import type {
  EvidenceSubmissionRow,
  EvidenceSummaryRepository,
  EvidenceTraceRow,
} from './evidence-summary.repository.js';
import { EvidenceSummaryService } from './evidence-summary.service.js';
import { scoreByKind } from './scoring-registry.js';
import { parseSubgroupResults } from './subgroup-config.js';
import { scoreSubgroups } from './subgroup-scoring.js';

/**
 * The evidence summary (#652): the assembly with each of its "missing"
 * branches, the subgroup results passed through exactly as stored (a group
 * withheld at scoring time stays withheld), and who may read it.
 */

const NOW = new Date('2026-12-01T09:00:00.000Z');
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const SUBMITTER_SUB = 'submitter-sub';

// A binary-finding task of 120 items, 60 positive. Sex F (54), M (54) and a
// third group of 12 split 7 / 5: its negatives fall below the minimum cell,
// so its rates are withheld, and an unknown group of 4 items is suppressed.
const IDS = Array.from({ length: 120 }, (_, i) => `item${String(i).padStart(3, '0')}`);
const GROUND_TRUTH = Object.fromEntries(IDS.map((id, i) => [id, i % 2]));
const SEX: SubgroupField = {
  key: 'sex',
  label: 'Sex',
  values: [
    { value: 'F', label: 'Female' },
    { value: 'M', label: 'Male' },
    { value: 'U', label: 'Not recorded' },
  ],
};
const VALUES = Object.fromEntries(
  IDS.map((id, i) => [id, { sex: i < 4 ? 'U' : i % 3 === 0 ? 'F' : 'M' }]),
);
/** Right on all but every tenth item. */
const PREDICTIONS = Object.fromEntries(
  IDS.map((id, i) => [id, i % 10 === 0 ? 1 - (i % 2) : i % 2]),
);
const CONFIG = { numClasses: 2, referableThreshold: 1 };

const BINARY_SCORES = scoreByKind({
  kind: 'BINARY_DIAGNOSTIC',
  groundTruth: GROUND_TRUTH,
  predictions: PREDICTIONS,
  config: CONFIG,
}) as TaskKindScores;
/** What the scoring path stores: already suppressed. */
const STORED_SUBGROUPS = scoreSubgroups({
  kind: 'BINARY_DIAGNOSTIC',
  groundTruth: GROUND_TRUTH,
  predictions: PREDICTIONS,
  config: CONFIG,
  subgroups: { fields: [SEX], values: VALUES },
  minCellSize: MIN_SUBGROUP_CELL_SIZE,
});

/** The same results with every group large enough to publish. */
const PUBLISHED_SUBGROUPS = scoreSubgroups({
  kind: 'BINARY_DIAGNOSTIC',
  groundTruth: GROUND_TRUTH,
  predictions: PREDICTIONS,
  config: CONFIG,
  subgroups: {
    fields: [{ ...SEX, values: SEX.values.slice(0, 2) }],
    values: Object.fromEntries(IDS.map((id, i) => [id, { sex: i % 3 === 0 ? 'F' : 'M' }])),
  },
  minCellSize: MIN_SUBGROUP_CELL_SIZE,
});

const MANIFEST = {
  '@type': 'sc:Dataset',
  name: 'Chest radiographs',
  license: 'https://spdx.org/licenses/CC-BY-4.0',
  'bio:synthetic': false,
  'rai:dataCollection': 'Consecutive adult PA films, one per patient.',
  'rai:dataCollectionTimeframe': '2024',
  'prov:wasDerivedFrom': { '@id': 'https://doi.org/10.0000/source' },
  'prov:wasAttributedTo': [{ '@type': 'prov:Organization', name: 'Teaching hospital' }],
  'bio:labelProtocol': {
    version: 'v2',
    labelScale: '0 absent, 1 present',
    gradersPerItem: 3,
    graderQualification: 'Board-certified radiologists',
    adjudication: 'Majority vote',
    interRaterAgreement: { metric: 'Fleiss kappa', value: 0.71 },
  },
};

function dataset(croissant: unknown = MANIFEST): DatasetDetail {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    slug: 'chest-xr',
    name: 'Chest radiographs',
    description: null,
    visibility: 'PUBLIC',
    status: 'PUBLISHED',
    conformanceVersion: '1.1',
    latestVersion: '1.2.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sourceCatalog: null,
    originUrl: null,
    accessTier: 'OPEN',
    commercialUseTerms: 'OK',
    modalities: ['X-ray'],
    croissant,
    versions: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        version: '1.2.0',
        croissantHash: 'f'.repeat(64),
        notes: null,
        publishedAt: '2026-02-01T00:00:00.000Z',
      },
    ],
    distributions: [],
    duoTerms: [],
    hostId: '66666666-6666-4666-8666-666666666666',
    commercialClauses: null,
  } as DatasetDetail;
}

const APPROVED_ROUTE: EvidenceSubmissionRow['routeVersionRef'] = {
  version: '1.0.0',
  reviewStatus: 'APPROVED',
  reviewedAt: new Date('2026-11-01T00:00:00.000Z'),
  reviewNotes: 'Reproduced on the reference set; intervals checked.',
  route: { slug: 'oci-reference', name: 'OCI reference', providerName: null, isReference: true },
};

function submission(over: Partial<EvidenceSubmissionRow> = {}): EvidenceSubmissionRow {
  return {
    id: SUBMISSION_ID,
    methodName: 'Model A',
    mode: 'PREDICTIONS',
    status: 'SCORED',
    scores: BINARY_SCORES,
    subgroupScores: STORED_SUBGROUPS,
    submittedBy: cognitoSubAsUuid(SUBMITTER_SUB),
    createdAt: new Date('2026-11-30T10:00:00.000Z'),
    retractedAt: null,
    routeVersionRef: APPROVED_ROUTE,
    task: {
      slug: 'chest-finding',
      name: 'Chest finding',
      datasetSlug: 'chest-xr',
      taskKind: 'BINARY_DIAGNOSTIC',
      numClasses: 2,
      referableThreshold: 1,
      positiveClassName: 'Opacity present',
      itemCount: IDS.length,
    },
    ...over,
  };
}

const CARD: EvidenceModelCardRow = {
  slug: 'model-a',
  versionMajorMinorPatch: '1.0.0',
  status: 'PUBLISHED',
  modelDeveloper: 'Lab',
  clinicalSummary: 'Flags films for a first read.',
  intendedUse: {
    v: 1,
    medicalPurpose: 'triage',
    foreseeableMisuse: 'Use on children.',
    contraindications: 'Bedside films.',
    riskTier: 'II',
  },
  knownBiasesOrEthicalConsiderations: null,
};

function trace(...types: string[]): EvidenceTraceRow[] {
  return types.map((t, i) => {
    const [module = '', action = ''] = t.split(/\.(.*)/s);
    return {
      sequenceNumber: BigInt(100 + i),
      occurredAt: new Date(`2026-11-30T10:00:0${i}.000Z`),
      module,
      action,
      payloadHash: 'a'.repeat(64),
      previousHash: i === 0 ? 'b'.repeat(64) : 'c'.repeat(64),
      recordHash: String(i).repeat(64),
    };
  });
}

function input(over: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    now: NOW,
    viewerIsSubmitter: false,
    submission: submission(),
    dataset: dataset(),
    modelCard: CARD,
    trace: { rows: trace('evaluation.submitted', 'evaluation.scored'), limit: 50 },
    ...over,
  };
}

const codes = (i: EvidenceInput): EvidenceGapCode[] => assembleEvidence(i).gaps.map((g) => g.code);

describe('assembleEvidence', () => {
  it('is a valid summary, and a complete one has only the gaps it should', () => {
    const summary = assembleEvidence(input());
    expect(() => EvidenceSummarySchema.parse(summary)).not.toThrow();
    // The fixture's sex field has a group of 4: it is withheld, and the summary says so.
    expect(summary.gaps.map((g) => g.code)).toStrictEqual(['SUBGROUPS_WITHHELD']);
    expect(summary.generatedAt).toBe(NOW.toISOString());
    expect(summary.performance.standing).toBe('PUBLISHED');
  });

  it('for a submission with no card and an unreviewed method, lists exactly those gaps', () => {
    const declared = { ...APPROVED_ROUTE!, reviewStatus: 'DECLARED' as const, reviewedAt: null };
    const summary = assembleEvidence(
      input({
        modelCard: null,
        submission: submission({
          routeVersionRef: declared,
          // Every group published, so nothing else is missing.
          subgroupScores: PUBLISHED_SUBGROUPS,
        }),
      }),
    );
    expect(summary.gaps).toStrictEqual([
      { code: 'NO_MODEL_CARD', section: 1, params: {} },
      { code: 'METHOD_NOT_APPROVED', section: 3, params: { status: 'DECLARED' } },
    ]);
    expect(summary.performance.standing).toBe('PROVISIONAL');
    expect(summary.modelCard).toBeNull();
    expect(summary.subgroups?.fields[0]?.cells.every((c) => c.status === 'REPORTED')).toBe(true);
  });

  it('never carries a reference label, an item id or the submitter', () => {
    const json = JSON.stringify(assembleEvidence(input()));
    expect(json).not.toContain('item000');
    expect(json).not.toContain('groundTruth');
    expect(json).not.toContain(cognitoSubAsUuid(SUBMITTER_SUB));
    expect(json).not.toContain('submittedBy');
  });

  describe('subgroups', () => {
    it('passes the stored results through exactly as the submission page reads them', () => {
      const summary = assembleEvidence(input());
      expect(summary.subgroups).toStrictEqual(parseSubgroupResults(STORED_SUBGROUPS));
    });

    it('keeps a suppressed group suppressed, with no count and no figure', () => {
      const summary = assembleEvidence(input());
      const sex = summary.subgroups?.fields.find((f) => f.key === 'sex');
      const unknown = sex?.cells.find((c) => c.value === 'U');
      expect(unknown).toStrictEqual({ status: 'SUPPRESSED', value: 'U', label: 'Not recorded' });
      expect(summary.gaps).toContainEqual({
        code: 'SUBGROUPS_WITHHELD',
        section: 5,
        params: expect.objectContaining({ withheld: expect.any(Number), total: 3 }),
      });
    });

    it('refuses a stored blob that carries figures for a suppressed group: no subgroup data', () => {
      const leaky = structuredClone(STORED_SUBGROUPS)!;
      const field = leaky.fields[0]!;
      field.cells = field.cells.map((c) =>
        c.status === 'SUPPRESSED' ? ({ ...c, itemCount: 4 } as never) : c,
      );
      const summary = assembleEvidence(
        input({ submission: submission({ subgroupScores: leaky }) }),
      );
      expect(summary.subgroups).toBeNull();
      expect(codes(input({ submission: submission({ subgroupScores: leaky }) }))).toContain(
        'NO_SUBGROUP_DATA',
      );
    });

    it('reports no subgroup data when the task declared none', () => {
      expect(codes(input({ submission: submission({ subgroupScores: null }) }))).toStrictEqual([
        'NO_SUBGROUP_DATA',
      ]);
    });
  });

  describe('section 1 · intended use', () => {
    it('no card', () => {
      expect(codes(input({ modelCard: null }))).toContain('NO_MODEL_CARD');
    });

    it('a card that is not published, and one whose statement does not read', () => {
      const got = codes(input({ modelCard: { ...CARD, status: 'DRAFT', intendedUse: { v: 1 } } }));
      expect(got).toEqual(expect.arrayContaining(['MODEL_CARD_NOT_PUBLISHED', 'NO_INTENDED_USE']));
      expect(got).not.toContain('NO_MODEL_CARD');
    });

    it('carries the statement and risk tier of a linked card', () => {
      const summary = assembleEvidence(input());
      expect(summary.modelCard?.intendedUse?.riskTier).toBe('II');
      expect(summary.modelCard?.intendedUse?.medicalPurpose).toBe('triage');
    });
  });

  describe('section 2 · data', () => {
    it('reads the dataset, its version, licence and label protocol from the manifest', () => {
      const { data } = assembleEvidence(input());
      expect(data.dataset).toMatchObject({
        slug: 'chest-xr',
        version: '1.2.0',
        manifestSha256: 'f'.repeat(64),
        licence: 'https://spdx.org/licenses/CC-BY-4.0',
        synthetic: false,
        sourceOrganizations: ['Teaching hospital'],
        derivedFrom: ['https://doi.org/10.0000/source'],
        collection: 'Consecutive adult PA films, one per patient.',
      });
      expect(data.referenceLabels).toMatchObject({
        readersPerItem: 3,
        readerQualification: 'Board-certified radiologists',
        agreement: { metric: 'Fleiss kappa', value: 0.71 },
      });
    });

    it('a dataset the reader cannot see', () => {
      expect(codes(input({ dataset: null }))).toContain('DATASET_NOT_AVAILABLE');
      expect(codes(input({ dataset: null }))).not.toContain('REFERENCE_LABELS_UNDOCUMENTED');
    });

    it('synthetic data', () => {
      expect(codes(input({ dataset: dataset({ ...MANIFEST, 'bio:synthetic': true }) }))).toContain(
        'SYNTHETIC_DATA',
      );
    });

    it('labels with no protocol', () => {
      const { 'bio:labelProtocol': _dropped, ...bare } = MANIFEST;
      expect(codes(input({ dataset: dataset(bare) }))).toContain('REFERENCE_LABELS_UNDOCUMENTED');
    });

    it('labels from one reader', () => {
      const one = {
        ...MANIFEST,
        'bio:labelProtocol': { version: 'v1', labelScale: '0/1', gradersPerItem: 1 },
      };
      expect(codes(input({ dataset: dataset(one) }))).toContain('SINGLE_READER_LABELS');
    });

    it('several readers and no agreement figure', () => {
      const three = {
        ...MANIFEST,
        'bio:labelProtocol': { version: 'v1', labelScale: '0/1', gradersPerItem: 3 },
      };
      const summary = assembleEvidence(input({ dataset: dataset(three) }));
      expect(summary.gaps).toContainEqual({
        code: 'READER_AGREEMENT_NOT_REPORTED',
        section: 2,
        params: { readers: 3 },
      });
    });
  });

  describe('section 3 · method', () => {
    it('no method version', () => {
      const s = assembleEvidence(input({ submission: submission({ routeVersionRef: null }) }));
      expect(s.method).toStrictEqual({ kind: 'NOT_ATTRIBUTED' });
      expect(s.performance.standing).toBe('NOT_ATTRIBUTED');
      expect(s.gaps.map((g) => g.code)).toContain('METHOD_NOT_ATTRIBUTED');
    });

    it('a method under review', () => {
      const ref = { ...APPROVED_ROUTE!, reviewStatus: 'UNDER_REVIEW' as const };
      expect(codes(input({ submission: submission({ routeVersionRef: ref }) }))).toContain(
        'METHOD_NOT_APPROVED',
      );
    });

    it('a withdrawn method retracts the result', () => {
      const ref = { ...APPROVED_ROUTE!, reviewStatus: 'WITHDRAWN' as const };
      const s = assembleEvidence(
        input({ submission: submission({ routeVersionRef: ref, retractedAt: NOW }) }),
      );
      expect(s.performance.standing).toBe('RETRACTED');
      expect(s.gaps).toContainEqual({
        code: 'METHOD_RETRACTED',
        section: 3,
        params: { status: 'WITHDRAWN' },
      });
    });

    it('publishes the reviewer’s rationale', () => {
      const s = assembleEvidence(input());
      expect(s.method).toMatchObject({ reviewNotes: APPROVED_ROUTE!.reviewNotes });
    });
  });

  describe('section 4 · performance', () => {
    it('a pending submission is not scored, and nothing of sections 4 and 5 is claimed', () => {
      const got = codes(
        input({
          submission: submission({ status: 'PENDING', scores: null, subgroupScores: null }),
          trace: { rows: trace('evaluation.submitted'), limit: 50 },
        }),
      );
      expect(got).toContain('NOT_SCORED');
      expect(got).not.toContain('NO_SUBGROUP_DATA');
      expect(got).not.toContain('NO_INTERVALS');
    });

    it('a failed submission shows no scores even if the column held some', () => {
      const s = assembleEvidence(
        input({
          submission: submission({ status: 'FAILED' }),
          trace: { rows: trace('evaluation.failed'), limit: 50 },
        }),
      );
      expect(s.performance.scores).toBeNull();
      expect(s.subgroups).toBeNull();
      expect(s.gaps).toContainEqual({
        code: 'NOT_SCORED',
        section: 4,
        params: { status: 'FAILED' },
      });
    });

    it('a two-class classification has its diagnostic measures, so no NO_INTERVALS gap', () => {
      const classification = scoreByKind({
        kind: 'CLASSIFICATION',
        groundTruth: GROUND_TRUTH,
        predictions: PREDICTIONS,
        config: CONFIG,
      });
      const s = assembleEvidence(
        input({ submission: submission({ scores: classification, subgroupScores: null }) }),
      );
      expect(s.performance.positiveCases).toBe(60);
      expect(s.performance.derivedDiagnostic?.status).toBe('DERIVED');
      const codes = s.gaps.map((g) => g.code);
      expect(codes).not.toContain('NO_INTERVALS');
      expect(codes).not.toContain('FEW_POSITIVE_CASES');
    });

    it('a classification of more than two classes, and a grading task, keep NO_INTERVALS', () => {
      const three = scoreByKind({
        kind: 'CLASSIFICATION',
        groundTruth: Object.fromEntries(IDS.map((id, i) => [id, i % 3])),
        predictions: Object.fromEntries(IDS.map((id, i) => [id, i % 3])),
        config: { numClasses: 3, referableThreshold: 1 },
      });
      const s3 = assembleEvidence(
        input({ submission: submission({ scores: three, subgroupScores: null }) }),
      );
      expect(s3.performance.derivedDiagnostic).toBeNull();
      expect(s3.gaps).toContainEqual({
        code: 'NO_INTERVALS',
        section: 4,
        params: { taskKind: 'CLASSIFICATION' },
      });
      const grading = {
        kind: 'GRADING',
        metrics: {
          qwk: 0.8,
          accuracy: 0.7,
          referableSensitivity: 0.9,
          referableSpecificity: 0.8,
          coverage: 1,
        },
      };
      const sg = assembleEvidence(
        input({ submission: submission({ scores: grading, subgroupScores: null }) }),
      );
      expect(sg.performance.derivedDiagnostic).toBeNull();
      expect(sg.gaps.map((g) => g.code)).toContain('NO_INTERVALS');
    });

    it(`fewer than ${EVIDENCE_MIN_POSITIVE_CASES} positive cases`, () => {
      const few = Object.fromEntries(IDS.map((id, i) => [id, i < 20 ? 1 : 0]));
      const scores = scoreByKind({
        kind: 'BINARY_DIAGNOSTIC',
        groundTruth: few,
        predictions: few,
        config: CONFIG,
      }) as TaskKindScores;
      const s = assembleEvidence(
        input({ submission: submission({ scores, subgroupScores: null }) }),
      );
      expect(s.gaps).toContainEqual({
        code: 'FEW_POSITIVE_CASES',
        section: 4,
        params: { positives: 20, minimum: EVIDENCE_MIN_POSITIVE_CASES },
      });
    });

    it('a file that left items out', () => {
      const partial = Object.fromEntries(Object.entries(PREDICTIONS).slice(0, 100));
      const scores = scoreByKind({
        kind: 'BINARY_DIAGNOSTIC',
        groundTruth: GROUND_TRUTH,
        predictions: partial,
        config: CONFIG,
      }) as TaskKindScores;
      expect(codes(input({ submission: submission({ scores }) }))).toContain('INCOMPLETE_COVERAGE');
    });

    it('positive cases: none for grading or multi-class', () => {
      expect(positiveCasesOf(null)).toBeNull();
      expect(
        positiveCasesOf({
          kind: 'GRADING',
          metrics: {
            qwk: 0.8,
            accuracy: 0.7,
            referableSensitivity: 0.9,
            referableSpecificity: 0.8,
            coverage: 1,
          },
        }),
      ).toBeNull();
    });
  });

  describe('section 7 · trace', () => {
    it('lists the events with their hashes, and no actor or payload', () => {
      const s = assembleEvidence(input());
      expect(s.trace.events).toHaveLength(2);
      expect(s.trace.events[1]).toStrictEqual({
        sequenceNumber: '101',
        occurredAt: '2026-11-30T10:00:01.000Z',
        eventType: 'evaluation.scored',
        payloadHash: 'a'.repeat(64),
        previousHash: 'c'.repeat(64),
        recordHash: '1'.repeat(64),
      });
    });

    it('no events at all', () => {
      expect(codes(input({ trace: { rows: [], limit: 50 } }))).toContain('NO_AUDIT_EVENTS');
    });

    it('a scored result with no scored event', () => {
      expect(codes(input({ trace: { rows: trace('evaluation.submitted'), limit: 50 } }))).toContain(
        'AUDIT_RESULT_EVENT_MISSING',
      );
    });

    it('cuts a long trace and says so', () => {
      const s = assembleEvidence(
        input({
          trace: { rows: trace('evaluation.submitted', 'evaluation.scored', 'x.y'), limit: 2 },
        }),
      );
      expect(s.trace.events).toHaveLength(2);
      expect(s.trace.truncated).toBe(true);
    });
  });
});

// ---- Who reads it ------------------------------------------------------------

function user(sub: string, groups: string[] = []): CognitoAccessTokenPayload {
  return { sub, 'cognito:groups': groups } as unknown as CognitoAccessTokenPayload;
}

function service(
  row: EvidenceSubmissionRow | null,
  catalog?: Partial<CatalogService>,
  linkedCard: LinkedModelCardEvidenceRow | null = null,
) {
  const repo = {
    findSubmission: vi.fn().mockResolvedValue(row),
    findTrace: vi.fn().mockResolvedValue(trace('evaluation.submitted', 'evaluation.scored')),
  };
  const cat = { detail: vi.fn().mockResolvedValue(dataset()), ...catalog };
  const evaluation = { findLinkedModelCard: vi.fn().mockResolvedValue(linkedCard) };
  return {
    repo,
    cat,
    svc: new EvidenceSummaryService(
      repo as unknown as EvidenceSummaryRepository,
      cat as unknown as CatalogService,
      evaluation as unknown as EvaluationRepository,
    ),
  };
}

describe('EvidenceSummaryService linked model card (#587)', () => {
  const card = (status: LinkedModelCardEvidenceRow['status']): LinkedModelCardEvidenceRow => ({
    slug: 'model-a',
    versionMajorMinorPatch: '1.0.0',
    status,
    modelDeveloper: 'Example developer',
    clinicalSummary: 'Flags airspace opacity on frontal chest radiographs.',
    intendedUse: null,
    knownBiasesOrEthicalConsiderations: null,
  });

  it('shows a published linked card to a regulator', async () => {
    const { svc } = service(submission(), undefined, card('PUBLISHED'));
    const s = await svc.getEvidence(SUBMISSION_ID, user('other', ['regulator']), NOW);
    expect(s.modelCard).not.toBeNull();
    expect(s.gaps.map((g) => g.code)).not.toContain('NO_MODEL_CARD');
  });

  it('hides a draft linked card from a regulator, and reports no card', async () => {
    const { svc } = service(submission(), undefined, card('DRAFT'));
    const s = await svc.getEvidence(SUBMISSION_ID, user('other', ['regulator']), NOW);
    expect(s.modelCard).toBeNull();
    expect(s.gaps.map((g) => g.code)).toContain('NO_MODEL_CARD');
  });

  it('shows a draft linked card to its submitter', async () => {
    const { svc } = service(submission(), undefined, card('DRAFT'));
    const s = await svc.getEvidence(SUBMISSION_ID, user(SUBMITTER_SUB), NOW);
    expect(s.modelCard).not.toBeNull();
  });
});

describe('EvidenceSummaryService access', () => {
  it.each([
    ['the submitter', user(SUBMITTER_SUB)],
    ['an administrator', user('other', ['admin'])],
    ['an evaluation reviewer', user('other', ['evaluation-reviewer'])],
    ['a regulator', user('other', ['regulator'])],
  ])('%s reads a scored submission’s summary', async (_who, caller) => {
    const { svc } = service(submission());
    const s = await svc.getEvidence(SUBMISSION_ID, caller, NOW);
    expect(s.submission.id).toBe(SUBMISSION_ID);
    expect(s.submission.viewerIsSubmitter).toBe(caller.sub === SUBMITTER_SUB);
  });

  it('anyone else signed in is refused', async () => {
    const { svc } = service(submission());
    await expect(
      svc.getEvidence(SUBMISSION_ID, user('other', ['annotator']), NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a failed submission is a 404 to a reviewer or regulator, as on the submission page', async () => {
    const failed = submission({ status: 'FAILED', scores: null, subgroupScores: null });
    for (const groups of [['evaluation-reviewer'], ['regulator']]) {
      const { svc } = service(failed);
      await expect(
        svc.getEvidence(SUBMISSION_ID, user('other', groups), NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
    const { svc } = service(failed);
    await expect(svc.getEvidence(SUBMISSION_ID, user(SUBMITTER_SUB), NOW)).resolves.toBeTruthy();
  });

  it('an unknown id is a 404', async () => {
    const { svc } = service(null);
    await expect(
      svc.getEvidence(SUBMISSION_ID, user('other', ['admin']), NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads the dataset with the reader’s token, and reports one they cannot see as unavailable', async () => {
    const caller = user('other', ['regulator']);
    const { svc, cat } = service(submission(), {
      detail: vi.fn().mockRejectedValue(new NotFoundException('dataset "chest-xr" not found')),
    });
    const s = await svc.getEvidence(SUBMISSION_ID, caller, NOW);
    expect(cat.detail).toHaveBeenCalledWith('chest-xr', caller);
    expect(s.data.dataset).toBeNull();
    expect(s.gaps.map((g) => g.code)).toContain('DATASET_NOT_AVAILABLE');
  });

  it('any other catalogue error is not hidden', async () => {
    const { svc } = service(submission(), {
      detail: vi.fn().mockRejectedValue(new Error('database down')),
    });
    await expect(svc.getEvidence(SUBMISSION_ID, user('other', ['admin']), NOW)).rejects.toThrow(
      'database down',
    );
  });

  it('reports the model card as missing until submissions are linked to cards (#587)', async () => {
    const { svc } = service(submission());
    const s = await svc.getEvidence(SUBMISSION_ID, user(SUBMITTER_SUB), NOW);
    expect(s.modelCard).toBeNull();
    expect(s.gaps[0]).toStrictEqual({ code: 'NO_MODEL_CARD', section: 1, params: {} });
  });
});

// ---- Two-class classification: diagnostic measures from the stored result ----

describe('deriveTwoClassDiagnostic', () => {
  const classification = (truth: Record<string, number>, predicted: Record<string, number>) =>
    (
      scoreByKind({
        kind: 'CLASSIFICATION',
        groundTruth: truth,
        predictions: predicted,
        config: CONFIG,
      }) as Extract<TaskKindScores, { kind: 'CLASSIFICATION' }>
    ).metrics;
  const binary = (truth: Record<string, number>, predicted: Record<string, number>) =>
    (
      scoreByKind({
        kind: 'BINARY_DIAGNOSTIC',
        groundTruth: truth,
        predictions: predicted,
        config: CONFIG,
      }) as Extract<TaskKindScores, { kind: 'BINARY_DIAGNOSTIC' }>
    ).metrics;

  it('recovers the exact counts and gives the binary scorer’s figures and Wilson intervals', () => {
    const derived = deriveTwoClassDiagnostic(classification(GROUND_TRUTH, PREDICTIONS));
    const reference = binary(GROUND_TRUTH, PREDICTIONS);
    expect(derived).toStrictEqual({
      status: 'DERIVED',
      positiveLabel: 1,
      truePositives: reference.truePositives,
      falsePositives: reference.falsePositives,
      trueNegatives: reference.trueNegatives,
      falseNegatives: reference.falseNegatives,
      sensitivity: reference.sensitivity,
      specificity: reference.specificity,
      positivePredictiveValue: reference.positivePredictiveValue,
      negativePredictiveValue: reference.negativePredictiveValue,
    });
  });

  it('matches the binary scorer on awkward fractions and partial files', () => {
    // 7 positives of 23, an odd error pattern, and a file that skips items.
    const ids = Array.from({ length: 23 }, (_, i) => `x${i}`);
    const truth = Object.fromEntries(ids.map((id, i) => [id, i % 3 === 0 ? 1 : 0]));
    const predicted = Object.fromEntries(
      ids
        .slice(0, 21)
        .map((id, i) => [id, i % 4 === 0 ? 1 - (i % 3 === 0 ? 1 : 0) : i % 3 === 0 ? 1 : 0]),
    );
    const derived = deriveTwoClassDiagnostic(classification(truth, predicted));
    const reference = binary(truth, predicted);
    expect(derived).toMatchObject({
      status: 'DERIVED',
      truePositives: reference.truePositives,
      falsePositives: reference.falsePositives,
      trueNegatives: reference.trueNegatives,
      falseNegatives: reference.falseNegatives,
      sensitivity: reference.sensitivity,
      negativePredictiveValue: reference.negativePredictiveValue,
    });
  });

  it('a class with no reference item: its rate is not estimable, never 0%', () => {
    const allNegative = Object.fromEntries(IDS.map((id) => [id, 0]));
    const derived = deriveTwoClassDiagnostic(classification(allNegative, allNegative));
    expect(derived).toMatchObject({ status: 'DERIVED', truePositives: 0, falseNegatives: 0 });
    expect(derived?.status === 'DERIVED' && derived.sensitivity).toBeNull();
  });

  it('not recoverable when a rounded recall fits two counts: nothing is approximated', () => {
    // 10 000 / 20 001 and 10 001 / 20 001 both round to 0.5000.
    const metrics: ClassificationScores = {
      accuracy: 0.5,
      balancedAccuracy: 0.5,
      macroF1: 0.5,
      microF1: 0.5,
      coverage: 1,
      perClass: [
        { label: 0, precision: 0.5, recall: 0.5, f1: 0.5, support: 20001 },
        { label: 1, precision: 0.5, recall: 0.5, f1: 0.5, support: 20001 },
      ],
    };
    expect(deriveTwoClassDiagnostic(metrics)).toStrictEqual({ status: 'NOT_RECOVERABLE' });
  });

  it('not recoverable when the counts do not reproduce the stored precision', () => {
    const metrics = structuredClone(classification(GROUND_TRUTH, PREDICTIONS));
    const one = metrics.perClass.find((c) => c.label === 1)!;
    one.precision = 0.1234;
    expect(deriveTwoClassDiagnostic(metrics)).toStrictEqual({ status: 'NOT_RECOVERABLE' });
    // And the summary then keeps the NO_INTERVALS gap: no interval is shown.
    const s = assembleEvidence(
      input({
        submission: submission({
          scores: { kind: 'CLASSIFICATION', metrics },
          subgroupScores: null,
        }),
      }),
    );
    expect(s.gaps.map((g) => g.code)).toContain('NO_INTERVALS');
  });

  it('not applicable to a result without exactly the classes 0 and 1', () => {
    const metrics = structuredClone(classification(GROUND_TRUTH, PREDICTIONS));
    metrics.perClass = metrics.perClass.slice(0, 1);
    expect(deriveTwoClassDiagnostic(metrics)).toBeNull();
  });
});
