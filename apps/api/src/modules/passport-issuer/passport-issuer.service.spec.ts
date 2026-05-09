import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { createLocalJWKSet, exportJWK, jwtVerify } from 'jose';
import { PassportIssuerRepository, type IssuedVisaRow } from './passport-issuer.repository.js';
import { PassportIssuerService } from './passport-issuer.service.js';
import type { PassportKeyService, SigningKeyMaterial } from './passport-key.service.js';

const REQUESTER_SUB = '00000000-0000-4000-8000-000000000099';

function user(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

interface KeyServiceMock {
  ensureActiveKey: ReturnType<typeof vi.fn>;
  findKey: ReturnType<typeof vi.fn>;
  listPublishedKeys: ReturnType<typeof vi.fn>;
}

interface RepoMock {
  upsertVisa: ReturnType<typeof vi.fn>;
  findVisaForUser: ReturnType<typeof vi.fn>;
  listForUser: ReturnType<typeof vi.fn>;
  updateKid: ReturnType<typeof vi.fn>;
}

let keyService: KeyServiceMock;
let repo: RepoMock;
let service: PassportIssuerService;
let testKey: SigningKeyMaterial;

beforeEach(async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const jwk = await exportJWK(publicKey);
  testKey = {
    kid: 'test-kid',
    alg: 'RS256',
    kmsKeyArn: null,
    privateKeyPem,
    publicJwk: { ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' } as never,
  };
  keyService = {
    ensureActiveKey: vi.fn().mockResolvedValue(testKey),
    findKey: vi.fn().mockResolvedValue(testKey),
    listPublishedKeys: vi.fn().mockResolvedValue([testKey.publicJwk]),
  };
  repo = {
    upsertVisa: vi.fn(),
    findVisaForUser: vi.fn(),
    listForUser: vi.fn(),
    updateKid: vi.fn(),
  };
  service = new PassportIssuerService(
    keyService as unknown as PassportKeyService,
    repo as unknown as PassportIssuerRepository,
  );
});

function row(overrides: Partial<IssuedVisaRow> = {}): IssuedVisaRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: REQUESTER_SUB,
    visaType: 'ResearcherStatus',
    value: 'data_ethics_v1',
    source: 'https://oci.ai4h.net',
    jti: 'oci-test',
    kid: 'test-kid',
    assertedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    revokedAt: null,
    contextType: 'certification',
    contextRef: 'data_ethics_v1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('PassportIssuerService.issueVisa', () => {
  it('persists the visa with a stable jti derived from (userId, type, contextRef)', async () => {
    repo.upsertVisa.mockResolvedValue(row());
    const summary = await service.issueVisa({
      userId: REQUESTER_SUB,
      visaType: 'ResearcherStatus',
      value: 'data_ethics_v1',
      validForDays: 365,
      contextRef: 'data_ethics_v1',
    });
    expect(summary.visaType).toBe('ResearcherStatus');
    expect(summary.value).toBe('data_ethics_v1');
    expect(repo.upsertVisa).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: REQUESTER_SUB,
        visaType: 'ResearcherStatus',
        kid: 'test-kid',
      }),
    );
    // jti is deterministic — re-call would converge to the same.
    const firstJti = (repo.upsertVisa.mock.calls[0]?.[0] as { jti: string }).jti;
    expect(firstJti).toMatch(/^oci-/);
  });

  it('uses the configured issuer URL as the source when none is given', async () => {
    process.env.OCI_PASSPORT_ISSUER_URL = 'https://test.oci.ai4h.net';
    const local = new PassportIssuerService(
      keyService as unknown as PassportKeyService,
      repo as unknown as PassportIssuerRepository,
    );
    repo.upsertVisa.mockResolvedValue(row({ source: 'https://test.oci.ai4h.net' }));
    await local.issueVisa({
      userId: REQUESTER_SUB,
      visaType: 'ResearcherStatus',
      value: 'data_ethics_v1',
      validForDays: 365,
    });
    expect(repo.upsertVisa).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'https://test.oci.ai4h.net' }),
    );
    delete process.env.OCI_PASSPORT_ISSUER_URL;
  });
});

describe('PassportIssuerService.materializeJwt', () => {
  it('returns a JWT verifiable against the JWKS', async () => {
    const persistedRow = row();
    repo.findVisaForUser.mockResolvedValue(persistedRow);

    const result = await service.materializeJwt(user(REQUESTER_SUB), persistedRow.id);
    expect(result.jwt.split('.').length).toBe(3);

    // Verify the JWT against the test key's public JWK.
    const jwks = createLocalJWKSet({ keys: [testKey.publicJwk as never] });
    const verified = await jwtVerify(result.jwt, jwks, {
      issuer: 'https://oci.ai4h.net',
    });
    expect(verified.payload.jti).toBe('oci-test');
    expect((verified.payload as { ga4gh_visa_v1?: { type: string } }).ga4gh_visa_v1?.type).toBe(
      'ResearcherStatus',
    );
  });

  it('throws NotFoundException when the visa does not belong to the caller', async () => {
    repo.findVisaForUser.mockResolvedValue(null);
    await expect(service.materializeJwt(user(REQUESTER_SUB), 'x')).rejects.toThrow(/not found/);
  });

  it('rejects revoked or expired visas as not-found', async () => {
    repo.findVisaForUser.mockResolvedValue(row({ revokedAt: new Date('2026-04-01T00:00:00Z') }));
    await expect(service.materializeJwt(user(REQUESTER_SUB), 'x')).rejects.toThrow(/not found/);
  });

  it("falls back to the active key when the row's kid was archived", async () => {
    repo.findVisaForUser.mockResolvedValue(row({ kid: 'old-kid' }));
    keyService.findKey.mockResolvedValue(null);
    await service.materializeJwt(user(REQUESTER_SUB), 'x');
    expect(repo.updateKid).toHaveBeenCalled();
  });
});

describe('PassportIssuerService.listIssuedForUser', () => {
  it('returns summaries with active=true for non-expired non-revoked rows', async () => {
    repo.listForUser.mockResolvedValue([
      row({ id: 'a', expiresAt: new Date(Date.now() + 86_400_000) }),
      row({
        id: 'b',
        expiresAt: new Date(Date.now() - 86_400_000),
      }),
      row({ id: 'c', revokedAt: new Date() }),
    ]);
    const result = await service.listIssuedForUser(user(REQUESTER_SUB));
    expect(result.items).toHaveLength(3);
    expect(result.items[0]?.active).toBe(true);
    expect(result.items[1]?.active).toBe(false);
    expect(result.items[2]?.active).toBe(false);
  });

  it('returns empty when no caller is present', async () => {
    const result = await service.listIssuedForUser(undefined as never);
    expect(result.items).toEqual([]);
  });
});
