import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { OrcidLinkRepository, type OrcidLinkRow } from './orcid-link.repository.js';
import { OrcidLinkService } from './orcid-link.service.js';

const REQUESTER_SUB = '00000000-0000-4000-8000-000000000099';

function user(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

interface RepoMock {
  findForUser: ReturnType<typeof vi.fn>;
  findByOrcidId: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let service: OrcidLinkService;

beforeEach(() => {
  repo = {
    findForUser: vi.fn(),
    findByOrcidId: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  };
  // Default — no ORCID env. Tests that need the configured client
  // re-instantiate inside the test.
  delete process.env.OCI_ORCID_CLIENT_ID;
  delete process.env.OCI_ORCID_CLIENT_SECRET;
  delete process.env.OCI_ORCID_REDIRECT_URI;
  delete process.env.OCI_ORCID_BASE_URL;
  delete process.env.OCI_ORCID_STATE_SECRET;
  service = new OrcidLinkService(repo as unknown as OrcidLinkRepository);
});

afterEach(() => {
  delete process.env.OCI_ORCID_CLIENT_ID;
  delete process.env.OCI_ORCID_CLIENT_SECRET;
  delete process.env.OCI_ORCID_REDIRECT_URI;
});

describe('OrcidLinkService — env not configured', () => {
  it('startAuthorize returns 503 when ORCID env is not set', async () => {
    await expect(service.startAuthorize(user(REQUESTER_SUB))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('completeCallback returns 503 when ORCID env is not set', async () => {
    await expect(
      service.completeCallback({ code: 'c', state: 's' }, user(REQUESTER_SUB)),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('getMyLink works without env (read-only path)', async () => {
    repo.findForUser.mockResolvedValue(null);
    expect(await service.getMyLink(user(REQUESTER_SUB))).toBeNull();
  });
});

describe('OrcidLinkService — auth', () => {
  it('rejects unauthenticated callers on every endpoint', async () => {
    await expect(service.startAuthorize({} as CognitoAccessTokenPayload)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.completeCallback({ code: 'c', state: 's' }, {} as CognitoAccessTokenPayload),
    ).rejects.toBeInstanceOf(ForbiddenException); // auth check happens before env check
    await expect(service.getMyLink({} as CognitoAccessTokenPayload)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.unlink({} as CognitoAccessTokenPayload)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('OrcidLinkService — startAuthorize (configured)', () => {
  it('emits an authorize URL with the configured client_id and a CSRF state', async () => {
    process.env.OCI_ORCID_CLIENT_ID = 'APP-FAKECLIENT';
    process.env.OCI_ORCID_CLIENT_SECRET = 'fake-secret';
    process.env.OCI_ORCID_REDIRECT_URI = 'https://oci.example/orcid/callback';
    process.env.OCI_ORCID_STATE_SECRET = 'test-secret';
    const fresh = new OrcidLinkService(repo as unknown as OrcidLinkRepository);
    const out = await fresh.startAuthorize(user(REQUESTER_SUB));
    expect(out.authorizeUrl).toMatch(/orcid\.org\/oauth\/authorize/);
    expect(out.authorizeUrl).toContain('client_id=APP-FAKECLIENT');
    expect(out.authorizeUrl).toContain('scope=%2Fauthenticate');
    expect(out.authorizeUrl).toContain(`state=${out.state}`);
    // State has the signed shape `<base64url-payload>.<32-hex-sig>`.
    expect(out.state).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{32}$/);
  });
});

describe('OrcidLinkService — completeCallback (configured, mocked HTTP)', () => {
  beforeEach(() => {
    process.env.OCI_ORCID_CLIENT_ID = 'APP-FAKECLIENT';
    process.env.OCI_ORCID_CLIENT_SECRET = 'fake-secret';
    process.env.OCI_ORCID_REDIRECT_URI = 'https://oci.example/orcid/callback';
    process.env.OCI_ORCID_STATE_SECRET = 'test-secret';
    service = new OrcidLinkService(repo as unknown as OrcidLinkRepository);
  });

  function mockOrcidHttp(args: {
    tokenStatus: number;
    tokenBody: object;
    personStatus?: number;
    personBody?: object;
    employmentStatus?: number;
    employmentBody?: object;
  }): void {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (url.includes('/oauth/token')) {
        return new Response(JSON.stringify(args.tokenBody), {
          status: args.tokenStatus,
        }) as Response;
      }
      if (url.includes('/person')) {
        return new Response(JSON.stringify(args.personBody ?? {}), {
          status: args.personStatus ?? 200,
        }) as Response;
      }
      if (url.includes('/employments')) {
        return new Response(JSON.stringify(args.employmentBody ?? {}), {
          status: args.employmentStatus ?? 200,
        }) as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it('rejects a tampered state with 400', async () => {
    await expect(
      service.completeCallback(
        { code: 'authcode', state: 'invalid-state.deadbeef' },
        user(REQUESTER_SUB),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('happy path: code → token → person → upsert, returns the link summary', async () => {
    // Generate a valid state by going through startAuthorize first.
    const auth = await service.startAuthorize(user(REQUESTER_SUB));
    mockOrcidHttp({
      tokenStatus: 200,
      tokenBody: {
        access_token: 'token-xyz',
        orcid: '0000-0001-2345-6789',
        name: 'Test Researcher',
        scope: '/authenticate',
      },
      personBody: { emails: { email: [{ email: 'r@example.org', verified: true }] } },
      employmentBody: {
        'affiliation-group': [
          {
            summaries: [
              { 'employment-summary': { organization: { name: 'University of Geneva' } } },
            ],
          },
        ],
      },
    });
    repo.findByOrcidId.mockResolvedValue(null);
    repo.upsert.mockResolvedValue({
      userId: REQUESTER_SUB,
      orcidId: '0000-0001-2345-6789',
      fullName: 'Test Researcher',
      primaryEmail: 'r@example.org',
      affiliation: 'University of Geneva',
      verifiedAt: new Date('2026-05-09T16:00:00.000Z'),
    } satisfies OrcidLinkRow);

    const out = await service.completeCallback(
      { code: 'authcode', state: auth.state },
      user(REQUESTER_SUB),
    );
    expect(out.orcidId).toBe('0000-0001-2345-6789');
    expect(out.fullName).toBe('Test Researcher');
    expect(out.affiliation).toBe('University of Geneva');
    expect(out.publicUrl).toBe('https://orcid.org/0000-0001-2345-6789');
  });

  it('rejects a cross-user collision with 409', async () => {
    const auth = await service.startAuthorize(user(REQUESTER_SUB));
    mockOrcidHttp({
      tokenStatus: 200,
      tokenBody: {
        access_token: 'token-xyz',
        orcid: '0000-0001-2345-6789',
        name: 'Other Person',
        scope: '/authenticate',
      },
    });
    // Different user already claimed this orcidId.
    repo.findByOrcidId.mockResolvedValue({
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      orcidId: '0000-0001-2345-6789',
      fullName: null,
      primaryEmail: null,
      affiliation: null,
      verifiedAt: new Date(),
    } satisfies OrcidLinkRow);

    await expect(
      service.completeCallback({ code: 'authcode', state: auth.state }, user(REQUESTER_SUB)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});

describe('OrcidLinkService.hasActiveOrcidLink', () => {
  it('returns true when the user has a link', async () => {
    repo.findForUser.mockResolvedValue({
      userId: REQUESTER_SUB,
      orcidId: '0000-0001-2345-6789',
      fullName: null,
      primaryEmail: null,
      affiliation: null,
      verifiedAt: new Date(),
    });
    expect(await service.hasActiveOrcidLink(user(REQUESTER_SUB))).toBe(true);
  });

  it('returns false when the user has no link', async () => {
    repo.findForUser.mockResolvedValue(null);
    expect(await service.hasActiveOrcidLink(user(REQUESTER_SUB))).toBe(false);
  });

  it('returns false on a missing sub (defensive)', async () => {
    expect(await service.hasActiveOrcidLink({} as CognitoAccessTokenPayload)).toBe(false);
  });
});
