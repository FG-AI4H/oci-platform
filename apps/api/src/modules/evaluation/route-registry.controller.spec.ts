import { type ExecutionContext, UnauthorizedException, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { AUDIT_EMITTER } from '../audit/audit.module.js';
import { RouteRegistryController } from './route-registry.controller.js';
import { RouteRegistryRepository } from './route-registry.repository.js';
import { RouteRegistryService } from './route-registry.service.js';

/**
 * Who may declare versions on a route and record review outcomes. Real
 * controller and service over the HTTP layer; only Cognito verification and
 * the repository are stubbed. `x-test-user` / `x-test-groups` stand in for a
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

function routeRow(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'rival-sealed',
    submitterUserId: cognitoSubAsUuid('route-owner'),
    ...over,
  };
}

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

const DECLARATION = {
  version: '1.1.0',
  threatModel: {
    adversaries: [{ party: 'PLATFORM_OPERATOR', capability: 'reads all logs', defended: true }],
    assumptions: ['SGX attestation root is trusted'],
    outOfScope: ['a malicious data host'],
  },
  disclosureProfile: {
    observations: [{ party: 'PLATFORM_OPERATOR', observes: 'ciphertext only' }],
    trustAnchor: 'HARDWARE_ATTESTATION',
    keyGovernance: 'Data host holds the sealing key.',
    reproducible: { value: false },
  },
  operationalEnvelope: {
    permittedOperations: ['inference'],
    arithmeticPrecision: 'fp32',
    maxRuntimeSec: 3600,
    maxMemoryMb: 8192,
  },
};

const repo = {
  findRouteBySlug: vi.fn(),
  findVersion: vi.fn(),
  createVersion: vi.fn(),
  setReviewStatus: vi.fn(),
};
const audit = { emitSync: vi.fn() };

describe('/v2/evaluation/routes authorization', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [RouteRegistryController],
      providers: [
        RouteRegistryService,
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
    repo.findRouteBySlug.mockResolvedValue(routeRow());
    repo.findVersion.mockResolvedValue(versionRow());
    repo.setReviewStatus.mockImplementation(async ({ status }: { status: string }) =>
      versionRow({ reviewStatus: status, reviewedAt: NOW }),
    );
    audit.emitSync.mockResolvedValue({});
  });

  describe('POST /v2/evaluation/routes/:slug/versions/:version/review', () => {
    const review = (status: string, headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/v2/evaluation/routes/rival-sealed/versions/1.0.0/review',
        headers,
        payload: { status },
      });
    const approve = (headers: Record<string, string>) => review('APPROVED', headers);

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
      repo.findRouteBySlug.mockResolvedValue(
        routeRow({ slug: 'oci-sealed', submitterUserId: null }),
      );
      repo.findVersion.mockResolvedValue(versionRow({ declaredByUserId: null }));

      const res = await approve({
        'x-test-user': 'reviewer-1',
        'x-test-groups': 'evaluation-reviewer',
      });

      expect(res.statusCode).toBe(201);
    });

    describe('withdrawal', () => {
      it.each(['DECLARED', 'UNDER_REVIEW', 'APPROVED'])(
        'lets the route submitter withdraw their own %s version without a reviewer role',
        async (from) => {
          repo.findVersion.mockResolvedValue(versionRow({ reviewStatus: from }));

          const res = await review('WITHDRAWN', {
            'x-test-user': 'route-owner',
            'x-test-groups': 'participant',
          });

          expect(res.statusCode).toBe(201);
          expect(res.json()).toMatchObject({ reviewStatus: 'WITHDRAWN' });
          expect(audit.emitSync).toHaveBeenCalledWith(
            expect.objectContaining({
              action: 'route.version.reviewed',
              actorUserId: cognitoSubAsUuid('route-owner'),
              payload: expect.objectContaining({ from, to: 'WITHDRAWN' }),
            }),
          );
        },
      );

      it.each(['UNDER_REVIEW', 'APPROVED', 'REJECTED'])(
        'still 403s the route submitter moving to %s, even as a reviewer',
        async (to) => {
          repo.findVersion.mockResolvedValue(
            versionRow({ reviewStatus: to === 'UNDER_REVIEW' ? 'DECLARED' : 'UNDER_REVIEW' }),
          );

          const res = await review(to, {
            'x-test-user': 'route-owner',
            'x-test-groups': 'evaluation-reviewer,admin',
          });

          expect(res.statusCode).toBe(403);
          expect(repo.setReviewStatus).not.toHaveBeenCalled();
          expect(audit.emitSync).not.toHaveBeenCalled();
        },
      );

      it("403s anyone else's withdrawal without a reviewer role", async () => {
        const res = await review('WITHDRAWN', {
          'x-test-user': 'someone',
          'x-test-groups': 'participant',
        });

        expect(res.statusCode).toBe(403);
        expect(repo.setReviewStatus).not.toHaveBeenCalled();
      });

      it('lets a reviewer withdraw a route they did not submit', async () => {
        const res = await review('WITHDRAWN', {
          'x-test-user': 'reviewer-1',
          'x-test-groups': 'evaluation-reviewer',
        });

        expect(res.statusCode).toBe(201);
      });

      it('still 400s a withdrawal from a terminal status', async () => {
        repo.findVersion.mockResolvedValue(versionRow({ reviewStatus: 'REJECTED' }));

        const res = await review('WITHDRAWN', {
          'x-test-user': 'route-owner',
          'x-test-groups': 'participant',
        });

        expect(res.statusCode).toBe(400);
        expect(repo.setReviewStatus).not.toHaveBeenCalled();
      });
    });
  });

  describe('POST /v2/evaluation/routes/:slug/versions', () => {
    beforeEach(() => {
      repo.findVersion.mockResolvedValue(null);
      repo.createVersion.mockImplementation(async (args: Record<string, unknown>) =>
        versionRow({ ...args, reviewStatus: 'DECLARED' }),
      );
    });

    const declare = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/v2/evaluation/routes/rival-sealed/versions',
        headers,
        payload: DECLARATION,
      });

    it('401s without a token', async () => {
      expect((await declare({})).statusCode).toBe(401);
    });

    it.each([
      ['the route submitter', 'route-owner', 'participant'],
      ['admin', 'admin-1', 'admin'],
    ])('lets %s declare a version, and records them as declarer', async (_who, sub, groups) => {
      const res = await declare({ 'x-test-user': sub, 'x-test-groups': groups });

      expect(res.statusCode).toBe(201);
      expect(repo.createVersion).toHaveBeenCalledWith(
        expect.objectContaining({ declaredByUserId: cognitoSubAsUuid(sub) }),
      );
      expect(audit.emitSync).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'route.version.declared',
          actorUserId: cognitoSubAsUuid(sub),
        }),
      );
    });

    it.each(['participant', 'host', 'evaluation-reviewer'])(
      "403s a %s declaring a version on someone else's route, and records nothing",
      async (group) => {
        const res = await declare({ 'x-test-user': 'someone', 'x-test-groups': group });

        expect(res.statusCode).toBe(403);
        expect(repo.createVersion).not.toHaveBeenCalled();
        expect(audit.emitSync).not.toHaveBeenCalled();
      },
    );

    describe('on a route with no recorded submitter', () => {
      beforeEach(() => {
        repo.findRouteBySlug.mockResolvedValue(
          routeRow({ slug: 'oci-sealed', submitterUserId: null }),
        );
      });

      it('lets admin declare a version', async () => {
        expect(
          (await declare({ 'x-test-user': 'admin-1', 'x-test-groups': 'admin' })).statusCode,
        ).toBe(201);
      });

      it.each(['participant', 'evaluation-reviewer'])('403s a %s', async (group) => {
        const res = await declare({ 'x-test-user': 'someone', 'x-test-groups': group });

        expect(res.statusCode).toBe(403);
        expect(repo.createVersion).not.toHaveBeenCalled();
      });
    });

    it('404s for an unknown route before checking ownership', async () => {
      repo.findRouteBySlug.mockResolvedValue(null);

      expect(
        (await declare({ 'x-test-user': 'someone', 'x-test-groups': 'participant' })).statusCode,
      ).toBe(404);
    });
  });
});
