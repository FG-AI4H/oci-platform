import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditEmitter } from '@oci/audit';
import type { CreateModelCardRequest, IntendedUseStatement } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    submitterUserId: '99999999-9999-9999-9999-999999999999',
    intendedUse: IUS,
    modelClass: 'lmm',
    architectureSummary: 'Transformer decoder, 7B params.',
    trainingDataLineage: {},
    parentModelCardId: null,
    versionMajorMinorPatch: '1.0.0',
    changeJustification: null,
    materialChange: false,
    trainingDataJurisdictions: ['CH', 'EU'],
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
  updateStatus: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let intendedUse: { validate: ReturnType<typeof vi.fn> };
let audit: { emit: ReturnType<typeof vi.fn>; emitSync: ReturnType<typeof vi.fn> };
let service: PredictionService;

beforeEach(() => {
  repo = { create: vi.fn(), findBySlug: vi.fn(), findById: vi.fn(), updateStatus: vi.fn() };
  intendedUse = { validate: vi.fn().mockReturnValue(IUS) };
  audit = { emit: vi.fn().mockResolvedValue(undefined), emitSync: vi.fn().mockResolvedValue({}) };
  service = new PredictionService(
    repo as unknown as PredictionRepository,
    intendedUse as unknown as IntendedUseService,
    audit as unknown as AuditEmitter,
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

    const label = await service.modelFactsLabel('acme-triage-v1');

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

    const label = await service.modelFactsLabel('acme-triage-v1');

    // No evaluations linked, no subgroup report, no clinical summary on the fixture.
    expect(label.validationAndPerformance.entries).toEqual([]);
    expect(label.validationAndPerformance.subgroupAvailable).toBe(false);
    expect(label.gaps.join(' ')).toContain('no evaluation results');
    expect(label.gaps.join(' ')).toContain('Per-subgroup performance');
    // A missing discontinue-use policy must not read as "safe to keep using".
    expect(label.discontinueUse.statement).toContain('not evidence of continued validity');
  });

  it('refuses to render a label for a DRAFT card', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'DRAFT' }));

    await expect(service.modelFactsLabel('acme-triage-v1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404s for an unknown slug', async () => {
    repo.findBySlug.mockResolvedValue(null);

    await expect(service.modelFactsLabel('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renders markdown with the WHO section headings', async () => {
    repo.findBySlug.mockResolvedValue(dbRow({ status: 'PUBLISHED' }));

    const md = await service.modelFactsMarkdown('acme-triage-v1');

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
