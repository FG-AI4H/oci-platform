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
  findRouteBySlugWithVersions: vi.fn(),
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
    const review = (
      status: string,
      headers: Record<string, string>,
      reviewNotes: string | null = 'The declared envelope matches what the sandbox enforces.',
    ) =>
      app.inject({
        method: 'POST',
        url: '/v2/evaluation/routes/rival-sealed/versions/1.0.0/review',
        headers,
        payload: reviewNotes === null ? { status } : { status, reviewNotes },
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

    describe('rationale (ADR-0021)', () => {
      const reviewer = { 'x-test-user': 'reviewer-1', 'x-test-groups': 'evaluation-reviewer' };

      it.each([
        ['APPROVED', 'UNDER_REVIEW', null],
        ['REJECTED', 'UNDER_REVIEW', '   '],
        ['WITHDRAWN', 'APPROVED', ''],
      ])('400s a move to %s without a rationale, and records nothing', async (to, from, notes) => {
        repo.findVersion.mockResolvedValue(versionRow({ reviewStatus: from }));

        const res = await review(to, reviewer, notes);

        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('rationale');
        expect(repo.setReviewStatus).not.toHaveBeenCalled();
        expect(audit.emitSync).not.toHaveBeenCalled();
      });

      it('stores the rationale with the decision', async () => {
        const res = await review('APPROVED', reviewer, 'Attack on the metrics path failed.');

        expect(res.statusCode).toBe(201);
        expect(repo.setReviewStatus).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'APPROVED',
            reviewNotes: 'Attack on the metrics path failed.',
          }),
        );
      });

      it('lets a review begin without a note', async () => {
        repo.findVersion.mockResolvedValue(versionRow({ reviewStatus: 'DECLARED' }));

        const res = await review('UNDER_REVIEW', reviewer, null);

        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ reviewStatus: 'UNDER_REVIEW' });
      });

      it('403s the submitter before it looks at the rationale', async () => {
        const res = await review(
          'APPROVED',
          {
            'x-test-user': 'route-owner',
            'x-test-groups': 'evaluation-reviewer',
          },
          null,
        );

        expect(res.statusCode).toBe(403);
      });

      it('409s a version already in the requested status', async () => {
        repo.findVersion.mockResolvedValue(versionRow({ reviewStatus: 'APPROVED' }));

        expect((await review('APPROVED', reviewer)).statusCode).toBe(409);
        expect(repo.setReviewStatus).not.toHaveBeenCalled();
      });

      it('400s approving a version that is no longer under review', async () => {
        repo.findVersion.mockResolvedValue(versionRow({ reviewStatus: 'REJECTED' }));

        expect((await review('APPROVED', reviewer)).statusCode).toBe(400);
        expect(repo.setReviewStatus).not.toHaveBeenCalled();
      });
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

  describe('GET /v2/evaluation/routes/:slug/permissions', () => {
    const versions = [
      versionRow({ version: '1.0.0', reviewStatus: 'DECLARED' }),
      versionRow({ version: '1.1.0', reviewStatus: 'UNDER_REVIEW' }),
      versionRow({ version: '1.2.0', reviewStatus: 'APPROVED' }),
      versionRow({ version: '0.9.0', reviewStatus: 'REJECTED' }),
    ];
    const permissions = (headers: Record<string, string>) =>
      app.inject({ method: 'GET', url: '/v2/evaluation/routes/rival-sealed/permissions', headers });
    const byVersion = (body: { versions: Array<{ version: string }> }, v: string) =>
      body.versions.find((x) => x.version === v);

    beforeEach(() => {
      repo.findRouteBySlugWithVersions.mockResolvedValue({ ...routeRow(), versions });
    });

    it('401s without a token', async () => {
      expect((await permissions({})).statusCode).toBe(401);
    });

    it('404s for an unknown route', async () => {
      repo.findRouteBySlugWithVersions.mockResolvedValue(null);

      expect(
        (await permissions({ 'x-test-user': 'reviewer-1', 'x-test-groups': 'evaluation-reviewer' }))
          .statusCode,
      ).toBe(404);
    });

    it('gives a reviewer every transition the table allows, and no declaring', async () => {
      const res = await permissions({
        'x-test-user': 'reviewer-1',
        'x-test-groups': 'evaluation-reviewer',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        slug: 'rival-sealed',
        isSubmitter: false,
        canDeclareVersion: false,
      });
      expect(byVersion(body, '1.0.0')).toEqual({
        version: '1.0.0',
        reviewStatus: 'DECLARED',
        allowedTransitions: ['UNDER_REVIEW', 'WITHDRAWN'],
        reviewBar: null,
      });
      expect(byVersion(body, '1.1.0')).toMatchObject({
        allowedTransitions: ['APPROVED', 'REJECTED', 'WITHDRAWN'],
      });
      expect(byVersion(body, '1.2.0')).toMatchObject({
        allowedTransitions: ['WITHDRAWN', 'REJECTED'],
      });
      expect(byVersion(body, '0.9.0')).toMatchObject({ allowedTransitions: [], reviewBar: null });
    });

    it('lets the submitter declare and withdraw, never review, even as a reviewer', async () => {
      const body = (
        await permissions({ 'x-test-user': 'route-owner', 'x-test-groups': 'evaluation-reviewer' })
      ).json();

      expect(body).toMatchObject({ isSubmitter: true, canDeclareVersion: true });
      expect(byVersion(body, '1.1.0')).toMatchObject({
        allowedTransitions: ['WITHDRAWN'],
        reviewBar: 'SUBMITTED_BY_YOU',
      });
      expect(byVersion(body, '0.9.0')).toMatchObject({ allowedTransitions: [], reviewBar: null });
    });

    it('bars the declarer of a version from reviewing it', async () => {
      const body = (
        await permissions({ 'x-test-user': 'declarer', 'x-test-groups': 'evaluation-reviewer' })
      ).json();

      expect(byVersion(body, '1.1.0')).toMatchObject({
        allowedTransitions: [],
        reviewBar: 'DECLARED_BY_YOU',
      });
    });

    it('offers nothing to a participant and says why', async () => {
      const body = (
        await permissions({ 'x-test-user': 'someone', 'x-test-groups': 'participant' })
      ).json();

      expect(body).toMatchObject({ isSubmitter: false, canDeclareVersion: false });
      expect(byVersion(body, '1.1.0')).toMatchObject({
        allowedTransitions: [],
        reviewBar: 'NOT_A_REVIEWER',
      });
    });

    it('lets admin declare on a route with no recorded submitter, and review it', async () => {
      repo.findRouteBySlugWithVersions.mockResolvedValue({
        ...routeRow({ submitterUserId: null }),
        versions: [versionRow({ reviewStatus: 'UNDER_REVIEW', declaredByUserId: null })],
      });

      const body = (
        await permissions({ 'x-test-user': 'admin-1', 'x-test-groups': 'admin' })
      ).json();

      expect(body).toMatchObject({ isSubmitter: false, canDeclareVersion: true });
      expect(byVersion(body, '1.0.0')).toMatchObject({
        allowedTransitions: ['APPROVED', 'REJECTED', 'WITHDRAWN'],
        reviewBar: null,
      });
    });

    it('agrees with the review endpoint for every caller and status', async () => {
      const callers = [
        { 'x-test-user': 'reviewer-1', 'x-test-groups': 'evaluation-reviewer' },
        { 'x-test-user': 'route-owner', 'x-test-groups': 'evaluation-reviewer' },
        { 'x-test-user': 'route-owner', 'x-test-groups': 'participant' },
        { 'x-test-user': 'declarer', 'x-test-groups': 'admin' },
        { 'x-test-user': 'someone', 'x-test-groups': 'participant' },
      ];
      const statuses = ['DECLARED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN'];
      for (const headers of callers) {
        for (const from of statuses) {
          repo.findRouteBySlugWithVersions.mockResolvedValue({
            ...routeRow(),
            versions: [versionRow({ reviewStatus: from })],
          });
          repo.findVersion.mockResolvedValue(versionRow({ reviewStatus: from }));
          const offered = byVersion((await permissions(headers)).json(), '1.0.0') as unknown as {
            allowedTransitions: string[];
          };
          for (const to of statuses) {
            const res = await app.inject({
              method: 'POST',
              url: '/v2/evaluation/routes/rival-sealed/versions/1.0.0/review',
              headers,
              payload: { status: to, reviewNotes: 'Reason.' },
            });
            expect(
              res.statusCode === 201,
              `${headers['x-test-user']} ${from} -> ${to}: ${res.statusCode}`,
            ).toBe(offered.allowedTransitions.includes(to));
          }
        }
      }
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
