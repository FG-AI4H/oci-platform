import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConsentRecord } from '@oci/database';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentRepository } from './consent.repository.js';
import { ConsentService } from './consent.service.js';

const USER = { sub: 'cognito-sub-1' } as unknown as CognitoAccessTokenPayload;

function row(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id: 'c-1',
    datasetId: 'ds-1',
    consenterSub: 'cognito-sub-1',
    consenterUserId: null,
    consentType: 'ANNOTATION_USE',
    status: 'ACTIVE',
    scope: { purpose: 'annotation' },
    disclosureText: 'I consent to annotation use.',
    textSha256: 'a'.repeat(64),
    validFrom: new Date('2026-05-29T00:00:00Z'),
    validUntil: null,
    signedReceiptArn: null,
    receiptSignature: null,
    receiptKeyId: null,
    revokedAt: null,
    revocationReason: null,
    revocationSignature: null,
    revocationKeyId: null,
    createdAt: new Date('2026-05-29T00:00:00Z'),
    updatedAt: new Date('2026-05-29T00:00:00Z'),
    ...overrides,
  } as ConsentRecord;
}

interface RepoMock {
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  listByDataset: ReturnType<typeof vi.fn>;
  setGrantSignature: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
  countActiveAnnotationConsents: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let service: ConsentService;

beforeEach(() => {
  delete process.env.OCI_KMS_SIGNING_KEY_ARN; // dev path: hash-binding, no KMS
  repo = {
    create: vi.fn(),
    findById: vi.fn(),
    listByDataset: vi.fn(),
    setGrantSignature: vi.fn(),
    revoke: vi.fn(),
    countActiveAnnotationConsents: vi.fn(),
  };
  service = new ConsentService(repo as unknown as ConsentRepository);
});

describe('ConsentService.record', () => {
  it('hashes the disclosure text and records the consent (unsigned on dev)', async () => {
    repo.create.mockResolvedValue(row());
    const res = await service.record(
      {
        datasetId: 'ds-1',
        consentType: 'ANNOTATION_USE',
        scope: { purpose: 'annotation' },
        disclosureText: 'I consent to annotation use.',
      },
      USER,
    );
    expect(res.consentType).toBe('ANNOTATION_USE');
    expect(res.status).toBe('ACTIVE');
    expect(res.textSha256).toHaveLength(64);
    expect(res.signed).toBe(false);
    // consenterUserId defaults to the UUIDv5 of the caller sub
    expect(repo.create.mock.calls[0]?.[0]?.consenterUserId).toBeTruthy();
    expect(repo.setGrantSignature).not.toHaveBeenCalled(); // no KMS configured
  });
});

describe('ConsentService.revoke', () => {
  it('revokes an active consent', async () => {
    repo.findById.mockResolvedValue(row());
    repo.revoke.mockResolvedValue(
      row({ status: 'REVOKED', revokedAt: new Date(), revocationReason: 'withdrawn' }),
    );
    const res = await service.revoke('c-1', { reason: 'withdrawn' }, USER);
    expect(res.status).toBe('REVOKED');
    expect(res.revocationReason).toBe('withdrawn');
  });

  it('404s an unknown consent', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.revoke('x', { reason: 'r' }, USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('409s a double revoke', async () => {
    repo.findById.mockResolvedValue(row({ status: 'REVOKED' }));
    await expect(service.revoke('c-1', { reason: 'r' }, USER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('ConsentService gate predicate', () => {
  it('isDatasetAnnotationConsented is true when an active annotation consent exists', async () => {
    repo.countActiveAnnotationConsents.mockResolvedValue(1);
    expect(await service.isDatasetAnnotationConsented('ds-1')).toBe(true);
  });

  it('is false when none active (e.g. all revoked) — halts dataset use', async () => {
    repo.countActiveAnnotationConsents.mockResolvedValue(0);
    expect(await service.isDatasetAnnotationConsented('ds-1')).toBe(false);
  });

  it('history surfaces the gate flag alongside the full record list', async () => {
    repo.listByDataset.mockResolvedValue([row(), row({ id: 'c-2', status: 'REVOKED' })]);
    repo.countActiveAnnotationConsents.mockResolvedValue(1);
    const hist = await service.historyForDataset('ds-1');
    expect(hist.annotationAllowed).toBe(true);
    expect(hist.records).toHaveLength(2);
    expect(hist.datasetId).toBe('ds-1');
  });
});
