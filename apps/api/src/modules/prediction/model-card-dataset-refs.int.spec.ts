import { randomUUID } from 'node:crypto';
import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuditEmitter, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import { ModelCardResponseSchema, PublicModelCardSchema } from '@oci/shared-types';
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
import { PredictionController, PredictionDatasetsController } from './prediction.controller.js';
import { PredictionRepository } from './prediction.repository.js';
import { PredictionService } from './prediction.service.js';

/**
 * #820: the datasets a model card declares, over HTTP against a real Postgres
 * with every migration applied (the `model_card_dataset_refs` table, its CHECK
 * constraint and its foreign key included).
 *
 * Real: the controllers, the JWT guards, the prediction service and
 * repository, the catalogue service and repository (so who sees a dataset is
 * the catalogue's own rule), the audit writer and the database. Stubbed: the
 * Cognito signature check, and the evaluation evidence (no linked result here;
 * `submission-model-card.int.spec.ts` covers that side).
 *
 * Needs a Docker daemon. CI always has one; a laptop without Docker skips.
 */

vi.hoisted(() => {
  delete process.env.OCI_ENV;
});

const dockerAvailable = await checkDocker('model-card-dataset-refs.int.spec');

const DEV = { token: 'token-dev', sub: randomUUID(), groups: ['researcher'] };
const REVIEWER = { token: 'token-reviewer', sub: randomUUID(), groups: ['evaluation-reviewer'] };
const ADMIN = { token: 'token-admin', sub: randomUUID(), groups: ['admin'] };

const verifier = {
  verify: async (token: string) => {
    const who = [DEV, REVIEWER, ADMIN].find((u) => u.token === token);
    if (!who) throw new Error('signature verification failed');
    return { sub: who.sub, 'cognito:groups': who.groups };
  },
};

const PUBLIC_SET = 'int-820-public-fundus';
const PRIVATE_SET = 'int-820-private-ct';
const CARD = 'int-820-grader';
const HASH_V1 = '1'.repeat(64);
const HASH_V2 = '2'.repeat(64);

const IUS = {
  v: 1,
  medicalPurpose: 'triage',
  foreseeableMisuse: 'Use outside the validated population.',
  contraindications: '',
  riskTier: 'II',
};

describe.skipIf(!dockerAvailable)('Model card dataset references against Postgres (#820)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let publicDatasetId: string;

  beforeAll(async () => {
    db = await startMigratedPostgres();
    prisma = db.prisma;

    const mod = await Test.createTestingModule({
      controllers: [PredictionController, PredictionDatasetsController],
      providers: [
        PredictionService,
        PredictionRepository,
        CatalogService,
        CatalogRepository,
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

    const publicSet = await prisma.dataset.create({
      data: {
        slug: PUBLIC_SET,
        name: 'Public fundus set',
        hostId: randomUUID(),
        visibility: 'PUBLIC',
        status: 'PUBLISHED',
        modalities: ['Fundus photography'],
        croissant: { license: 'https://creativecommons.org/licenses/by/4.0/' },
      },
    });
    publicDatasetId = publicSet.id;
    await prisma.datasetVersion.create({
      data: {
        datasetId: publicSet.id,
        version: '1.0.0',
        croissant: {},
        croissantHash: HASH_V1,
        publishedById: randomUUID(),
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.dataset.create({
      data: {
        slug: PRIVATE_SET,
        name: 'Private CT set',
        hostId: randomUUID(),
        visibility: 'PRIVATE',
        status: 'PUBLISHED',
      },
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  const bearer = (who?: { token: string }) =>
    who ? { authorization: `Bearer ${who.token}` } : undefined;

  const card = (who?: { token: string }) =>
    app.inject({ method: 'GET', url: `/v2/prediction/model-cards/${CARD}`, headers: bearer(who) });

  const patch = (payload: Record<string, unknown>, who: { token: string }) =>
    app.inject({
      method: 'PATCH',
      url: `/v2/prediction/model-cards/${CARD}`,
      payload,
      headers: bearer(who),
    });

  const move = (status: string, who: { token: string }) =>
    app.inject({
      method: 'POST',
      url: `/v2/prediction/model-cards/${CARD}/status`,
      payload: { status },
      headers: bearer(who),
    });

  const forDataset = (slug: string, who?: { token: string }) =>
    app.inject({
      method: 'GET',
      url: `/v2/prediction/datasets/${slug}/model-cards`,
      headers: bearer(who),
    });

  it('stores the declared datasets with the catalogue version current at the time', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/prediction/model-cards',
      headers: bearer(DEV),
      payload: {
        slug: CARD,
        intendedUse: IUS,
        modelClass: 'classical',
        architectureSummary: 'CNN.',
        versionMajorMinorPatch: '1.0.0',
        modelDeveloper: 'Int Test Lab',
        developerContact: 'lab@example.org',
        datasetRefs: [
          { role: 'TRAINING', datasetSlug: PUBLIC_SET, note: 'Training split' },
          {
            role: 'EVALUATION',
            externalUrl: 'https://doi.org/10.5555/int-820',
            externalName: 'External test set',
          },
        ],
      },
    });

    expect(res.statusCode, res.body).toBe(201);
    const body = ModelCardResponseSchema.parse(res.json());
    expect(body.datasetRefs).toEqual([
      {
        role: 'TRAINING',
        kind: 'CATALOGUE',
        datasetSlug: PUBLIC_SET,
        externalUrl: null,
        externalName: null,
        note: 'Training split',
        manifestVersion: '1.0.0',
        manifestSha256: HASH_V1,
        dataset: {
          name: 'Public fundus set',
          modalities: ['Fundus photography'],
          formats: [],
          licence: 'https://creativecommons.org/licenses/by/4.0/',
          latestVersion: '1.0.0',
        },
      },
      {
        role: 'EVALUATION',
        kind: 'EXTERNAL',
        datasetSlug: null,
        externalUrl: 'https://doi.org/10.5555/int-820',
        externalName: 'External test set',
        note: null,
        manifestVersion: null,
        manifestSha256: null,
        dataset: null,
      },
    ]);
  });

  it('refuses a private dataset the developer cannot see, and changes nothing', async () => {
    const res = await patch({ datasetRefs: [{ role: 'TRAINING', datasetSlug: PRIVATE_SET }] }, DEV);

    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('Private CT set');
    expect(await prisma.modelCardDatasetRef.count()).toBe(2);
  });

  it('the database refuses a row with two targets or none', async () => {
    const cardId = (await prisma.modelCard.findUniqueOrThrow({ where: { slug: CARD } })).id;
    const row = { modelCardId: cardId, position: 9, role: 'TRAINING' as const };

    await expect(prisma.modelCardDatasetRef.create({ data: row })).rejects.toThrow(
      /model_card_dataset_refs_one_target/,
    );
    await expect(
      prisma.modelCardDatasetRef.create({
        data: { ...row, datasetSlug: PUBLIC_SET, externalUrl: 'https://example.org' },
      }),
    ).rejects.toThrow(/model_card_dataset_refs_one_target/);
  });

  it('an edit replaces the list and keeps the pin of a dataset already declared', async () => {
    // The catalogue publishes a new version after the reference was saved.
    await prisma.datasetVersion.create({
      data: {
        datasetId: publicDatasetId,
        version: '2.0.0',
        croissant: {},
        croissantHash: HASH_V2,
        publishedById: randomUUID(),
        publishedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    });

    const res = await patch(
      {
        datasetRefs: [
          { role: 'TRAINING', datasetSlug: PUBLIC_SET, note: 'Training split, 80 %' },
          { role: 'VALIDATION', datasetSlug: PUBLIC_SET },
        ],
      },
      DEV,
    );

    expect(res.statusCode, res.body).toBe(200);
    const refs = ModelCardResponseSchema.parse(res.json()).datasetRefs;
    expect(refs.map((r) => [r.role, r.note, r.manifestVersion, r.manifestSha256])).toEqual([
      ['TRAINING', 'Training split, 80 %', '1.0.0', HASH_V1],
      ['VALIDATION', null, '1.0.0', HASH_V1],
    ]);
    expect(refs[0]?.dataset?.latestVersion).toBe('2.0.0');
    expect(await prisma.modelCardDatasetRef.count()).toBe(2);
  });

  it('an edit that does not send the list leaves it alone', async () => {
    const res = await patch({ clinicalSummary: 'Grades fundus photographs.' }, DEV);

    expect(res.statusCode).toBe(200);
    expect(res.json().datasetRefs).toHaveLength(2);
  });

  it('a draft is not listed on the dataset; a published card is, with its roles', async () => {
    expect((await forDataset(PUBLIC_SET)).json()).toEqual({ items: [] });

    expect((await move('SUBMITTED', DEV)).statusCode).toBe(201);
    expect((await move('PUBLISHED', REVIEWER)).statusCode).toBe(201);

    const res = await forDataset(PUBLIC_SET);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        {
          slug: CARD,
          modelDeveloper: 'Int Test Lab',
          versionMajorMinorPatch: '1.0.0',
          medicalPurpose: 'triage',
          riskTier: 'II',
          roles: ['TRAINING', 'VALIDATION'],
        },
      ],
    });
  });

  it('the public card carries the references', async () => {
    const res = await card();

    expect(res.statusCode).toBe(200);
    const body = PublicModelCardSchema.parse(res.json());
    expect(body.datasetRefs.map((r) => [r.kind, r.datasetSlug])).toEqual([
      ['CATALOGUE', PUBLIC_SET],
      ['CATALOGUE', PUBLIC_SET],
    ]);
  });

  it('a private dataset is withheld from the public and shown to those who may see it', async () => {
    // Declared by someone who could see it (an operator), read by the public.
    const cardId = (await prisma.modelCard.findUniqueOrThrow({ where: { slug: CARD } })).id;
    await prisma.modelCardDatasetRef.create({
      data: {
        modelCardId: cardId,
        position: 2,
        role: 'TUNING',
        datasetSlug: PRIVATE_SET,
        note: 'Site A only',
      },
    });

    const anonymous = await card();
    expect(anonymous.json().datasetRefs[2]).toEqual({
      role: 'TUNING',
      kind: 'WITHHELD',
      datasetSlug: null,
      externalUrl: null,
      externalName: null,
      note: null,
      manifestVersion: null,
      manifestSha256: null,
      dataset: null,
    });
    expect(anonymous.body).not.toContain(PRIVATE_SET);
    expect(anonymous.body).not.toContain('Site A only');

    const admin = await card(ADMIN);
    expect(admin.json().datasetRefs[2]).toMatchObject({
      kind: 'CATALOGUE',
      datasetSlug: PRIVATE_SET,
      dataset: { name: 'Private CT set' },
    });
  });

  it('the list of cards of a private dataset is a 404 for the public', async () => {
    expect((await forDataset(PRIVATE_SET)).statusCode).toBe(404);
    expect((await forDataset(PRIVATE_SET, DEV)).statusCode).toBe(404);
    expect((await forDataset(PRIVATE_SET, ADMIN)).json().items).toHaveLength(1);
    expect((await forDataset('int-820-no-such-set')).statusCode).toBe(404);
  });
});
