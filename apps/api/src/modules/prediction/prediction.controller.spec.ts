import { type ExecutionContext, UnauthorizedException, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { AUDIT_EMITTER } from '../audit/audit.module.js';
import { IntendedUseService } from '../intended-use/intended-use.service.js';
import { PredictionController } from './prediction.controller.js';
import { PredictionRepository } from './prediction.repository.js';
import { PredictionService } from './prediction.service.js';

/**
 * Who may read a model card and move it through its lifecycle. Real controller
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

/** The public reads (#591): no `x-test-user` means an anonymous caller, not a 401. */
const stubOptionalJwt = {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    return req.headers['x-test-user'] ? stubJwt.canActivate(ctx) : true;
  },
};

const SUBMITTER = { 'x-test-user': 'submitter', 'x-test-groups': 'participant' };
const SUBMITTER_REVIEWER = { 'x-test-user': 'submitter', 'x-test-groups': 'evaluation-reviewer' };
const SUBMITTER_ADMIN = { 'x-test-user': 'submitter', 'x-test-groups': 'admin' };
const STRANGER = { 'x-test-user': 'stranger', 'x-test-groups': 'participant,host' };
const REVIEWER = { 'x-test-user': 'reviewer-1', 'x-test-groups': 'evaluation-reviewer' };
const ADMIN = { 'x-test-user': 'admin-1', 'x-test-groups': 'admin' };

const NOW = new Date('2026-10-26T00:00:00.000Z');

function cardRow(status: string) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'acme-triage-v1',
    submitterUserId: cognitoSubAsUuid('submitter'),
    intendedUse: {
      v: 1,
      medicalPurpose: 'triage',
      foreseeableMisuse: 'Used outside the validated adult population.',
      contraindications: '',
      riskTier: 'III',
    },
    modelClass: 'lmm',
    architectureSummary: 'Transformer decoder.',
    trainingDataLineage: {},
    parentModelCardId: null,
    versionMajorMinorPatch: '1.0.0',
    changeJustification: null,
    materialChange: false,
    trainingDataJurisdictions: ['CH'],
    generativeAi: true,
    lmmSpecificLimitations: null,
    status,
    modelDeveloper: 'Acme Health AI GmbH',
    developerContact: 'regulatory@acme.example',
    clinicalSummary: null,
    regulatoryApproval: null,
    knownBiasesOrEthicalConsiderations: null,
    biasMitigationApproaches: null,
    ongoingMaintenance: null,
    securityPosture: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const repo = { findBySlug: vi.fn(), updateStatus: vi.fn() };
const audit = { emitSync: vi.fn() };

describe('/v2/prediction/model-cards authorization', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [PredictionController],
      providers: [
        PredictionService,
        { provide: PredictionRepository, useValue: repo },
        { provide: IntendedUseService, useValue: { validate: vi.fn() } },
        { provide: AUDIT_EMITTER, useValue: audit },
      ],
    })
      .overrideGuard(CognitoJwtGuard)
      .useValue(stubJwt)
      .overrideGuard(OptionalCognitoJwtGuard)
      .useValue(stubOptionalJwt)
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
    repo.updateStatus.mockImplementation(async (_id: string, status: string) => cardRow(status));
    audit.emitSync.mockResolvedValue({});
  });

  const get = (path: string, headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: `/v2/prediction/model-cards/acme-triage-v1${path}`, headers });

  const move = (status: string, headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/v2/prediction/model-cards/acme-triage-v1/status',
      headers,
      payload: { status },
    });

  describe('reads', () => {
    const paths = ['', '/model-facts', '/model-facts.md'];

    it.each(paths)('GET %s on a PUBLISHED card is open to anyone signed in', async (path) => {
      repo.findBySlug.mockResolvedValue(cardRow('PUBLISHED'));

      expect((await get(path, STRANGER)).statusCode).toBe(200);
    });

    it('a WITHDRAWN card stays readable by anyone signed in, marked as withdrawn', async () => {
      repo.findBySlug.mockResolvedValue(cardRow('WITHDRAWN'));

      const card = await get('', STRANGER);
      expect(card.statusCode).toBe(200);
      expect(card.json()).toMatchObject({ slug: 'acme-triage-v1', status: 'WITHDRAWN' });

      const label = await get('/model-facts', STRANGER);
      expect(label.statusCode).toBe(200);
      expect(label.json()).toMatchObject({ summary: { status: 'WITHDRAWN' } });

      const md = await get('/model-facts.md', STRANGER);
      expect(md.statusCode).toBe(200);
      expect(md.body).toContain('**Status** WITHDRAWN');
    });

    it.each(paths)('GET %s on a PUBLISHED card is open without a token (#591)', async (path) => {
      repo.findBySlug.mockResolvedValue(cardRow('PUBLISHED'));

      expect((await get(path, {})).statusCode).toBe(200);
    });

    it('an anonymous card read never carries submitterUserId (#591)', async () => {
      repo.findBySlug.mockResolvedValue(cardRow('PUBLISHED'));

      expect((await get('', {})).json()).not.toHaveProperty('submitterUserId');
      expect((await get('', STRANGER)).json()).toHaveProperty('submitterUserId');
    });

    it.each(['DRAFT', 'SUBMITTED', 'WITHDRAWN'])(
      'a %s card 404s without a token on every read (#591)',
      async (status) => {
        repo.findBySlug.mockResolvedValue(cardRow(status));

        for (const path of paths) {
          const res = await get(path, {});
          expect(res.statusCode).toBe(404);
          expect(res.body).not.toContain('Acme');
        }
      },
    );

    it('status changes still 401 without a token', async () => {
      repo.findBySlug.mockResolvedValue(cardRow('DRAFT'));

      expect((await move('SUBMITTED', {})).statusCode).toBe(401);
    });

    it.each(['DRAFT', 'SUBMITTED'])(
      'a %s card 404s for a stranger on every read',
      async (status) => {
        repo.findBySlug.mockResolvedValue(cardRow(status));

        for (const path of paths) {
          const res = await get(path, STRANGER);
          expect(res.statusCode).toBe(404);
          expect(res.body).not.toContain('Acme');
        }
      },
    );

    it.each([
      ['submitter', SUBMITTER],
      ['evaluation-reviewer', REVIEWER],
      ['admin', ADMIN],
    ])('a SUBMITTED card is readable by the %s', async (_who, headers) => {
      repo.findBySlug.mockResolvedValue(cardRow('SUBMITTED'));

      for (const path of paths) {
        expect((await get(path, headers)).statusCode).toBe(200);
      }
    });
  });

  describe('status changes', () => {
    it.each([
      // from, to, caller, expected
      ['DRAFT', 'SUBMITTED', SUBMITTER, 201],
      ['DRAFT', 'SUBMITTED', REVIEWER, 403],
      ['DRAFT', 'SUBMITTED', ADMIN, 403],
      ['DRAFT', 'SUBMITTED', STRANGER, 404],
      ['SUBMITTED', 'PUBLISHED', REVIEWER, 201],
      ['SUBMITTED', 'PUBLISHED', ADMIN, 201],
      ['SUBMITTED', 'PUBLISHED', SUBMITTER, 403],
      ['SUBMITTED', 'PUBLISHED', SUBMITTER_REVIEWER, 403],
      ['SUBMITTED', 'PUBLISHED', SUBMITTER_ADMIN, 403],
      ['SUBMITTED', 'PUBLISHED', STRANGER, 404],
      ['SUBMITTED', 'DRAFT', SUBMITTER, 201],
      ['SUBMITTED', 'DRAFT', REVIEWER, 201],
      ['SUBMITTED', 'DRAFT', STRANGER, 404],
      ['PUBLISHED', 'WITHDRAWN', REVIEWER, 201],
      ['PUBLISHED', 'WITHDRAWN', ADMIN, 201],
      ['PUBLISHED', 'WITHDRAWN', SUBMITTER, 201],
      ['PUBLISHED', 'WITHDRAWN', SUBMITTER_ADMIN, 201],
      ['PUBLISHED', 'WITHDRAWN', STRANGER, 403],
    ] as const)('%s → %s by %o: %i', async (from, to, headers, expected) => {
      repo.findBySlug.mockResolvedValue(cardRow(from));

      const res = await move(to, headers);

      expect(res.statusCode).toBe(expected);
      if (expected === 201) {
        expect(audit.emitSync).toHaveBeenCalledWith(
          expect.objectContaining({ actorUserId: cognitoSubAsUuid(headers['x-test-user']) }),
        );
      } else {
        expect(repo.updateStatus).not.toHaveBeenCalled();
        expect(audit.emitSync).not.toHaveBeenCalled();
      }
    });
  });
});
