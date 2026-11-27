import { randomUUID } from 'node:crypto';
import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuditEmitter, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { COGNITO_VERIFIER, CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { PrismaService } from '../../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../../test-support/migrated-postgres.js';
import { AUDIT_EMITTER } from '../audit/audit.tokens.js';
import { CatalogRepository } from '../catalog/catalog.repository.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ModelCardEvidenceService } from '../evaluation/model-card-evidence.service.js';
import { IntendedUseService } from '../intended-use/intended-use.service.js';
import { PredictionRepository } from '../prediction/prediction.repository.js';
import { PredictionService } from '../prediction/prediction.service.js';
import { ToolsetController } from './toolset.controller.js';
import { ToolsetRepository } from './toolset.repository.js';
import { ToolsetService } from './toolset.service.js';

/**
 * Toolsets over HTTP against a real Postgres with every migration applied
 * (ADR-0031, #830): the lifecycle, who sees what, and the links to datasets
 * and model cards, decided by the catalogue's and the model catalogue's own
 * services.
 *
 * Real: the controller, the JWT guards, the toolset, catalogue and prediction
 * services and repositories, the audit writer and the database. Stubbed: the
 * Cognito signature check, and the evaluation evidence of a model card, which
 * nothing here reads.
 *
 * Needs a Docker daemon. CI always has one; a laptop without Docker skips.
 */

vi.hoisted(() => {
  delete process.env.OCI_ENV;
});

const dockerAvailable = await checkDocker('toolset.int.spec');

const DEV = { token: 'token-dev', sub: randomUUID(), groups: ['participant'] };
const OTHER = { token: 'token-other', sub: randomUUID(), groups: ['participant'] };
const OPERATOR = { token: 'token-operator', sub: randomUUID(), groups: ['admin'] };

const verifier = {
  verify: async (token: string) => {
    const who = [DEV, OTHER, OPERATOR].find((u) => u.token === token);
    if (!who) throw new Error('signature verification failed');
    return { sub: who.sub, 'cognito:groups': who.groups };
  },
};

const PUBLIC_SET = 'int-830-public-set';
const PRIVATE_SET = 'int-830-private-set';
const PUBLISHED_CARD = 'int-830-published-card';
const DRAFT_CARD = 'int-830-draft-card';
const SLUG = 'int-830-baseline-notebook';

const BODY = {
  slug: SLUG,
  name: 'Grading baseline notebook',
  kind: 'NOTEBOOK',
  summary: 'Trains and scores a small baseline on the grading task, end to end.',
  url: 'https://github.com/example/grading-baseline',
  licence: 'Apache-2.0',
  maintainer: 'Example Imaging Lab',
  datasetSlugs: [PUBLIC_SET],
  modelCardSlugs: [PUBLISHED_CARD],
};

describe.skipIf(!dockerAvailable)('Toolsets against Postgres (ADR-0031, #830)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    db = await startMigratedPostgres();
    prisma = db.prisma;

    const mod = await Test.createTestingModule({
      controllers: [ToolsetController],
      providers: [
        ToolsetService,
        ToolsetRepository,
        CatalogService,
        CatalogRepository,
        PredictionService,
        PredictionRepository,
        IntendedUseService,
        RolesGuard,
        CognitoJwtGuard,
        OptionalCognitoJwtGuard,
        { provide: COGNITO_VERIFIER, useValue: verifier },
        { provide: PrismaService, useValue: { client: prisma } },
        {
          provide: ModelCardEvidenceService,
          useValue: {
            performanceFor: async () => ({ entries: [], retracted: 0, notEstimable: 0 }),
          },
        },
        {
          provide: AUDIT_EMITTER,
          useValue: new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort }),
        },
      ],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const dataset = (slug: string, visibility: 'PUBLIC' | 'PRIVATE') =>
      prisma.dataset.create({
        data: {
          slug,
          name: `Dataset ${slug}`,
          hostId: randomUUID(),
          visibility,
          status: 'PUBLISHED',
        },
      });
    await dataset(PUBLIC_SET, 'PUBLIC');
    await dataset(PRIVATE_SET, 'PRIVATE');
    const card = (slug: string, status: 'PUBLISHED' | 'DRAFT') =>
      prisma.modelCard.create({
        data: {
          slug,
          submitterUserId: randomUUID(),
          intendedUse: {
            v: 1,
            medicalPurpose: 'triage',
            foreseeableMisuse: 'Use outside the validated population.',
            contraindications: '',
            riskTier: 'II',
          },
          modelClass: 'classical',
          architectureSummary: 'CNN.',
          versionMajorMinorPatch: '1.0.0',
          trainingDataJurisdictions: [],
          status,
        },
      });
    await card(PUBLISHED_CARD, 'PUBLISHED');
    await card(DRAFT_CARD, 'DRAFT');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  const bearer = (who?: { token: string }) =>
    who ? { authorization: `Bearer ${who.token}` } : undefined;
  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    who?: { token: string },
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/v2/toolsets${url}`,
      headers: bearer(who),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const move = (status: string, who: { token: string }, slug = SLUG) =>
    call('POST', `/${slug}/status`, who, { status });

  it('declares a draft, seen by its declarer and operators only', async () => {
    const created = await call('POST', '', DEV, BODY);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      slug: SLUG,
      status: 'DRAFT',
      datasets: [{ slug: PUBLIC_SET, name: `Dataset ${PUBLIC_SET}` }],
      modelCards: [{ slug: PUBLISHED_CARD }],
      datasetSlugs: [PUBLIC_SET],
      canEdit: true,
      // Its declarer may withdraw it; publishing is for an operator.
      moves: ['WITHDRAWN'],
    });

    expect((await call('GET', `/${SLUG}`)).statusCode).toBe(404);
    expect((await call('GET', `/${SLUG}`, OTHER)).statusCode).toBe(404);
    expect((await call('GET', `/${SLUG}`, OPERATOR)).json()).toMatchObject({
      canEdit: false,
      moves: ['PUBLISHED', 'WITHDRAWN'],
    });
    expect((await call('GET', '')).json()).toMatchObject({ items: [], total: 0 });
    expect((await call('GET', '/mine', DEV)).json().items).toHaveLength(1);
    expect((await call('GET', '/mine', OTHER)).json().items).toHaveLength(0);
  });

  it('refuses a second toolset under the same identifier', async () => {
    expect((await call('POST', '', OTHER, BODY)).statusCode).toBe(409);
  });

  it('refuses to name a dataset or a model the declarer cannot see, like one that does not exist', async () => {
    for (const links of [
      { datasetSlugs: [PRIVATE_SET] },
      { datasetSlugs: ['int-830-no-such-set'] },
      { modelCardSlugs: [DRAFT_CARD] },
    ]) {
      const res = await call('POST', '', DEV, { ...BODY, slug: 'int-830-refused', ...links });
      expect(res.statusCode, JSON.stringify(links)).toBe(400);
      expect(res.body).not.toContain(`Dataset ${PRIVATE_SET}`);
    }
    expect(await prisma.toolset.count()).toBe(1);
  });

  it('its declarer edits the draft; nobody else does', async () => {
    const edited = await call('PATCH', `/${SLUG}`, DEV, { version: '1.1.0', modelCardSlugs: [] });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({
      version: '1.1.0',
      modelCards: [],
      licence: 'Apache-2.0',
    });

    expect((await call('PATCH', `/${SLUG}`, OPERATOR, { version: '9' })).statusCode).toBe(403);
    expect((await call('PATCH', `/${SLUG}`, OTHER, { version: '9' })).statusCode).toBe(404);
    expect((await call('PATCH', `/${SLUG}`, DEV, { datasetSlugs: [PRIVATE_SET] })).statusCode).toBe(
      400,
    );
  });

  it('only an operator publishes; then anyone reads it and finds it', async () => {
    expect((await move('PUBLISHED', DEV)).statusCode).toBe(403);
    expect((await move('PUBLISHED', OTHER)).statusCode).toBe(404);
    const published = await move('PUBLISHED', OPERATOR);
    expect(published.statusCode, published.body).toBe(201);
    expect((await move('PUBLISHED', OPERATOR)).statusCode).toBe(409);

    const anonymous = await call('GET', `/${SLUG}`);
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json()).toMatchObject({
      status: 'PUBLISHED',
      datasets: [{ slug: PUBLIC_SET }],
      // A reader who is neither its declarer nor an operator gets no raw list.
      datasetSlugs: null,
      modelCardSlugs: null,
      canEdit: false,
      moves: [],
    });

    expect((await call('GET', '?q=baseline')).json()).toMatchObject({
      total: 1,
      items: [{ slug: SLUG, kind: 'NOTEBOOK', licence: 'Apache-2.0' }],
    });
    expect((await call('GET', '?kind=SIMULATOR')).json().total).toBe(0);
    expect((await call('GET', `?datasetSlug=${PUBLIC_SET}`)).json().total).toBe(1);
    expect((await call('GET', '?datasetSlug=int-830-other-set')).json().total).toBe(0);
    // Published: no longer editable, even by its declarer.
    expect((await call('PATCH', `/${SLUG}`, DEV, { version: '2' })).statusCode).toBe(409);
  });

  it('a reader is shown only the links they may see', async () => {
    // The dataset has been made private since the toolset named it.
    await prisma.dataset.update({ where: { slug: PUBLIC_SET }, data: { visibility: 'PRIVATE' } });

    const anonymous = await call('GET', `/${SLUG}`);
    expect(anonymous.json().datasets).toEqual([]);
    expect(anonymous.body).not.toContain(PUBLIC_SET);
    expect((await call('GET', `/${SLUG}`, OPERATOR)).json().datasets).toEqual([
      { slug: PUBLIC_SET, name: `Dataset ${PUBLIC_SET}` },
    ]);
  });

  it('its declarer withdraws it; withdrawn is terminal and off the public list', async () => {
    expect((await move('WITHDRAWN', OTHER)).statusCode).toBe(403);
    expect((await move('WITHDRAWN', DEV)).statusCode).toBe(201);

    expect((await call('GET', `/${SLUG}`)).statusCode).toBe(404);
    expect((await call('GET', '')).json().total).toBe(0);
    expect((await call('GET', `/${SLUG}`, DEV)).json()).toMatchObject({
      status: 'WITHDRAWN',
      moves: [],
    });
    expect((await move('PUBLISHED', OPERATOR)).statusCode).toBe(400);
  });

  it('writes are refused without a token, and each change is in the audit trail', async () => {
    expect((await call('POST', '', undefined, BODY)).statusCode).toBe(401);
    expect((await call('GET', '/mine')).statusCode).toBe(401);

    const events = await prisma.auditEvent.findMany({
      where: { module: 'toolset' },
      orderBy: { sequenceNumber: 'asc' },
      select: { action: true },
    });
    expect(events.map((e) => e.action)).toEqual([
      'toolset.created',
      'toolset.updated',
      'toolset.status.changed',
      'toolset.status.changed',
    ]);
  });
});
