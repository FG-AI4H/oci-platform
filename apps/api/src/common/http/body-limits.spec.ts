import {
  Controller,
  Get,
  NotFoundException,
  PayloadTooLargeException,
  Post,
  VersioningType,
} from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  DEFAULT_REQUEST_BODY_LIMIT_BYTES,
  MANIFEST_PUBLISH_BODY_LIMIT_BYTES,
  MAX_PREDICTION_ROWS,
  PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES,
} from '@oci/shared-types';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { CatalogController } from '../../modules/catalog/catalog.controller.js';
import { CatalogService } from '../../modules/catalog/catalog.service.js';
import { SubmissionBodyPipe } from '../../modules/evaluation/dto/submission-body.pipe.js';
import { EvalSeamGuard } from '../../modules/evaluation/eval-seam.guard.js';
import { EvalAiSeamController } from '../../modules/evaluation/evalai-seam.controller.js';
import { EvalAiSeamService } from '../../modules/evaluation/evalai-seam.service.js';
import { EvaluationController } from '../../modules/evaluation/evaluation.controller.js';
import { EvaluationService } from '../../modules/evaluation/evaluation.service.js';
import { PAYLOAD_TOO_LARGE_PROBLEM_TYPE } from '../exceptions/payload-too-large.filter.js';
import { applyRouteBodyLimits, ROUTE_BODY_LIMITS, SERVER_BODY_LIMIT_BYTES } from './body-limits.js';
import { configureRequestBodyLimits } from './configure-body-limits.js';

/**
 * #741 — the request body limits, over HTTP. The real controllers, pipes and
 * the same wiring `main.ts` uses; only the services and the guards are stubs,
 * because nothing here is about who may call or what happens next. Each limit
 * is tested with a body of exactly the limit (accepted) and one byte more
 * (413, as a problem response).
 */

/** `value` as JSON, padded with trailing spaces (still valid JSON) to exactly `bytes`. */
function jsonOfSize(value: unknown, bytes: number): string {
  const json = JSON.stringify(value);
  const size = Buffer.byteLength(json, 'utf8');
  if (size > bytes) throw new Error(`body is ${size} bytes, over the ${bytes} asked for`);
  return json + ' '.repeat(bytes - size);
}

const predictions = (rows: number, idLength = 8) => ({
  methodName: 'body-limit check',
  intent: 'VALIDATION',
  predictions: Array.from({ length: rows }, (_, i) => ({
    imageId: String(i).padStart(idLength, 'x'),
    grade: 1,
  })),
});

const manifest = {
  version: '1.0.0',
  croissant: { '@type': 'sc:Dataset', name: 'limit check' },
  notes: null,
};

const seamIntake = {
  taskSlug: 'body-limit-task',
  predictions: predictions(10).predictions,
  externalSubmissionId: '1',
  externalChallengeId: '493',
  externalParticipantId: 'participant_team:1',
  phaseCodename: 'dev',
};

/** Throws what services throw, to show the filter leaves those answers alone. */
@Controller({ path: 'body-limit-probe', version: '2' })
class ProbeController {
  @Get('bulk')
  bulk() {
    throw new PayloadTooLargeException({ message: 'archive too large', totalBytes: 5 });
  }

  @Get('missing')
  missing() {
    throw new NotFoundException('no such thing');
  }

  @Post('default')
  takesDefault() {
    return { ok: true };
  }
}

const allow = { canActivate: () => true };
const evaluation = {
  validatePredictions: vi.fn(async () => ({ ok: true })),
  submitPredictions: vi.fn(async () => ({ id: 'x' })),
  validateContainer: vi.fn(),
  submitContainer: vi.fn(),
};
const seam = { intake: vi.fn(async () => ({ accepted: true })) };
const catalog = { publishVersion: vi.fn(async () => ({ version: '1.0.0' })), create: vi.fn() };

describe('request body limits over HTTP (#741)', () => {
  let app: NestFastifyApplication;
  let bodyLimits: { assertAllApplied(): void };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [EvaluationController, EvalAiSeamController, CatalogController, ProbeController],
      providers: [
        SubmissionBodyPipe,
        { provide: EvaluationService, useValue: evaluation },
        { provide: EvalAiSeamService, useValue: seam },
        { provide: CatalogService, useValue: catalog },
      ],
    })
      .overrideGuard(CognitoJwtGuard)
      .useValue(allow)
      .overrideGuard(OptionalCognitoJwtGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .overrideGuard(EvalSeamGuard)
      .useValue(allow)
      .compile();
    // As main.ts creates the adapter.
    app = mod.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: SERVER_BODY_LIMIT_BYTES }),
    );
    bodyLimits = configureRequestBodyLimits(app);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const post = (url: string, payload: string) =>
    app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload });

  it('applies every limit in the table to a registered route', () => {
    expect(() => bodyLimits.assertAllApplied()).not.toThrow();
    expect(ROUTE_BODY_LIMITS.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
      'POST /v2/evaluation/tasks/:slug/submissions',
      'POST /v2/evaluation/seam/evalai/submissions',
      'POST /v2/catalog/datasets/:slug/versions',
    ]);
  });

  describe('predictions submission: 10 MiB', () => {
    const url = '/v2/evaluation/tasks/body-limit-task/submissions';

    it('takes the schema’s 100,000 rows with 64-character identifiers', async () => {
      const body = JSON.stringify(predictions(MAX_PREDICTION_ROWS, 64));
      // 89 bytes a row with one-digit labels: about 8.9 MB.
      expect(Buffer.byteLength(body)).toBeGreaterThan(8_800_000);
      const res = await post(url, body);
      expect(res.statusCode).toBe(201);
      expect(evaluation.validatePredictions).toHaveBeenCalledTimes(1);
    }, 60_000);

    it('takes a body of exactly the limit', async () => {
      const res = await post(
        url,
        jsonOfSize(predictions(10), PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES),
      );
      expect(res.statusCode).toBe(201);
      expect(evaluation.validatePredictions).toHaveBeenCalledTimes(1);
    });

    it('refuses one byte more with a problem response a participant can act on', async () => {
      const res = await post(
        url,
        jsonOfSize(predictions(10), PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES + 1),
      );
      expect(res.statusCode).toBe(413);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      const problem = res.json<Record<string, unknown>>();
      expect(problem).toMatchObject({
        type: PAYLOAD_TOO_LARGE_PROBLEM_TYPE,
        title: 'Payload Too Large',
        status: 413,
        statusCode: 413,
        instance: url,
        limitBytes: PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES,
      });
      expect(problem.detail).toContain('The predictions submission is larger than 10 MiB');
      expect(problem.detail).toContain('100,000 predictions');
      expect(problem.message).toBe(problem.detail);
      expect(evaluation.validatePredictions).not.toHaveBeenCalled();
      expect(evaluation.submitPredictions).not.toHaveBeenCalled();
    });
  });

  describe('EvalAI seam intake: 10 MiB', () => {
    const url = '/v2/evaluation/seam/evalai/submissions';

    it('takes a body of exactly the limit', async () => {
      const res = await post(url, jsonOfSize(seamIntake, PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES));
      expect(res.statusCode).toBe(202);
      expect(seam.intake).toHaveBeenCalledTimes(1);
    });

    it('refuses one byte more', async () => {
      const res = await post(
        url,
        jsonOfSize(seamIntake, PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES + 1),
      );
      expect(res.statusCode).toBe(413);
      expect(res.json()).toMatchObject({ limitBytes: PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES });
      expect(seam.intake).not.toHaveBeenCalled();
    });
  });

  describe('manifest publish: 8 MiB', () => {
    const url = '/v2/catalog/datasets/limit-check/versions';

    it('takes a body of exactly the limit', async () => {
      const res = await post(url, jsonOfSize(manifest, MANIFEST_PUBLISH_BODY_LIMIT_BYTES));
      expect(res.statusCode).toBe(201);
      expect(catalog.publishVersion).toHaveBeenCalledTimes(1);
    });

    it('refuses one byte more, and says how to make the manifest smaller', async () => {
      const res = await post(url, jsonOfSize(manifest, MANIFEST_PUBLISH_BODY_LIMIT_BYTES + 1));
      expect(res.statusCode).toBe(413);
      const problem = res.json<{ detail: string; limitBytes: number }>();
      expect(problem.limitBytes).toBe(MANIFEST_PUBLISH_BODY_LIMIT_BYTES);
      expect(problem.detail).toContain('The manifest is larger than 8 MiB');
      expect(problem.detail).toContain('FileSet');
      expect(catalog.publishVersion).not.toHaveBeenCalled();
    });
  });

  describe('every other route: 1 MiB', () => {
    it('takes a body of exactly the limit', async () => {
      const res = await post(
        '/v2/body-limit-probe/default',
        jsonOfSize({}, DEFAULT_REQUEST_BODY_LIMIT_BYTES),
      );
      expect(res.statusCode).toBe(201);
    });

    it('refuses one byte more, on a route of the table’s modules too', async () => {
      for (const url of ['/v2/body-limit-probe/default', '/v2/catalog/datasets']) {
        const res = await post(url, jsonOfSize({}, DEFAULT_REQUEST_BODY_LIMIT_BYTES + 1));
        expect(res.statusCode, url).toBe(413);
        const problem = res.json<{ detail: string; limitBytes: number }>();
        expect(problem.limitBytes).toBe(DEFAULT_REQUEST_BODY_LIMIT_BYTES);
        expect(problem.detail).toBe(
          'The request body is larger than 1 MiB, the most this endpoint accepts. Nothing was stored.',
        );
      }
      expect(catalog.create).not.toHaveBeenCalled();
    });
  });

  describe('other errors keep the answer they had', () => {
    it('a 413 thrown by a service keeps its own body', async () => {
      const res = await app.inject({ method: 'GET', url: '/v2/body-limit-probe/bulk' });
      expect(res.statusCode).toBe(413);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.json()).toEqual({ message: 'archive too large', totalBytes: 5 });
    });

    it('a 404 keeps Nest’s shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/v2/body-limit-probe/missing' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        statusCode: 404,
        message: 'no such thing',
        error: 'Not Found',
      });
    });
  });
});

describe('applyRouteBodyLimits', () => {
  it('fails when a table entry names a route that was never registered', async () => {
    const fastify = Fastify();
    const limits = applyRouteBodyLimits(fastify, [
      { method: 'POST', url: '/v2/exists', bytes: 2048, body: 'thing', advice: '' },
      { method: 'POST', url: '/v2/renamed', bytes: 2048, body: 'thing', advice: '' },
    ]);
    fastify.post('/v2/exists', async () => ({ ok: true }));
    await fastify.ready();
    expect(() => limits.assertAllApplied()).toThrow(/POST \/v2\/renamed/);
    const res = await fastify.inject({
      method: 'POST',
      url: '/v2/exists',
      headers: { 'content-type': 'application/json' },
      payload: jsonOfSize({}, 2049),
    });
    expect(res.statusCode).toBe(413);
    await fastify.close();
  });

  it('refuses a limit that is not a positive whole number of bytes', () => {
    expect(() =>
      applyRouteBodyLimits(Fastify(), [
        { method: 'POST', url: '/v2/x', bytes: 0, body: 'thing', advice: '' },
      ]),
    ).toThrow(/positive integer/);
  });
});
