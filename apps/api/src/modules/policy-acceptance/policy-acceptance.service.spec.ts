import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { PolicyAcceptanceRepository } from './policy-acceptance.repository.js';
import { PolicyAcceptanceService } from './policy-acceptance.service.js';

const REQUESTER_SUB = '00000000-0000-4000-8000-000000000099';

function user(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

interface RepoMock {
  create: ReturnType<typeof vi.fn>;
  listForUser: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let service: PolicyAcceptanceService;

beforeEach(() => {
  repo = {
    create: vi.fn(),
    listForUser: vi.fn(),
  };
  service = new PolicyAcceptanceService(
    repo as unknown as PolicyAcceptanceRepository,
    {
      issueVisa: vi.fn().mockResolvedValue({}),
      getIssuerUrl: () => 'https://oci.ai4h.net',
      materializeJwt: vi.fn(),
      listIssuedForUser: vi.fn(),
    } as unknown as import('../passport-issuer/passport-issuer.service.js').PassportIssuerService,
  );
  // Strip any KMS env so the signing path stays off in tests.
  delete process.env.OCI_KMS_SIGNING_KEY_ARN;
});

afterEach(() => {
  delete process.env.OCI_KMS_SIGNING_KEY_ARN;
});

describe('PolicyAcceptanceService.record', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      service.record(
        {
          policyUrl: 'https://example.com/policy',
          policyVersion: 'v1',
          policyText: 'Acceptance text.',
        },
        {} as CognitoAccessTokenPayload,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('computes a SHA-256 hash of the policy text and persists it', async () => {
    repo.create.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: REQUESTER_SUB,
      policyUrl: 'https://example.com/policy',
      policyVersion: 'v1',
      policyText: '__not_returned__',
      textSha256: '__set_below__',
      contextType: null,
      contextRef: null,
      receiptSignature: null,
      receiptKeyId: null,
      acceptedAt: new Date('2026-05-08T00:00:00.000Z'),
    });
    const text = 'I agree to the data-use policy.';
    const out = await service.record(
      { policyUrl: 'https://example.com/policy', policyVersion: 'v1', policyText: text },
      user(REQUESTER_SUB),
    );
    expect(repo.create).toHaveBeenCalledTimes(1);
    const persisted = repo.create.mock.calls[0]?.[0] as { textSha256: string };
    // Hash is canonical hex SHA-256 of the policy text.
    expect(persisted.textSha256).toMatch(/^[0-9a-f]{64}$/);
    // Returned receipt carries the same hash, no signature when KMS is off.
    expect(out.signature).toBeNull();
    expect(out.signatureKeyId).toBeNull();
  });

  it('returns a null signature when KMS is not configured (graceful default)', async () => {
    repo.create.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: REQUESTER_SUB,
      policyUrl: 'https://example.com/policy',
      policyVersion: 'v1',
      policyText: '_',
      textSha256: 'x'.repeat(64),
      contextType: null,
      contextRef: null,
      receiptSignature: null,
      receiptKeyId: null,
      acceptedAt: new Date(),
    });
    const out = await service.record(
      {
        policyUrl: 'https://example.com/policy',
        policyVersion: 'v1',
        policyText: 'a',
      },
      user(REQUESTER_SUB),
    );
    expect(out.signature).toBeNull();
  });

  it('persists context fields when provided', async () => {
    repo.create.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: REQUESTER_SUB,
      policyUrl: 'https://example.com/policy',
      policyVersion: 'v1',
      policyText: '_',
      textSha256: 'x'.repeat(64),
      contextType: 'access_request',
      contextRef: 'request-123',
      receiptSignature: null,
      receiptKeyId: null,
      acceptedAt: new Date(),
    });
    await service.record(
      {
        policyUrl: 'https://example.com/policy',
        policyVersion: 'v1',
        policyText: 'a',
        contextType: 'access_request',
        contextRef: 'request-123',
      },
      user(REQUESTER_SUB),
    );
    const arg = repo.create.mock.calls[0]?.[0] as { contextType: string; contextRef: string };
    expect(arg.contextType).toBe('access_request');
    expect(arg.contextRef).toBe('request-123');
  });
});

describe('PolicyAcceptanceService.listOwn', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(service.listOwn({} as CognitoAccessTokenPayload)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns a list of receipts for the caller', async () => {
    repo.listForUser.mockResolvedValue([
      {
        id: 'r1',
        userId: REQUESTER_SUB,
        policyUrl: 'https://example.com/p',
        policyVersion: 'v1',
        policyText: '_',
        textSha256: 'x'.repeat(64),
        contextType: null,
        contextRef: null,
        receiptSignature: null,
        receiptKeyId: null,
        acceptedAt: new Date('2026-05-01T00:00:00.000Z'),
      },
      {
        id: 'r2',
        userId: REQUESTER_SUB,
        policyUrl: 'https://example.com/p2',
        policyVersion: 'v1',
        policyText: '_',
        textSha256: 'y'.repeat(64),
        contextType: 'access_request',
        contextRef: 'req-1',
        receiptSignature: 'aGVsbG8=',
        receiptKeyId: 'arn:aws:kms:eu-central-1:000:key/abc',
        acceptedAt: new Date('2026-05-02T00:00:00.000Z'),
      },
    ]);
    const items = await service.listOwn(user(REQUESTER_SUB));
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe('r1');
    expect(items[1]?.signature).toBe('aGVsbG8=');
    expect(items[1]?.signatureKeyId).toMatch(/arn:aws:kms/);
  });
});
