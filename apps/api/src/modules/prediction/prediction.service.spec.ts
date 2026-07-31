import { ConflictException, NotFoundException } from '@nestjs/common';
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
    createdAt: new Date('2026-07-26T00:00:00.000Z'),
    updatedAt: new Date('2026-07-26T00:00:00.000Z'),
    ...over,
  };
}

interface RepoMock {
  create: ReturnType<typeof vi.fn>;
  findBySlug: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let intendedUse: { validate: ReturnType<typeof vi.fn> };
let audit: { emit: ReturnType<typeof vi.fn>; emitSync: ReturnType<typeof vi.fn> };
let service: PredictionService;

beforeEach(() => {
  repo = { create: vi.fn(), findBySlug: vi.fn(), findById: vi.fn() };
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
