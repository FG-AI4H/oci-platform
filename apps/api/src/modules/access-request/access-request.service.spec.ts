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

interface CertificationMock {
  listOwnStatus: ReturnType<typeof vi.fn>;
}

interface OrcidMock {
  getMyLink: ReturnType<typeof vi.fn>;
}

interface PassportMock {
  listActiveVisaTypesForUser: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let catalog: CatalogMock;
let certification: CertificationMock;
let orcid: OrcidMock;
let passport: PassportMock;
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
  // Default: no active cert; tests that need one override per-test.
  certification = {
    listOwnStatus: vi.fn().mockResolvedValue({
      certificationType: 'data_ethics_v1',
      active: false,
      passedAt: null,
      expiresAt: null,
      history: [],
    }),
  };
  // Default: no ORCID link; tests that need one override per-test.
  orcid = { getMyLink: vi.fn().mockResolvedValue(null) };
  // Default: no Passport visas; tests that need them override per-test.
  passport = { listActiveVisaTypesForUser: vi.fn().mockResolvedValue([]) };
  service = new AccessRequestService(
    repo as unknown as AccessRequestRepository,
    catalog as unknown as CatalogService,
    certification as unknown as import('../certification/certification.service.js').CertificationService,
    orcid as unknown as import('../orcid-link/orcid-link.service.js').OrcidLinkService,
    passport as unknown as import('../passport/passport.service.js').PassportService,
  );
});

function buildAttestations(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    v: 1 as const,
    projectTitle: 'RSNA pneumonia replication study',
    projectDescription:
      'Replicating an analysis published in 10.1234/example for thesis work, on the RSNA pneumonia detection benchmark, in a non-commercial setting.',
    institution: 'University of Geneva',
    intendedUseCategory: 'NON_COMMERCIAL_RESEARCH' as const,
    intendedUseDuoTerms: ['DUO_0000042'],
    irbApproved: true,
    irbApprovalRef: 'IRB-2026-001',
    dpiaRef: null,
    dataRetentionDays: 365,
    redistributionIntent: 'NONE' as const,
    outputType: 'PUBLICATION' as const,
    ...overrides,
  };
}

const validBody = {
  attestations: buildAttestations(),
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
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      duoTerms: [],
      accessTier: 'OPEN',
      emailDomainAllowlist: [],
    });
    await expect(service.create('mine', validBody, user(HOST_SUB, 'host'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('persists a PENDING request and matches MATCHED on a GRU dataset', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      duoTerms: ['DUO_0000042'],
      accessTier: 'OPEN',
      emailDomainAllowlist: [],
    });
    repo.create.mockResolvedValue({ id: REQUEST_ID });
    const out = await service.create('rsna', validBody, user(REQUESTER_SUB));
    expect(out).toEqual({
      id: REQUEST_ID,
      matchStatus: 'MATCHED',
      requesterIdentityScore: 'EMAIL_ONLY',
      audience: 'RESEARCHER',
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: DATASET_ID,
        requesterId: REQUESTER_SUB,
        attestations: validBody.attestations,
        matchStatus: 'MATCHED',
        requesterIdentityScore: 'EMAIL_ONLY',
      }),
    );
  });

  it('matches CONFLICT when commercial intent meets a NCU dataset', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      // GRU permission + NCU restriction (non-commercial use only)
      duoTerms: ['DUO_0000042', 'DUO_0000046'],
      accessTier: 'OPEN',
      emailDomainAllowlist: [],
    });
    repo.create.mockResolvedValue({ id: REQUEST_ID });
    const body = {
      attestations: buildAttestations({ intendedUseCategory: 'COMMERCIAL_RESEARCH' as const }),
    };
    const out = await service.create('rsna', body, user(REQUESTER_SUB));
    expect(out.matchStatus).toBe('CONFLICT');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ matchStatus: 'CONFLICT' }));
  });

  it('matches CONFLICT when IRB-required dataset receives a non-IRB request', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      // GRU + IRB modifier
      duoTerms: ['DUO_0000042', 'DUO_0000021'],
      accessTier: 'OPEN',
      emailDomainAllowlist: [],
    });
    repo.create.mockResolvedValue({ id: REQUEST_ID });
    const body = {
      attestations: buildAttestations({ irbApproved: false, irbApprovalRef: null }),
    };
    const out = await service.create('rsna', body, user(REQUESTER_SUB));
    expect(out.matchStatus).toBe('CONFLICT');
  });

  it('matches UNCLEAR when a formal-agreement modifier (RTN) is present', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      // GRU + RTN (return derived data) — needs a DUA, J.2 territory.
      duoTerms: ['DUO_0000042', 'DUO_0000029'],
      accessTier: 'OPEN',
      emailDomainAllowlist: [],
    });
    repo.create.mockResolvedValue({ id: REQUEST_ID });
    const out = await service.create('rsna', validBody, user(REQUESTER_SUB));
    expect(out.matchStatus).toBe('UNCLEAR');
  });

  it('matches CONFLICT when dataset accessTier exceeds requester identity score (#115)', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      duoTerms: ['DUO_0000042'],
      accessTier: 'CONTROLLED', // requires QUIZ_PASSED
      emailDomainAllowlist: [],
    });
    repo.create.mockResolvedValue({ id: REQUEST_ID });
    const out = await service.create('rsna', validBody, user(REQUESTER_SUB));
    expect(out.matchStatus).toBe('CONFLICT');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        matchStatus: 'CONFLICT',
        matchExplanations: expect.arrayContaining([
          expect.stringMatching(/CONTROLLED tier.*QUIZ_PASSED.*EMAIL_ONLY/),
        ]),
      }),
    );
  });

  it('lifts requester score to EMAIL_DOMAIN_VERIFIED for an institutional email (#115/#116)', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      duoTerms: ['DUO_0000042'],
      accessTier: 'REGISTERED', // requires EMAIL_DOMAIN_VERIFIED
      emailDomainAllowlist: [],
    });
    repo.create.mockResolvedValue({ id: REQUEST_ID });
    // The local-dev path uses an email-shaped sub; extractRequesterEmail
    // mirrors that into the identity-context input. An institutional
    // email lifts the score so REGISTERED tier matches.
    const out = await service.create('rsna', validBody, user('researcher@stanford.edu'));
    expect(out.matchStatus).toBe('MATCHED');
    expect(out.requesterIdentityScore).toBe('EMAIL_DOMAIN_VERIFIED');
  });

  it('lifts requester score to QUIZ_PASSED when an active certification exists (#117 follow-up)', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      duoTerms: ['DUO_0000042'],
      accessTier: 'CONTROLLED', // requires QUIZ_PASSED
      emailDomainAllowlist: [],
    });
    certification.listOwnStatus.mockResolvedValue({
      certificationType: 'data_ethics_v1',
      active: true,
      passedAt: new Date('2026-04-01').toISOString(),
      expiresAt: new Date('2027-04-01').toISOString(),
      history: [],
    });
    repo.create.mockResolvedValue({ id: REQUEST_ID });
    const out = await service.create('rsna', validBody, user(REQUESTER_SUB));
    expect(out.requesterIdentityScore).toBe('QUIZ_PASSED');
    // CONTROLLED tier requires QUIZ_PASSED — score now meets it, so no tier conflict.
    expect(out.matchStatus).toBe('MATCHED');
  });

  it('lifts requester score to ORCID_LINKED when an ORCID link exists (#125)', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      duoTerms: ['DUO_0000042'],
      accessTier: 'OPEN',
      emailDomainAllowlist: [],
    });
    orcid.getMyLink.mockResolvedValue({
      orcidId: '0000-0001-2345-6789',
      fullName: 'Researcher Person',
      primaryEmail: null,
      affiliation: 'University of Geneva',
      verifiedAt: new Date('2026-04-01').toISOString(),
      publicUrl: 'https://orcid.org/0000-0001-2345-6789',
    });
    repo.create.mockResolvedValue({ id: REQUEST_ID });
    const out = await service.create('rsna', validBody, user(REQUESTER_SUB));
    expect(out.requesterIdentityScore).toBe('ORCID_LINKED');
    expect(out.matchStatus).toBe('MATCHED');
  });

  it('ORCID lookup failure is non-fatal — score stays at the email-derived value', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      duoTerms: ['DUO_0000042'],
      accessTier: 'OPEN',
      emailDomainAllowlist: [],
    });
    orcid.getMyLink.mockRejectedValue(new Error('orcid service unavailable'));
    repo.create.mockResolvedValue({ id: REQUEST_ID });
    const out = await service.create('rsna', validBody, user(REQUESTER_SUB));
    expect(out.requesterIdentityScore).toBe('EMAIL_ONLY');
    expect(out.matchStatus).toBe('MATCHED');
  });

  it('certification lookup failure is non-fatal — score stays at the conservative baseline', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      duoTerms: ['DUO_0000042'],
      accessTier: 'OPEN',
      emailDomainAllowlist: [],
    });
    certification.listOwnStatus.mockRejectedValue(new Error('cert service unavailable'));
    repo.create.mockResolvedValue({ id: REQUEST_ID });
    const out = await service.create('rsna', validBody, user(REQUESTER_SUB));
    // Cert failure swallowed; row still persists; score reflects the email signal alone.
    expect(out.requesterIdentityScore).toBe('EMAIL_ONLY');
    expect(out.matchStatus).toBe('MATCHED'); // OPEN tier doesn't require more than EMAIL_ONLY
  });
});

describe('AccessRequestService.listForDataset', () => {
  it('forbids a participant', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      duoTerms: [],
      accessTier: 'OPEN',
      emailDomainAllowlist: [],
    });
    await expect(
      service.listForDataset('rsna', user(REQUESTER_SUB, 'participant')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the dataset host list', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      duoTerms: [],
      accessTier: 'OPEN',
      emailDomainAllowlist: [],
    });
    repo.listForDataset.mockResolvedValue([]);
    await service.listForDataset('rsna', user(HOST_SUB, 'host'));
    expect(repo.listForDataset).toHaveBeenCalledWith(DATASET_ID);
  });

  it('lets an admin list (regardless of host id)', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({
      id: DATASET_ID,
      hostId: HOST_SUB,
      duoTerms: [],
      accessTier: 'OPEN',
      emailDomainAllowlist: [],
    });
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
      dataset: { id: DATASET_ID, slug: 'rsna', name: 'RSNA', hostId: HOST_SUB, duoTerms: [] },
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
