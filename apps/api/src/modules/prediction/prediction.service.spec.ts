import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditEmitter } from '@oci/audit';
import {
  PublicModelCardSchema,
  type CreateModelCardRequest,
  type IntendedUseStatement,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import type { CatalogService, DatasetReferenceFacts } from '../catalog/catalog.service.js';
import type { ModelCardEvidenceService } from '../evaluation/model-card-evidence.service.js';
import type { ModelCardPerformance } from '../evaluation/model-card-evidence.js';
import { IntendedUseService } from '../intended-use/intended-use.service.js';
import { PredictionRepository } from './prediction.repository.js';
import { PredictionService } from './prediction.service.js';

const IUS = {
  v: 1,
  medicalPurpose: 'triage',
  foreseeableMisuse: 'Used outside the validated adult population.',
  contraindications: '',
  riskTier: 'III',
} as unknown as IntendedUseStatement;

function body(overrides: Partial<CreateModelCardRequest> = {}): CreateModelCardRequest {
  return {
    slug: 'acme-triage-v1',
    intendedUse: IUS,
    modelClass: 'lmm',
    architectureSummary: 'Transformer decoder, 7B params.',
    trainingDataLineage: {},
    parentModelCardId: null,
    versionMajorMinorPatch: '1.0.0',
    changeJustification: null,
    materialChange: false,
    trainingDataJurisdictions: ['CH', 'EU'],
    datasetRefs: [],
    generativeAi: true,
    lmmSpecificLimitations: null,
    modelDeveloper: 'Acme Health AI GmbH',
    developerContact: 'regulatory@acme.example',
    clinicalSummary: null,
    regulatoryApproval: null,
    knownBiasesOrEthicalConsiderations: null,
    biasMitigationApproaches: null,
    ongoingMaintenance: null,
    securityPosture: null,
    ...overrides,
  } as CreateModelCardRequest;
}

function actor(): CognitoAccessTokenPayload {
  return { sub: 'submitter-sub', username: 'submitter' } as unknown as CognitoAccessTokenPayload;
}

function dbRow(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'acme-triage-v1',
    submitterUserId: cognitoSubAsUuid(actor().sub),
    intendedUse: IUS,
    modelClass: 'lmm',
    architectureSummary: 'Transformer decoder, 7B params.',
    trainingDataLineage: {},
    parentModelCardId: null,
    versionMajorMinorPatch: '1.0.0',
    changeJustification: null,
    materialChange: false,
    trainingDataJurisdictions: ['CH', 'EU'],
    datasetRefs: [],
    generativeAi: true,
    lmmSpecificLimitations: null,
    status: 'DRAFT',
    modelDeveloper: 'Acme Health AI GmbH',
    developerContact: 'regulatory@acme.example',
    clinicalSummary: null,
    regulatoryApproval: null,
    knownBiasesOrEthicalConsiderations: null,
    biasMitigationApproaches: null,
    ongoingMaintenance: null,
    securityPosture: null,
    createdAt: new Date('2026-07-26T00:00:00.000Z'),
    updatedAt: new Date('2026-07-26T00:00:00.000Z'),
    ...over,
  };
}

interface RepoMock {
  create: ReturnType<typeof vi.fn>;
  findBySlug: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  searchPublished: ReturnType<typeof vi.fn>;
  findPublishedByDatasetSlug: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let intendedUse: { validate: ReturnType<typeof vi.fn> };
let audit: { emit: ReturnType<typeof vi.fn>; emitSync: ReturnType<typeof vi.fn> };
let evidence: { performanceFor: ReturnType<typeof vi.fn> };
let catalog: { referenceFacts: ReturnType<typeof vi.fn> };
let service: PredictionService;

const NO_EVIDENCE: ModelCardPerformance = { entries: [], retracted: 0, notEstimable: 0 };

beforeEach(() => {
  repo = {
    create: vi.fn(),
    findBySlug: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    searchPublished: vi.fn(),
    findPublishedByDatasetSlug: vi.fn(),
  };
  intendedUse = { validate: vi.fn().mockReturnValue(IUS) };
  audit = { emit: vi.fn().mockResolvedValue(undefined), emitSync: vi.fn().mockResolvedValue({}) };
  evidence = { performanceFor: vi.fn().mockResolvedValue(NO_EVIDENCE) };
  // By default the caller sees no dataset at all.
  catalog = { referenceFacts: vi.fn().mockResolvedValue(new Map()) };
  service = new PredictionService(
    repo as unknown as PredictionRepository,
    intendedUse as unknown as IntendedUseService,
    audit as unknown as AuditEmitter,
    evidence as unknown as ModelCardEvidenceService,
    catalog as unknown as CatalogService,
  );
});

describe('PredictionService.submit', () => {
  it('validates the IUS, persists the model card, and emits an audit event', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.create.mockResolvedValue(dbRow());

    const out = await service.submit(body(), actor());

    expect(intendedUse.validate).toHaveBeenCalledWith(IUS);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'acme-triage-v1', modelClass: 'lmm' }),
    );
    expect(audit.emitSync).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'prediction',
        action: 'modelcard.created',
        subjectType: 'model-card',
      }),
    );
    expect(out.slug).toBe('acme-triage-v1');
    expect(out.modelClass).toBe('lmm');
  });

  it('409s when the slug already exists — no write, no audit', async () => {
    repo.findBySlug.mockResolvedValue(dbRow());

    await expect(service.submit(body(), actor())).rejects.toBeInstanceOf(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
    expect(audit.emitSync).not.toHaveBeenCalled();
  });

  it('404s when a declared semver parent does not exist', async () => {
    repo.findById.mockResolvedValue(null);

    await expect(
      service.submit(body({ parentModelCardId: '22222222-2222-2222-2222-222222222222' }), actor()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('PredictionService.changeStatus', () => {
  it('moves DRAFT → SUBMITTED and emits an audit event', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'DRAFT' }));
    repo.updateStatus.mockResolvedValue(dbRow({ status: 'SUBMITTED' }));

    const out = await service.changeStatus('acme-triage-v1', { status: 'SUBMITTED' }, actor());

    expect(repo.updateStatus).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      'SUBMITTED',
    );
    expect(audit.emitSync).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'prediction',
        action: 'modelcard.status.changed',
        payload: expect.objectContaining({ from: 'DRAFT', to: 'SUBMITTED' }),
      }),
    );
    expect(out.status).toBe('SUBMITTED');
  });

  it('400s on an illegal transition and names the allowed moves — no write, no audit', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'DRAFT' }));

    await expect(
      service.changeStatus('acme-triage-v1', { status: 'PUBLISHED' }, actor()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.changeStatus('acme-triage-v1', { status: 'PUBLISHED' }, actor()),
    ).rejects.toMatchObject({ message: expect.stringContaining('SUBMITTED') });
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(audit.emitSync).not.toHaveBeenCalled();
  });

  it('409s when the card is already in the requested status', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED' }));

    await expect(
      service.changeStatus('acme-triage-v1', { status: 'PUBLISHED' }, actor()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses to move out of the terminal WITHDRAWN status', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'WITHDRAWN' }));

    await expect(
      service.changeStatus('acme-triage-v1', { status: 'PUBLISHED' }, actor()),
    ).rejects.toMatchObject({ message: expect.stringContaining('terminal') });
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('404s when the model card does not exist', async () => {
    repo.findBySlug.mockResolvedValue(null);

    await expect(
      service.changeStatus('nope', { status: 'SUBMITTED' }, actor()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PredictionService.modelFactsLabel (#261)', () => {
  it('renders the WHO Fig. 7 sections from the card + IUS', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED' }));

    const label = await service.modelFactsLabel('acme-triage-v1', actor());

    expect(label.v).toBe(1);
    expect(label.summary.developer).toBe('Acme Health AI GmbH');
    expect(label.summary.status).toBe('PUBLISHED');
    expect(label.mechanism.modelClass).toBe('lmm');
    expect(label.warnings.riskTier).toBe('III');
    expect(label.usesAndDirections.medicalPurpose).toBe('triage');
    expect(label.generalisability.trainingDataJurisdictions).toEqual(['CH', 'EU']);
  });

  it('declares its gaps rather than silently omitting them', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED' }));

    const label = await service.modelFactsLabel('acme-triage-v1', actor());

    // No evaluations linked, no subgroup report, no clinical summary on the fixture.
    expect(label.validationAndPerformance.entries).toEqual([]);
    expect(label.validationAndPerformance.subgroupAvailable).toBe(false);
    expect(label.gaps.join(' ')).toContain('no evaluation results');
    expect(label.gaps.join(' ')).toContain('Per-subgroup performance');
    // A missing discontinue-use policy must not read as "safe to keep using".
    expect(label.discontinueUse.statement).toContain('not evidence of continued validity');
  });

  it('reads the performance rows for this card through the evaluation module (#587)', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED' }));

    await service.modelFactsLabel('acme-triage-v1', actor());

    expect(evidence.performanceFor).toHaveBeenCalledWith(dbRow().id);
  });

  it('never reads evidence for a card the caller may not see', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'SUBMITTED' }));

    await expect(service.modelFactsLabel('acme-triage-v1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(evidence.performanceFor).not.toHaveBeenCalled();
  });

  it('refuses to render a label for a DRAFT card', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'DRAFT' }));

    await expect(service.modelFactsLabel('acme-triage-v1', actor())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404s for an unknown slug', async () => {
    repo.findBySlug.mockResolvedValue(null);

    await expect(service.modelFactsLabel('nope', actor())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('renders markdown with the WHO section headings', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED' }));

    const md = await service.modelFactsMarkdown('acme-triage-v1', actor());

    for (const heading of [
      '# Model Facts —',
      '## Summary',
      '## Mechanism',
      '## Validation & performance',
      '## Uses & directions',
      '## Warnings',
      '## Generalisability',
      '## When to discontinue use',
      '## Known gaps in this label',
    ]) {
      expect(md).toContain(heading);
    }
  });
});

/** Fields kept off the public card (#591); given values so their absence is meaningful. */
const PRIVATE_VALUES = {
  securityPosture: 'Pen-tested quarterly; model weights encrypted at rest.',
  trainingDataLineage: { source: 's3://internal-bucket/training' },
  parentModelCardId: '22222222-2222-2222-2222-222222222222',
  changeJustification: 'Internal: retrained after reviewer feedback.',
};
const PRIVATE_KEYS = ['submitterUserId', ...Object.keys(PRIVATE_VALUES)];
const PUBLIC_KEYS = Object.keys(PublicModelCardSchema.shape).sort();

function stranger(): CognitoAccessTokenPayload {
  return {
    sub: 'stranger-sub',
    'cognito:groups': ['participant'],
  } as unknown as CognitoAccessTokenPayload;
}

function reviewer(group: string): CognitoAccessTokenPayload {
  return { sub: 'reviewer-sub', 'cognito:groups': [group] } as unknown as CognitoAccessTokenPayload;
}

describe('PredictionService — public reads (#591)', () => {
  it('serves a PUBLISHED card anonymously as the public card', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED', ...PRIVATE_VALUES }));

    const out = await service.getBySlug('acme-triage-v1');

    expect(out.slug).toBe('acme-triage-v1');
    expect(Object.keys(out).sort()).toEqual(PUBLIC_KEYS);
  });

  it('serves a signed-in stranger the public card too', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED', ...PRIVATE_VALUES }));

    const out = await service.getBySlug('acme-triage-v1', stranger());

    expect(Object.keys(out).sort()).toEqual(PUBLIC_KEYS);
    for (const key of PRIVATE_KEYS) expect(out).not.toHaveProperty(key);
    // The CHAI developer-contact disclosure is meant to be published.
    expect(out).toHaveProperty('developerContact', 'regulatory@acme.example');
  });

  it.each([
    ['submitter', () => actor()],
    ['evaluation-reviewer', () => reviewer('evaluation-reviewer')],
    ['admin', () => reviewer('admin')],
  ])('serves the %s the full card', async (_who, who) => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED', ...PRIVATE_VALUES }));

    const out = await service.getBySlug('acme-triage-v1', who());

    expect(out).toMatchObject({
      submitterUserId: cognitoSubAsUuid(actor().sub),
      ...PRIVATE_VALUES,
    });
  });

  it.each(['DRAFT', 'SUBMITTED', 'WITHDRAWN'])(
    '404s an anonymous read of a %s card, same as an unknown slug',
    async (status) => {
      repo.findBySlug.mockResolvedValue(dbRow({ status }));

      await expect(service.getBySlug('acme-triage-v1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.modelFactsLabel('acme-triage-v1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.modelFactsMarkdown('acme-triage-v1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  it('keeps the signed-in rules: the submitter sees their own DRAFT, with submitterUserId', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'DRAFT' }));

    const out = await service.getBySlug('acme-triage-v1', actor());

    expect(out).toHaveProperty('submitterUserId', cognitoSubAsUuid(actor().sub));
  });

  it('renders the Model Facts Label anonymously for a PUBLISHED card', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED' }));

    const label = await service.modelFactsLabel('acme-triage-v1');

    expect(label.modelCardSlug).toBe('acme-triage-v1');
  });
});

describe('PredictionService.listPublished (#591)', () => {
  it('passes the filters through and turns page/limit into an offset', async () => {
    repo.searchPublished.mockResolvedValue({ rows: [], total: 0 });

    await service.listPublished({
      q: 'retina',
      modelClass: 'classical',
      jurisdiction: 'CH',
      sort: 'name',
      page: 3,
      limit: 10,
    });

    expect(repo.searchPublished).toHaveBeenCalledWith({
      q: 'retina',
      modelClass: 'classical',
      jurisdiction: 'CH',
      sort: 'name',
      offset: 20,
      limit: 10,
    });
  });

  it('reports page metadata from the total', async () => {
    repo.searchPublished.mockResolvedValue({ rows: [], total: 51 });

    const out = await service.listPublished({ sort: 'recent', page: 2, limit: 25 });

    expect(out).toEqual({ items: [], total: 51, page: 2, pageSize: 25, totalPages: 3 });
  });

  it('reports one page, not zero, when nothing matches', async () => {
    repo.searchPublished.mockResolvedValue({ rows: [], total: 0 });

    const out = await service.listPublished({ sort: 'recent', page: 1, limit: 25 });

    expect(out.totalPages).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Declared datasets (#820)
// ---------------------------------------------------------------------------

const IDRID: DatasetReferenceFacts = {
  slug: 'idrid-grading',
  name: 'IDRiD disease grading',
  modalities: ['Fundus photography'],
  formats: ['image/jpeg', 'text/csv'],
  licence: 'CC-BY-4.0',
  latestVersion: '1.2.0',
  latestManifestSha256: 'a'.repeat(64),
};

function seenBy(...facts: DatasetReferenceFacts[]) {
  return new Map(facts.map((f) => [f.slug, f]));
}

function refRow(over: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    modelCardId: '11111111-1111-1111-1111-111111111111',
    position: 0,
    role: 'TRAINING',
    datasetSlug: 'idrid-grading',
    manifestVersion: '1.0.0',
    manifestSha256: 'b'.repeat(64),
    externalUrl: null,
    externalName: null,
    note: 'Training split only',
    createdAt: new Date('2026-11-27T00:00:00.000Z'),
    ...over,
  };
}

function publishedResult(over: Record<string, unknown> = {}) {
  return {
    submissionId: '33333333-3333-3333-3333-333333333333',
    taskSlug: 'idrid-dr-grading',
    taskName: 'Diabetic retinopathy grading',
    datasetSlug: 'idrid-grading',
    datasetVersion: '1.2.0',
    standing: 'PUBLISHED',
    ...over,
  };
}

describe('PredictionService: declared datasets (#820)', () => {
  it('pins the catalogue version current when the reference is saved', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.create.mockResolvedValue(dbRow());
    catalog.referenceFacts.mockResolvedValue(seenBy(IDRID));

    await service.submit(
      body({
        datasetRefs: [
          { role: 'TRAINING', datasetSlug: 'idrid-grading', note: 'Training split only' },
          {
            role: 'EVALUATION',
            externalUrl: 'https://doi.org/10.5555/example',
            externalName: 'Messidor-2',
          },
        ],
      }),
      actor(),
    );

    expect(catalog.referenceFacts).toHaveBeenCalledWith(['idrid-grading'], actor());
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetRefs: [
          {
            role: 'TRAINING',
            datasetSlug: 'idrid-grading',
            manifestVersion: '1.2.0',
            manifestSha256: 'a'.repeat(64),
            externalUrl: null,
            externalName: null,
            note: 'Training split only',
          },
          {
            role: 'EVALUATION',
            datasetSlug: null,
            manifestVersion: null,
            manifestSha256: null,
            externalUrl: 'https://doi.org/10.5555/example',
            externalName: 'Messidor-2',
            note: null,
          },
        ],
      }),
    );
  });

  it('refuses a dataset the submitter cannot see, the same way as one that does not exist', async () => {
    repo.findBySlug.mockResolvedValue(null);

    await expect(
      service.submit(
        body({ datasetRefs: [{ role: 'TRAINING', datasetSlug: 'hospital-private-ct' }] }),
        actor(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repo.create).not.toHaveBeenCalled();
    expect(audit.emitSync).not.toHaveBeenCalled();
  });

  it('keeps the pin of a dataset the card already declared when it is edited', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ datasetRefs: [refRow()] }));
    repo.update.mockResolvedValue(dbRow({ datasetRefs: [refRow({ note: 'Reworded' })] }));
    // The catalogue has moved on to 1.2.0 since the reference was saved at 1.0.0.
    catalog.referenceFacts.mockResolvedValue(seenBy(IDRID));

    await service.update(
      'acme-triage-v1',
      { datasetRefs: [{ role: 'TRAINING', datasetSlug: 'idrid-grading', note: 'Reworded' }] },
      actor(),
    );

    expect(repo.update).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      expect.objectContaining({
        datasetRefs: [
          expect.objectContaining({
            datasetSlug: 'idrid-grading',
            manifestVersion: '1.0.0',
            manifestSha256: 'b'.repeat(64),
            note: 'Reworded',
          }),
        ],
      }),
    );
  });

  it('leaves the declared datasets alone when an edit does not send them', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ datasetRefs: [refRow()] }));
    repo.update.mockResolvedValue(dbRow({ datasetRefs: [refRow()] }));

    await service.update('acme-triage-v1', { clinicalSummary: 'Reworded' }, actor());

    expect(repo.update.mock.calls[0]?.[1]).toHaveProperty('datasetRefs', undefined);
  });

  it('serves the public a dataset they may see with its catalogue facts', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED', datasetRefs: [refRow()] }));
    catalog.referenceFacts.mockResolvedValue(seenBy(IDRID));

    const out = await service.getBySlug('acme-triage-v1');

    expect(out.datasetRefs).toEqual([
      {
        role: 'TRAINING',
        kind: 'CATALOGUE',
        datasetSlug: 'idrid-grading',
        externalUrl: null,
        externalName: null,
        note: 'Training split only',
        manifestVersion: '1.0.0',
        manifestSha256: 'b'.repeat(64),
        dataset: {
          name: 'IDRiD disease grading',
          modalities: ['Fundus photography'],
          formats: ['image/jpeg', 'text/csv'],
          licence: 'CC-BY-4.0',
          latestVersion: '1.2.0',
        },
      },
    ]);
  });

  it('serves the public only the role of a dataset they may not see', async () => {
    repo.findBySlug.mockResolvedValue(
      dbRow({
        status: 'PUBLISHED',
        datasetRefs: [refRow({ datasetSlug: 'hospital-private-ct', note: 'Site A, 2024' })],
      }),
    );

    const out = await service.getBySlug('acme-triage-v1', stranger());

    expect(out.datasetRefs).toEqual([
      {
        role: 'TRAINING',
        kind: 'WITHHELD',
        datasetSlug: null,
        externalUrl: null,
        externalName: null,
        note: null,
        manifestVersion: null,
        manifestSha256: null,
        dataset: null,
      },
    ]);
    expect(JSON.stringify(out)).not.toContain('hospital-private-ct');
    expect(JSON.stringify(out)).not.toContain('Site A');
  });

  it('keeps the slug for the submitter, who typed it, even without catalogue facts', async () => {
    repo.findBySlug.mockResolvedValue(
      dbRow({ datasetRefs: [refRow({ datasetSlug: 'hospital-private-ct' })] }),
    );

    const out = await service.getBySlug('acme-triage-v1', actor());

    expect(out.datasetRefs[0]).toMatchObject({
      kind: 'CATALOGUE',
      datasetSlug: 'hospital-private-ct',
      dataset: null,
    });
  });

  it('lists an external dataset with its address and name', async () => {
    repo.findBySlug.mockResolvedValue(
      dbRow({
        status: 'PUBLISHED',
        datasetRefs: [
          refRow({
            datasetSlug: null,
            manifestVersion: null,
            manifestSha256: null,
            externalUrl: 'https://doi.org/10.5555/example',
            externalName: 'Messidor-2',
            note: null,
          }),
        ],
      }),
    );

    const out = await service.getBySlug('acme-triage-v1');

    expect(out.datasetRefs[0]).toMatchObject({
      kind: 'EXTERNAL',
      externalUrl: 'https://doi.org/10.5555/example',
      externalName: 'Messidor-2',
    });
    expect(catalog.referenceFacts).not.toHaveBeenCalled();
  });

  it('derives "evaluated on" from published results only, one line per task', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED' }));
    evidence.performanceFor.mockResolvedValue({
      entries: [
        publishedResult(),
        publishedResult({ submissionId: '44444444-4444-4444-4444-444444444444' }),
        publishedResult({ taskSlug: 'other-task', standing: 'PROVISIONAL' }),
      ],
      retracted: 0,
      notEstimable: 0,
    });
    catalog.referenceFacts.mockResolvedValue(seenBy(IDRID));

    const out = await service.getBySlug('acme-triage-v1');

    expect(out.evaluatedOn).toEqual([
      {
        taskSlug: 'idrid-dr-grading',
        taskName: 'Diabetic retinopathy grading',
        datasetSlug: 'idrid-grading',
        datasetVersion: '1.2.0',
        dataset: expect.objectContaining({ name: 'IDRiD disease grading' }),
      },
    ]);
  });
});

describe('PredictionService.listForDataset (#820)', () => {
  it('lists the published cards that declare a dataset the caller may see', async () => {
    catalog.referenceFacts.mockResolvedValue(seenBy(IDRID));
    const items = [
      {
        slug: 'acme-triage-v1',
        modelDeveloper: 'Acme Health AI GmbH',
        versionMajorMinorPatch: '1.0.0',
        medicalPurpose: 'triage',
        riskTier: 'III',
        roles: ['TRAINING'],
      },
    ];
    repo.findPublishedByDatasetSlug.mockResolvedValue(items);

    await expect(service.listForDataset('idrid-grading')).resolves.toEqual({ items });
  });

  it('404s for a dataset the caller may not see, without reading any card', async () => {
    await expect(service.listForDataset('hospital-private-ct', stranger())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.findPublishedByDatasetSlug).not.toHaveBeenCalled();
  });
});
