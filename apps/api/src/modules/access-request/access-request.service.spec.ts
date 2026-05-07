import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CatalogService } from '../catalog/catalog.service.js';
import { AccessRequestRepository } from './access-request.repository.js';
import { AccessRequestService } from './access-request.service.js';

// UUID-shaped subs short-circuit the UUIDv5 derivation, so use them
// in fixtures so equality checks against `hostId` are predictable.
const HOST_SUB = '00000000-0000-4000-8000-000000000001';
const REQUESTER_SUB = '00000000-0000-4000-8000-000000000002';
const ADMIN_SUB = '00000000-0000-4000-8000-000000000003';
const DATASET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function user(sub: string, ...groups: string[]): CognitoAccessTokenPayload {
  return { sub, 'cognito:groups': groups } as unknown as CognitoAccessTokenPayload;
}

interface RepoMock {
  create: ReturnType<typeof vi.fn>;
  findByIdWithDataset: ReturnType<typeof vi.fn>;
  listForRequester: ReturnType<typeof vi.fn>;
  listForDataset: ReturnType<typeof vi.fn>;
  listForHost: ReturnType<typeof vi.fn>;
  setDecision: ReturnType<typeof vi.fn>;
}

interface CatalogMock {
  findOwnerBySlug: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let catalog: CatalogMock;
let service: AccessRequestService;

beforeEach(() => {
  repo = {
    create: vi.fn(),
    findByIdWithDataset: vi.fn(),
    listForRequester: vi.fn(),
    listForDataset: vi.fn(),
    listForHost: vi.fn(),
    setDecision: vi.fn(),
  };
  catalog = { findOwnerBySlug: vi.fn() };
  service = new AccessRequestService(
    repo as unknown as AccessRequestRepository,
    catalog as unknown as CatalogService,
  );
});

const validBody = {
  justification: 'Replicating an analysis published in 10.1234/example for thesis work.',
  attestations: { irbApproved: true },
};

describe('AccessRequestService.create', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      service.create('rsna-pneumonia-2018', validBody, {} as CognitoAccessTokenPayload),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s when the dataset does not exist', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(null);
    await expect(service.create('missing', validBody, user(REQUESTER_SUB))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a host self-requesting access on their own dataset', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    await expect(service.create('mine', validBody, user(HOST_SUB, 'host'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('persists a PENDING request for an authenticated non-host', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    repo.create.mockResolvedValue({ id: REQUEST_ID });
    const out = await service.create('rsna', validBody, user(REQUESTER_SUB));
    expect(out).toEqual({ id: REQUEST_ID });
    expect(repo.create).toHaveBeenCalledWith({
      datasetId: DATASET_ID,
      requesterId: REQUESTER_SUB,
      justification: validBody.justification,
      attestations: validBody.attestations,
    });
  });
});

describe('AccessRequestService.listForDataset', () => {
  it('forbids a participant', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    await expect(
      service.listForDataset('rsna', user(REQUESTER_SUB, 'participant')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the dataset host list', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    repo.listForDataset.mockResolvedValue([]);
    await service.listForDataset('rsna', user(HOST_SUB, 'host'));
    expect(repo.listForDataset).toHaveBeenCalledWith(DATASET_ID);
  });

  it('lets an admin list (regardless of host id)', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    repo.listForDataset.mockResolvedValue([]);
    await service.listForDataset('rsna', user(ADMIN_SUB, 'admin'));
    expect(repo.listForDataset).toHaveBeenCalledWith(DATASET_ID);
  });
});

describe('AccessRequestService.decide', () => {
  function pendingRow() {
    return {
      id: REQUEST_ID,
      datasetId: DATASET_ID,
      requesterId: REQUESTER_SUB,
      decidedById: null,
      decisionNote: null,
      decidedAt: null,
      justification: 'x',
      attestations: { irbApproved: true },
      status: 'PENDING' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      dataset: { id: DATASET_ID, slug: 'rsna', name: 'RSNA', hostId: HOST_SUB },
    };
  }

  it('forbids a stranger', async () => {
    repo.findByIdWithDataset.mockResolvedValue(pendingRow());
    await expect(
      service.decide(
        REQUEST_ID,
        { status: 'APPROVED', decisionNote: null },
        user(REQUESTER_SUB, 'participant'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the host APPROVE a PENDING request', async () => {
    repo.findByIdWithDataset.mockResolvedValue(pendingRow());
    await service.decide(
      REQUEST_ID,
      { status: 'APPROVED', decisionNote: 'OK' },
      user(HOST_SUB, 'host'),
    );
    expect(repo.setDecision).toHaveBeenCalledWith({
      id: REQUEST_ID,
      status: 'APPROVED',
      decidedById: HOST_SUB,
      decisionNote: 'OK',
    });
  });

  it('rejects APPROVE on an already-decided row (state-machine guard)', async () => {
    const row = pendingRow();
    row.status = 'APPROVED' as 'PENDING';
    repo.findByIdWithDataset.mockResolvedValue(row);
    await expect(
      service.decide(
        REQUEST_ID,
        { status: 'APPROVED', decisionNote: null },
        user(HOST_SUB, 'host'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets the host REVOKE only an APPROVED row', async () => {
    const row = pendingRow();
    row.status = 'APPROVED' as 'PENDING';
    repo.findByIdWithDataset.mockResolvedValue(row);
    await service.decide(
      REQUEST_ID,
      { status: 'REVOKED', decisionNote: 'consent withdrawn' },
      user(HOST_SUB, 'host'),
    );
    expect(repo.setDecision).toHaveBeenCalledWith({
      id: REQUEST_ID,
      status: 'REVOKED',
      decidedById: HOST_SUB,
      decisionNote: 'consent withdrawn',
    });
  });

  it('rejects REVOKE on a PENDING row', async () => {
    repo.findByIdWithDataset.mockResolvedValue(pendingRow());
    await expect(
      service.decide(REQUEST_ID, { status: 'REVOKED', decisionNote: null }, user(HOST_SUB, 'host')),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
