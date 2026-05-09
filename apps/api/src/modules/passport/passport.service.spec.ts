import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import {
  PassportRepository,
  type PassportVisaRow,
  type TrustedIssuerRow,
} from './passport.repository.js';
import { PassportService } from './passport.service.js';
import type { PassportVerifier, VerifiedVisa } from './passport-verifier.js';

const REQUESTER_SUB = '00000000-0000-4000-8000-000000000099';
const ISSUER = 'https://login.elixir-czech.org/oidc/';
const VALID_JWT = 'header.eyJpc3MiOiJodHRwczovL2xvZ2luLmVsaXhpci1jemVjaC5vcmcvb2lkYy8ifQ.sig';
const MALFORMED_JWT = 'not-a-jwt';

function user(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

function trustedIssuerRow(overrides: Partial<TrustedIssuerRow> = {}): TrustedIssuerRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    issuer: ISSUER,
    displayName: 'ELIXIR AAI',
    jwksUri: null,
    revokedAt: null,
    ...overrides,
  };
}

function visaRow(overrides: Partial<PassportVisaRow> = {}): PassportVisaRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    userId: REQUESTER_SUB,
    issuer: ISSUER,
    visaType: 'ResearcherStatus',
    jti: 'visa-1',
    payload: {
      type: 'ResearcherStatus',
      asserted: 1700000000,
      value: 'https://doi.org/example',
      source: 'https://elixir-europe.org',
    },
    assertedAt: new Date('2025-01-01T00:00:00Z'),
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    verifiedAt: new Date('2026-05-09T00:00:00Z'),
    revokedAt: null,
    ...overrides,
  };
}

interface RepoMock {
  findActiveIssuer: ReturnType<typeof vi.fn>;
  listIssuers: ReturnType<typeof vi.fn>;
  upsertVisa: ReturnType<typeof vi.fn>;
  listActiveVisasForUser: ReturnType<typeof vi.fn>;
  findVisaForUser: ReturnType<typeof vi.fn>;
  revokeVisa: ReturnType<typeof vi.fn>;
}

interface VerifierMock {
  verify: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let verifier: VerifierMock;
let service: PassportService;

beforeEach(() => {
  repo = {
    findActiveIssuer: vi.fn(),
    listIssuers: vi.fn().mockResolvedValue([]),
    upsertVisa: vi.fn(),
    listActiveVisasForUser: vi.fn().mockResolvedValue([]),
    findVisaForUser: vi.fn(),
    revokeVisa: vi.fn(),
  };
  verifier = { verify: vi.fn() };
  service = new PassportService(
    repo as unknown as PassportRepository,
    verifier as unknown as PassportVerifier,
  );
});

describe('PassportService.ingestVisa', () => {
  it('throws ForbiddenException when no caller is present', async () => {
    await expect(service.ingestVisa({ jwt: VALID_JWT }, undefined as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws BadRequestException for a malformed JWT', async () => {
    await expect(service.ingestVisa({ jwt: MALFORMED_JWT }, user(REQUESTER_SUB))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when the issuer is not trusted', async () => {
    repo.findActiveIssuer.mockResolvedValue(null);
    await expect(service.ingestVisa({ jwt: VALID_JWT }, user(REQUESTER_SUB))).rejects.toThrow(
      /not in the trust list/i,
    );
  });

  it('throws BadRequestException when verification fails', async () => {
    repo.findActiveIssuer.mockResolvedValue(trustedIssuerRow());
    verifier.verify.mockResolvedValue(null);
    await expect(service.ingestVisa({ jwt: VALID_JWT }, user(REQUESTER_SUB))).rejects.toThrow(
      /did not verify/i,
    );
  });

  it('persists and returns the visa summary on successful verification', async () => {
    repo.findActiveIssuer.mockResolvedValue(trustedIssuerRow());
    const verified: VerifiedVisa = {
      iss: ISSUER,
      jti: 'visa-1',
      visaType: 'ResearcherStatus',
      visa: {
        type: 'ResearcherStatus',
        asserted: 1700000000,
        value: 'https://doi.org/example',
        source: 'https://elixir-europe.org',
      },
      assertedAt: new Date('2025-01-01T00:00:00Z'),
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    };
    verifier.verify.mockResolvedValue(verified);
    repo.upsertVisa.mockResolvedValue(visaRow());

    const summary = await service.ingestVisa({ jwt: VALID_JWT }, user(REQUESTER_SUB));
    expect(summary.visaType).toBe('ResearcherStatus');
    expect(summary.issuer).toBe(ISSUER);
    expect(summary.issuerDisplayName).toBe('ELIXIR AAI');
    expect(summary.value).toBe('https://doi.org/example');
    expect(repo.upsertVisa).toHaveBeenCalledWith(
      expect.objectContaining({ jti: 'visa-1', visaType: 'ResearcherStatus' }),
    );
  });

  it('uses jwksUri override from the trusted-issuer row when provided', async () => {
    repo.findActiveIssuer.mockResolvedValue(
      trustedIssuerRow({ jwksUri: 'https://override.example/jwks' }),
    );
    verifier.verify.mockResolvedValue(null);
    await expect(service.ingestVisa({ jwt: VALID_JWT }, user(REQUESTER_SUB))).rejects.toThrow();
    expect(verifier.verify).toHaveBeenCalledWith(
      VALID_JWT,
      expect.objectContaining({ jwksUri: 'https://override.example/jwks' }),
    );
  });

  it('falls back to <issuer>/.well-known/jwks.json when no override is set', async () => {
    repo.findActiveIssuer.mockResolvedValue(trustedIssuerRow());
    verifier.verify.mockResolvedValue(null);
    await expect(service.ingestVisa({ jwt: VALID_JWT }, user(REQUESTER_SUB))).rejects.toThrow();
    expect(verifier.verify).toHaveBeenCalledWith(
      VALID_JWT,
      expect.objectContaining({
        jwksUri: 'https://login.elixir-czech.org/oidc/.well-known/jwks.json',
      }),
    );
  });
});

describe('PassportService.listMyVisas', () => {
  it('returns visa summaries with the issuer display name', async () => {
    repo.listActiveVisasForUser.mockResolvedValue([visaRow()]);
    repo.listIssuers.mockResolvedValue([trustedIssuerRow()]);
    const result = await service.listMyVisas(user(REQUESTER_SUB));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.issuerDisplayName).toBe('ELIXIR AAI');
  });

  it('falls back to the issuer URL when no display name is registered', async () => {
    repo.listActiveVisasForUser.mockResolvedValue([visaRow()]);
    repo.listIssuers.mockResolvedValue([]);
    const result = await service.listMyVisas(user(REQUESTER_SUB));
    expect(result.items[0]?.issuerDisplayName).toBe(ISSUER);
  });
});

describe('PassportService.revokeMyVisa', () => {
  it('throws NotFoundException when the visa does not belong to the caller', async () => {
    repo.findVisaForUser.mockResolvedValue(null);
    await expect(service.revokeMyVisa(user(REQUESTER_SUB), 'x')).rejects.toThrow(NotFoundException);
  });

  it('soft-deletes when the visa exists', async () => {
    repo.findVisaForUser.mockResolvedValue(visaRow());
    await service.revokeMyVisa(user(REQUESTER_SUB), '22222222-2222-4222-8222-222222222222');
    expect(repo.revokeVisa).toHaveBeenCalled();
  });
});

describe('PassportService.listActiveVisaTypesForUser', () => {
  it('returns the visa types from the active rows', async () => {
    repo.listActiveVisasForUser.mockResolvedValue([
      visaRow({ visaType: 'ResearcherStatus' }),
      visaRow({ visaType: 'AffiliationAndRole', id: '33333333-3333-4333-8333-333333333333' }),
    ]);
    const types = await service.listActiveVisaTypesForUser(user(REQUESTER_SUB));
    expect(types).toEqual(['ResearcherStatus', 'AffiliationAndRole']);
  });

  it('returns empty when no caller is present', async () => {
    const types = await service.listActiveVisaTypesForUser(undefined as never);
    expect(types).toEqual([]);
  });
});
