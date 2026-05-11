import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type { AccessRequestRepository } from '../access-request/access-request.repository.js';
import type { DuaTemplateService } from '../dua-template/dua-template.service.js';
import type { PassportIssuerService } from '../passport-issuer/passport-issuer.service.js';
import { DuaSigningRepository, type DuaSignatureRow } from './dua-signing.repository.js';
import { DuaSigningService } from './dua-signing.service.js';

const REQUESTER_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUESTER_SUB = REQUESTER_UUID;
const HOST_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SIG_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function user(sub: string, groups: string[] = []): CognitoAccessTokenPayload {
  return { sub, 'cognito:groups': groups } as unknown as CognitoAccessTokenPayload;
}

interface RepoMock {
  create: ReturnType<typeof vi.fn>;
  findPendingForAccessRequest: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  findBySubmissionId: ReturnType<typeof vi.fn>;
  findForUser: ReturnType<typeof vi.fn>;
  listForUser: ReturnType<typeof vi.fn>;
  markSigned: ReturnType<typeof vi.fn>;
  markDeclined: ReturnType<typeof vi.fn>;
  markExpired: ReturnType<typeof vi.fn>;
}

interface ArRepoMock {
  findByIdWithDataset: ReturnType<typeof vi.fn>;
}

interface TemplateMock {
  preview: ReturnType<typeof vi.fn>;
}

interface PassportMock {
  issueVisa: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let arRepo: ArRepoMock;
let template: TemplateMock;
let passport: PassportMock;
let service: DuaSigningService;
const SAVED_ENV = { ...process.env };

beforeEach(() => {
  process.env.OCI_DOCUSEAL_BASE_URL = 'https://docuseal.example';
  process.env.OCI_DOCUSEAL_API_TOKEN = 'tok';
  process.env.OCI_DOCUSEAL_WEBHOOK_SECRET = 'secret';
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify([{ id: 42, submitters: [{ slug: 'sub-42' }] }]), {
          status: 201,
        }),
    ),
  );
  repo = {
    create: vi.fn(),
    findPendingForAccessRequest: vi.fn().mockResolvedValue(null),
    findById: vi.fn(),
    findBySubmissionId: vi.fn(),
    findForUser: vi.fn(),
    listForUser: vi.fn().mockResolvedValue([]),
    markSigned: vi.fn(),
    markDeclined: vi.fn(),
    markExpired: vi.fn(),
  };
  arRepo = {
    findByIdWithDataset: vi.fn(),
  };
  template = {
    preview: vi.fn().mockResolvedValue({
      templateId: 'dua-researcher',
      lmicAddendumIncluded: false,
      markdown: '# DUA body',
    }),
  };
  passport = { issueVisa: vi.fn().mockResolvedValue({}) };
  service = new DuaSigningService(
    repo as unknown as DuaSigningRepository,
    arRepo as unknown as AccessRequestRepository,
    template as unknown as DuaTemplateService,
    passport as unknown as PassportIssuerService,
  );
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
  vi.restoreAllMocks();
});

function approvedAr(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: AR_ID,
    datasetId: 'ds-id',
    requesterId: REQUESTER_UUID,
    decidedById: HOST_UUID,
    decisionNote: null,
    decidedAt: new Date(),
    justification: 'Research justification.',
    attestations: { projectDescription: 'Replicate study X.', institution: 'University Y' },
    status: 'APPROVED',
    createdAt: new Date(),
    updatedAt: new Date(),
    dataset: { id: 'ds-id', slug: 'rsna-pneumonia', name: 'RSNA', hostId: HOST_UUID },
    ...overrides,
  };
}

function pendingRow(overrides: Partial<DuaSignatureRow> = {}): DuaSignatureRow {
  return {
    id: SIG_ID,
    userId: REQUESTER_UUID,
    accessRequestId: AR_ID,
    status: 'PENDING',
    docusealSubmissionId: '42',
    signerUrl: 'https://docuseal.example/s/sub-42',
    documentText: '# DUA body',
    documentSha256: 'a'.repeat(64),
    signedPdfUrl: null,
    createdAt: new Date(),
    signedAt: null,
    declinedAt: null,
    ...overrides,
  };
}

describe('DuaSigningService.createSigningRequest', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      service.createSigningRequest(
        { accessRequestId: AR_ID, audience: 'RESEARCHER', signerEmail: 'a@b.edu', signerName: 'A' },
        {} as CognitoAccessTokenPayload,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("returns 503 when DocuSeal isn't configured", async () => {
    delete process.env.OCI_DOCUSEAL_BASE_URL;
    const localService = new DuaSigningService(
      repo as unknown as DuaSigningRepository,
      arRepo as unknown as AccessRequestRepository,
      template as unknown as DuaTemplateService,
      passport as unknown as PassportIssuerService,
    );
    await expect(
      localService.createSigningRequest(
        { accessRequestId: AR_ID, audience: 'RESEARCHER', signerEmail: 'a@b.edu', signerName: 'A' },
        user(REQUESTER_SUB),
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('404s when the access request does not exist', async () => {
    arRepo.findByIdWithDataset.mockResolvedValue(null);
    await expect(
      service.createSigningRequest(
        { accessRequestId: AR_ID, audience: 'RESEARCHER', signerEmail: 'a@b.edu', signerName: 'A' },
        user(REQUESTER_SUB),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('forbids callers who are neither requester, host, nor admin', async () => {
    arRepo.findByIdWithDataset.mockResolvedValue(approvedAr());
    await expect(
      service.createSigningRequest(
        { accessRequestId: AR_ID, audience: 'RESEARCHER', signerEmail: 'a@b.edu', signerName: 'A' },
        user('00000000-0000-4000-8000-000000000099'), // unrelated user
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects an AR that is not APPROVED', async () => {
    arRepo.findByIdWithDataset.mockResolvedValue(approvedAr({ status: 'PENDING' }));
    await expect(
      service.createSigningRequest(
        { accessRequestId: AR_ID, audience: 'RESEARCHER', signerEmail: 'a@b.edu', signerName: 'A' },
        user(REQUESTER_SUB),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a signing request and persists the SHA-256 hash', async () => {
    arRepo.findByIdWithDataset.mockResolvedValue(approvedAr());
    repo.create.mockResolvedValue(pendingRow());
    const result = await service.createSigningRequest(
      {
        accessRequestId: AR_ID,
        audience: 'RESEARCHER',
        signerEmail: 'a@b.edu',
        signerName: 'Alice',
      },
      user(REQUESTER_SUB),
    );
    expect(result.signature.status).toBe('PENDING');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: REQUESTER_UUID,
        accessRequestId: AR_ID,
        documentText: '# DUA body',
        docusealSubmissionId: '42',
      }),
    );
    const createCall = repo.create.mock.calls[0]?.[0] as { documentSha256: string };
    expect(createCall.documentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent — returns the existing PENDING row if one is already in flight', async () => {
    arRepo.findByIdWithDataset.mockResolvedValue(approvedAr());
    repo.findPendingForAccessRequest.mockResolvedValue(pendingRow());
    const result = await service.createSigningRequest(
      { accessRequestId: AR_ID, audience: 'RESEARCHER', signerEmail: 'a@b.edu', signerName: 'A' },
      user(REQUESTER_SUB),
    );
    expect(result.signature.id).toBe(SIG_ID);
    expect(repo.create).not.toHaveBeenCalled();
    expect(template.preview).not.toHaveBeenCalled();
  });

  it('allows the host of the dataset to create the signing request', async () => {
    arRepo.findByIdWithDataset.mockResolvedValue(approvedAr());
    repo.create.mockResolvedValue(pendingRow());
    await expect(
      service.createSigningRequest(
        {
          accessRequestId: AR_ID,
          audience: 'RESEARCHER',
          signerEmail: 'host@x.edu',
          signerName: 'Host',
        },
        user(HOST_UUID),
      ),
    ).resolves.toBeDefined();
  });
});

describe('DuaSigningService.handleWebhook', () => {
  it('marks SIGNED + mints AcceptedTermsAndPolicies on form.completed', async () => {
    repo.findBySubmissionId.mockResolvedValue(pendingRow());
    repo.markSigned.mockResolvedValue(
      pendingRow({
        status: 'SIGNED',
        signedAt: new Date(),
        signedPdfUrl: 'https://docuseal.example/pdf/42',
      }),
    );
    const result = await service.handleWebhook({
      event_type: 'form.completed',
      data: { id: 42, documents: [{ url: 'https://docuseal.example/pdf/42' }] },
    });
    expect(result.acknowledged).toBe(true);
    expect(repo.markSigned).toHaveBeenCalledWith(SIG_ID, 'https://docuseal.example/pdf/42');
    expect(passport.issueVisa).toHaveBeenCalledWith(
      expect.objectContaining({
        visaType: 'AcceptedTermsAndPolicies',
        contextType: 'dua_signature',
      }),
    );
  });

  it('marks DECLINED on form.declined, no visa minted', async () => {
    repo.findBySubmissionId.mockResolvedValue(pendingRow());
    await service.handleWebhook({ event_type: 'form.declined', data: { id: 42 } });
    expect(repo.markDeclined).toHaveBeenCalled();
    expect(passport.issueVisa).not.toHaveBeenCalled();
  });

  it('marks EXPIRED on form.expired', async () => {
    repo.findBySubmissionId.mockResolvedValue(pendingRow());
    await service.handleWebhook({ event_type: 'form.expired', data: { id: 42 } });
    expect(repo.markExpired).toHaveBeenCalled();
  });

  it('acknowledges + ignores an event for an unknown submission id', async () => {
    repo.findBySubmissionId.mockResolvedValue(null);
    const result = await service.handleWebhook({
      event_type: 'form.completed',
      data: { id: 9999 },
    });
    expect(result.acknowledged).toBe(true);
    expect(repo.markSigned).not.toHaveBeenCalled();
  });

  it('acknowledges + ignores a duplicate event for an already-signed row', async () => {
    repo.findBySubmissionId.mockResolvedValue(
      pendingRow({ status: 'SIGNED', signedAt: new Date() }),
    );
    await service.handleWebhook({ event_type: 'form.completed', data: { id: 42 } });
    expect(repo.markSigned).not.toHaveBeenCalled();
  });

  it("swallows visa-mint failures (logged but webhook still ack'd)", async () => {
    repo.findBySubmissionId.mockResolvedValue(pendingRow());
    repo.markSigned.mockResolvedValue(pendingRow({ status: 'SIGNED' }));
    passport.issueVisa.mockRejectedValue(new Error('signing key unavailable'));
    const result = await service.handleWebhook({
      event_type: 'form.completed',
      data: { id: 42 },
    });
    expect(result.acknowledged).toBe(true);
  });
});

describe('DuaSigningService.listMine + getMine', () => {
  it("listMine returns the caller's rows", async () => {
    repo.listForUser.mockResolvedValue([pendingRow()]);
    const result = await service.listMine(user(REQUESTER_SUB));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.accessRequestId).toBe(AR_ID);
  });

  it('getMine 404s when the row belongs to someone else', async () => {
    repo.findForUser.mockResolvedValue(null);
    await expect(service.getMine(user(REQUESTER_SUB), SIG_ID)).rejects.toThrow(NotFoundException);
  });
});
