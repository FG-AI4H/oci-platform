import { type ExecutionContext, UnauthorizedException, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { AUDIT_EMITTER } from '../audit/audit.module.js';
import { RouteRegistryController } from './route-registry.controller.js';
import { RouteRegistryRepository } from './route-registry.repository.js';
import { RouteRegistryService } from './route-registry.service.js';

/**
 * Who may record a review outcome on a route version. Real controller, guards
 * and service over the HTTP layer; only Cognito verification and the
 * repository are stubbed. `x-test-user` / `x-test-groups` stand in for a
 * verified token.
 */
const stubJwt = {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: unknown;
    }>();
    const sub = req.headers['x-test-user'];
    if (!sub) throw new UnauthorizedException();
    req.user = { sub, 'cognito:groups': (req.headers['x-test-groups'] ?? '').split(',') };
    return true;
  },
};

const NOW = new Date('2026-10-26T00:00:00.000Z');

function versionRow(over: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    routeId: '11111111-1111-4111-8111-111111111111',
    version: '1.0.0',
    threatModel: {},
    disclosureProfile: {},
    operationalEnvelope: {},
    reviewStatus: 'UNDER_REVIEW',
    reviewedAt: null,
    reviewNotes: null,
    declaredByUserId: cognitoSubAsUuid('declarer'),
    createdAt: NOW,
    ...over,
  };
}

const repo = {
  findRouteBySlug: vi.fn(),
  findVersion: vi.fn(),
  setReviewStatus: vi.fn(),
};
const audit = { emitSync: vi.fn() };

describe('POST /v2/evaluation/routes/:slug/versions/:version/review', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [RouteRegistryController],
      providers: [
        RouteRegistryService,
        RolesGuard,
        { provide: RouteRegistryRepository, useValue: repo },
        { provide: AUDIT_EMITTER, useValue: audit },
      ],
    })
      .overrideGuard(CognitoJwtGuard)
      .useValue(stubJwt)
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    repo.findRouteBySlug.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'rival-sealed',
      submitterUserId: cognitoSubAsUuid('route-owner'),
    });
    repo.findVersion.mockResolvedValue(versionRow());
    repo.setReviewStatus.mockImplementation(async ({ status }: { status: string }) =>
      versionRow({ reviewStatus: status, reviewedAt: NOW }),
    );
    audit.emitSync.mockResolvedValue({});
  });

  const approve = (headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/v2/evaluation/routes/rival-sealed/versions/1.0.0/review',
      headers,
      payload: { status: 'APPROVED' },
    });

  it('401s without a token', async () => {
    expect((await approve({})).statusCode).toBe(401);
  });

  it.each(['participant', 'host', 'reviewer', 'supervisor', 'regulator'])(
    '403s for %s, and records nothing',
    async (group) => {
      const res = await approve({ 'x-test-user': 'someone', 'x-test-groups': group });

      expect(res.statusCode).toBe(403);
      expect(repo.setReviewStatus).not.toHaveBeenCalled();
      expect(audit.emitSync).not.toHaveBeenCalled();
    },
  );

  it.each(['evaluation-reviewer', 'admin'])(
    'lets %s approve, and audits the real actor',
    async (group) => {
      const res = await approve({ 'x-test-user': 'reviewer-1', 'x-test-groups': group });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ reviewStatus: 'APPROVED' });
      expect(audit.emitSync).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'route.version.reviewed',
          actorUserId: cognitoSubAsUuid('reviewer-1'),
        }),
      );
    },
  );

  it.each([
    ['the route submitter', 'route-owner'],
    ['the version declarer', 'declarer'],
  ])('403s for %s even as a reviewer', async (_who, sub) => {
    const res = await approve({
      'x-test-user': sub,
      'x-test-groups': 'evaluation-reviewer,admin',
    });

    expect(res.statusCode).toBe(403);
    expect(repo.setReviewStatus).not.toHaveBeenCalled();
  });

  it('allows review of a route with no recorded submitter', async () => {
    repo.findRouteBySlug.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'oci-sealed',
      submitterUserId: null,
    });
    repo.findVersion.mockResolvedValue(versionRow({ declaredByUserId: null }));

    const res = await approve({
      'x-test-user': 'reviewer-1',
      'x-test-groups': 'evaluation-reviewer',
    });

    expect(res.statusCode).toBe(201);
  });
});
