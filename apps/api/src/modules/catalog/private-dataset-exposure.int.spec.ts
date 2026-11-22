import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@oci/database';
import { ListDatasetsQuerySchema, type DatasetSlug } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../../test-support/migrated-postgres.js';
import { AccessRequestRepository } from '../access-request/access-request.repository.js';
import { AccessRequestService } from '../access-request/access-request.service.js';
import { RequesterEmailResolver } from '../access-request/requester-email.resolver.js';
import { CampaignRepository } from '../annotation/campaign.repository.js';
import { CampaignService } from '../annotation/campaign.service.js';
import type { CertificationService } from '../certification/certification.service.js';
import { CapabilitiesService } from '../discovery/capabilities.service.js';
import { DuaTemplateService } from '../dua-template/dua-template.service.js';
import type { CognitoAdminClient } from '../identity-admin/cognito-admin.client.js';
import type { OrcidLinkService } from '../orcid-link/orcid-link.service.js';
import type { PassportIssuerService } from '../passport-issuer/passport-issuer.service.js';
import type { PassportService } from '../passport/passport.service.js';
import { BulkDownloadService } from '../storage/bulk-download.service.js';
import { DicomIndexRepository } from '../storage/dicom-index.repository.js';
import { DicomIndexService } from '../storage/dicom-index.service.js';
import type { S3ClientProvider } from '../storage/s3-client.js';
import { StorageService } from '../storage/storage.service.js';
import { CatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';

/**
 * #658 — what a PRIVATE dataset shows, and to whom, against a real
 * Postgres with every migration applied.
 *
 * A sample of exams from an institution is hosted as a PRIVATE dataset
 * of tier CONTROLLED. This spec is the check that such a dataset is
 * invisible to a signed-out visitor and to an account that is neither
 * its host nor an admin, on every surface that names or serves a
 * dataset. It pins today's rules; it does not judge them. Where the
 * rule gives something to a caller who is neither host nor admin, the
 * test says so in its name.
 *
 * Nothing between the services and the database is mocked. Storage
 * addresses are signed by the real presigner, offline, with throwaway
 * credentials. Stand-ins are limited to what these paths never depend
 * on for their decision: the identity inputs of an access request
 * (certification, ORCID, visas, the user pool).
 *
 * Needs a Docker daemon. CI (`CI=true`) always has one and runs this
 * spec; a laptop without Docker skips it rather than failing `pnpm test`.
 */
const dockerAvailable = await checkDocker('private-dataset-exposure.int.spec');

const BUCKET = 'oci-datasets-test';
// UUID-shaped subs short-circuit the UUIDv5 derivation.
const OWNER_SUB = '00000000-0000-4000-8000-000000658001';
const ADMIN_SUB = '00000000-0000-4000-8000-000000658002';
const REGULATOR_SUB = '00000000-0000-4000-8000-000000658003';
const SUPERVISOR_SUB = '00000000-0000-4000-8000-000000658004';
const OTHER_HOST_SUB = '00000000-0000-4000-8000-000000658005';
const PARTICIPANT_SUB = '00000000-0000-4000-8000-000000658006';
const ANNOTATOR_SUB = '00000000-0000-4000-8000-000000658007';
const NO_GROUP_SUB = '00000000-0000-4000-8000-000000658008';
const APPROVED_SUB = '00000000-0000-4000-8000-000000658009';

function user(sub: string, ...groups: string[]): CognitoAccessTokenPayload {
  return { sub, 'cognito:groups': groups } as unknown as CognitoAccessTokenPayload;
}
const ANONYMOUS = undefined;
const OWNER = user(OWNER_SUB, 'host');
const OWNER_WITHOUT_HOST_GROUP = user(OWNER_SUB, 'participant');
const ADMIN = user(ADMIN_SUB, 'admin');
const REGULATOR = user(REGULATOR_SUB, 'regulator');
const SUPERVISOR = user(SUPERVISOR_SUB, 'supervisor');
const OTHER_HOST = user(OTHER_HOST_SUB, 'host');
const PARTICIPANT = user(PARTICIPANT_SUB, 'participant');
const ANNOTATOR = user(ANNOTATOR_SUB, 'annotator');
const NO_GROUP = user(NO_GROUP_SUB);
const APPROVED = user(APPROVED_SUB, 'participant');

/** Signed-out, and every signed-in account that is neither host, admin, regulator nor supervisor. */
const OUTSIDERS: Array<[string, CognitoAccessTokenPayload | undefined]> = [
  ['a signed-out visitor', ANONYMOUS],
  ['a signed-in account with no group', NO_GROUP],
  ['a participant', PARTICIPANT],
  ['an annotator', ANNOTATOR],
  ['a host who does not own it', OTHER_HOST],
];
const SIGNED_IN_OUTSIDERS = OUTSIDERS.filter(
  (entry): entry is [string, CognitoAccessTokenPayload] => entry[1] !== undefined,
);
/** Groups the catalogue gives every record to, "for audit". Not the bytes. */
const AUDIT_READERS: Array<[string, CognitoAccessTokenPayload]> = [
  ['a regulator', REGULATOR],
  ['a supervisor', SUPERVISOR],
];

// Invented words, so that a search can only match these rows.
const PRIVATE_SLUG = 'zephyrine-head-ct-sample' as DatasetSlug;
const PRIVATE_NAME = 'Zephyrine head CT sample';
const PRIVATE_DESCRIPTION = 'Quokkaword reading exercise, fifty exams.';
const PRIVATE_DOMAIN = 'radiology.zephyrine.example';
const PUBLIC_SLUG = 'public-control-658' as DatasetSlug;
const RESTRICTED_SLUG = 'restricted-control-658' as DatasetSlug;
const UNKNOWN_SLUG = 'no-such-dataset-658' as DatasetSlug;

const DUO = ['DUO_0000042', 'DUO_0000046'];

const ATTESTATIONS = {
  v: 1 as const,
  projectTitle: 'Reading study on head CT',
  projectDescription:
    'A request written by an account outside the workshop, to see what the platform answers for a private dataset.',
  institution: 'Example University',
  intendedUseCategory: 'NON_COMMERCIAL_RESEARCH' as const,
  intendedUseDuoTerms: ['DUO_0000042'],
  irbApproved: true,
  irbApprovalRef: 'IRB-EXAMPLE-658',
  dpiaRef: null,
  dataRetentionDays: 365,
  redistributionIntent: 'NONE' as const,
  outputType: 'PUBLICATION' as const,
};

const DUA_BODY = {
  audience: 'RESEARCHER' as const,
  intendedUse: 'A rationale of more than twenty characters, for a research study.',
};

function query(input: Record<string, unknown> = {}) {
  return ListDatasetsQuerySchema.parse({ limit: 100, ...input });
}

describe.skipIf(!dockerAvailable)('exposure of a PRIVATE dataset against Postgres (#658)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;
  let catalog: CatalogService;
  let storage: StorageService;
  let bulk: BulkDownloadService;
  let accessRequests: AccessRequestService;
  let dua: DuaTemplateService;
  let campaigns: CampaignService;

  let privateId: string;
  let clearDistributionId: string;
  let heldDistributionId: string;
  let restrictedDistributionId: string;

  async function seedDataset(args: {
    slug: string;
    name: string;
    description: string;
    visibility: 'PRIVATE' | 'RESTRICTED' | 'PUBLIC';
    files: Array<{ name: string; held?: boolean }>;
    emailDomainAllowlist?: string[];
  }): Promise<{ id: string; distributionIds: string[] }> {
    const dataset = await prisma.dataset.create({
      data: {
        slug: args.slug,
        name: args.name,
        description: args.description,
        hostId: OWNER_SUB,
        visibility: args.visibility,
        status: 'PUBLISHED',
        accessTier: 'CONTROLLED',
        commercialUseTerms: 'NON_COMMERCIAL_ONLY',
        duoTerms: DUO,
        emailDomainAllowlist: args.emailDomainAllowlist ?? [],
      },
    });
    const version = await prisma.datasetVersion.create({
      data: {
        datasetId: dataset.id,
        version: '1.0.0',
        croissant: {},
        publishedById: OWNER_SUB,
      },
    });
    const index = new DicomIndexRepository({ client: prisma } as unknown as PrismaService);
    const distribution: Array<Record<string, string>> = [];
    const distributionIds: string[] = [];
    for (const file of args.files) {
      const key = `${args.slug}/${randomUUID()}/${file.name}`;
      const row = await prisma.distribution.create({
        data: {
          datasetVersionId: version.id,
          croissantId: file.name,
          contentType: 'application/dicom',
          contentSizeBytes: 1024n,
          storageBackend: 'S3',
          s3Bucket: BUCKET,
          s3Key: key,
          uploadStatus: 'READY',
        },
      });
      await index.save({
        datasetId: dataset.id,
        s3Bucket: BUCKET,
        s3Key: key,
        checkStatus: file.held ? 'HELD' : 'CLEAR',
        unreadableReason: null,
        parsed: null,
        findings: file.held ? [{ attribute: 'PatientID', valueDigest: 'digest' }] : [],
      });
      distributionIds.push(row.id);
      distribution.push({
        '@type': 'cr:FileObject',
        '@id': file.name,
        name: file.name,
        encodingFormat: 'application/dicom',
        contentUrl: `/v2/catalog/datasets/${args.slug}/distributions/${row.id}/download`,
      });
    }
    // The manifest names every file, as a host's manifest does.
    const croissant = {
      '@type': 'sc:Dataset',
      name: args.name,
      description: args.description,
      license: 'https://example.org/licence/658',
      'bio:imagingModality': [{ name: 'CT' }],
      distribution,
    };
    await prisma.dataset.update({ where: { id: dataset.id }, data: { croissant } });
    await prisma.datasetVersion.update({ where: { id: version.id }, data: { croissant } });
    return { id: dataset.id, distributionIds };
  }

  beforeAll(async () => {
    db = await startMigratedPostgres();
    prisma = db.prisma;
    const prismaService = { client: prisma } as unknown as PrismaService;

    catalog = new CatalogService(new CatalogRepository(prismaService));
    // The identity inputs of a request do not decide whether a request
    // may exist; they only set its score.
    accessRequests = new AccessRequestService(
      new AccessRequestRepository(prismaService),
      catalog,
      {
        listOwnStatus: async () => ({ active: false }),
      } as unknown as CertificationService,
      { getMyLink: async () => null } as unknown as OrcidLinkService,
      { listActiveVisaTypesForUser: async () => [] } as unknown as PassportService,
      {
        issueVisa: async () => ({}),
        getIssuerUrl: () => 'https://oci.example',
      } as unknown as PassportIssuerService,
      new RequesterEmailResolver({
        getVerifiedEmail: async () => null,
      } as unknown as CognitoAdminClient),
    );
    const s3 = {
      bucket: BUCKET,
      publicEndpoint: undefined,
      // Signing is local arithmetic: no request leaves the process.
      client: new S3Client({
        region: 'eu-central-1',
        credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
      }),
    } as unknown as S3ClientProvider;
    storage = new StorageService(
      s3,
      prismaService,
      catalog,
      accessRequests,
      new DicomIndexService(s3, new DicomIndexRepository(prismaService)),
    );
    bulk = new BulkDownloadService(s3, prismaService, catalog, storage);
    dua = new DuaTemplateService(catalog);
    campaigns = new CampaignService(new CampaignRepository(prismaService));

    const sample = await seedDataset({
      slug: PRIVATE_SLUG,
      name: PRIVATE_NAME,
      description: PRIVATE_DESCRIPTION,
      visibility: 'PRIVATE',
      files: [{ name: 'exam-001-slice-001.dcm' }, { name: 'exam-002-slice-001.dcm', held: true }],
      emailDomainAllowlist: [PRIVATE_DOMAIN],
    });
    privateId = sample.id;
    [clearDistributionId, heldDistributionId] = sample.distributionIds as [string, string];

    await seedDataset({
      slug: PUBLIC_SLUG,
      name: 'Public control',
      description: 'An open dataset, so that the lists below are never empty.',
      visibility: 'PUBLIC',
      files: [{ name: 'open-001.dcm' }],
    });
    const restricted = await seedDataset({
      slug: RESTRICTED_SLUG,
      name: 'Restricted control',
      description: 'Listed to signed-in accounts, files on approval.',
      visibility: 'RESTRICTED',
      files: [{ name: 'gated-001.dcm' }],
    });
    [restrictedDistributionId] = restricted.distributionIds as [string];
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  const slugsOf = (page: { items: Array<{ slug: string }> }) => page.items.map((i) => i.slug);

  // --- 1. The catalogue list and search ---------------------------------

  describe('catalogue list and search', () => {
    it.each(OUTSIDERS)('is absent from the plain list for %s', async (_who, caller) => {
      const page = await catalog.list(query(), caller);
      expect(slugsOf(page)).toContain(PUBLIC_SLUG);
      expect(slugsOf(page)).not.toContain(PRIVATE_SLUG);
    });

    it.each(OUTSIDERS)(
      'is not found by a search on its name, its slug or its description for %s',
      async (_who, caller) => {
        for (const q of ['zephyrine', 'quokkaword', PRIVATE_SLUG, 'Zephyrine head CT sample']) {
          const page = await catalog.list(query({ q }), caller);
          expect(page.items).toEqual([]);
          // The count would give it away as well as the row.
          expect(page.totalEstimate).toBe(0);
        }
      },
    );

    it.each(OUTSIDERS)('is not counted in the total for %s', async (_who, caller) => {
      const seen = await catalog.list(query(), caller);
      expect(seen.totalEstimate).toBe(seen.items.length);
    });

    it.each(OUTSIDERS)(
      'is absent under every facet, filter, sort and paging mode for %s',
      async (_who, caller) => {
        const variants: Array<Record<string, unknown>> = [
          { modality: 'CT' },
          { duoTerms: 'DUO_0000042' },
          { commercialUseTerms: 'NON_COMMERCIAL_ONLY' },
          { license: 'example.org' },
          // Asking for it by its visibility, its status or its host changes nothing.
          { visibility: 'PRIVATE' },
          { status: 'PUBLISHED' },
          { status: 'DRAFT' },
          { hostId: OWNER_SUB },
          { hostId: OWNER_SUB, status: 'PUBLISHED' },
          { source: 'all' },
          { source: 'all', q: 'zephyrine' },
          { source: 'federated', q: 'zephyrine' },
          { sort: 'name' },
          { sort: 'oldest' },
          { page: 1 },
          { page: 1, q: 'zephyrine' },
          { limit: 1 },
        ];
        for (const variant of variants) {
          const page = await catalog.list(query(variant), caller);
          expect(slugsOf(page), JSON.stringify(variant)).not.toContain(PRIVATE_SLUG);
        }
      },
    );

    it.each(OUTSIDERS)('is not reached by following the cursor for %s', async (_who, caller) => {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i += 1) {
        const page = await catalog.list(query({ limit: 1, cursor }), caller);
        seen.push(...slugsOf(page));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(seen).toContain(PUBLIC_SLUG);
      expect(seen).not.toContain(PRIVATE_SLUG);
    });

    it.each([...AUDIT_READERS, ['an admin', ADMIN] as [string, CognitoAccessTokenPayload]])(
      'IS listed and found by search for %s (the catalogue gives these groups every record)',
      async (_who, caller) => {
        expect(slugsOf(await catalog.list(query(), caller))).toContain(PRIVATE_SLUG);
        expect(slugsOf(await catalog.list(query({ q: 'zephyrine' }), caller))).toEqual([
          PRIVATE_SLUG,
        ]);
      },
    );

    it('is NOT listed for its own host, even when the host asks for their own rows', async () => {
      // The list widens the statuses for a host's own rows, not the
      // visibilities. The host reaches a private dataset by its slug.
      expect(slugsOf(await catalog.list(query(), OWNER))).not.toContain(PRIVATE_SLUG);
      expect(slugsOf(await catalog.list(query({ hostId: OWNER_SUB }), OWNER))).not.toContain(
        PRIVATE_SLUG,
      );
    });
  });

  // --- 2. The record and the manifest -----------------------------------

  describe('dataset record and manifest', () => {
    it.each(OUTSIDERS)('answers 404, as for an unknown slug, to %s', async (_who, caller) => {
      const known = await catalog.detail(PRIVATE_SLUG, caller).catch((e: unknown) => e);
      const unknown = await catalog.detail(UNKNOWN_SLUG, caller).catch((e: unknown) => e);
      expect(known).toBeInstanceOf(NotFoundException);
      expect(unknown).toBeInstanceOf(NotFoundException);
      // Same wording but for the slug the caller typed: nothing tells the two apart.
      expect((known as Error).message.replace(PRIVATE_SLUG, 'X')).toBe(
        (unknown as Error).message.replace(UNKNOWN_SLUG, 'X'),
      );
      await expect(catalog.manifest(PRIVATE_SLUG, caller)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it.each(AUDIT_READERS)(
      'gives the record, the manifest and the names of the files that are not held to %s',
      async (_who, caller) => {
        const detail = await catalog.detail(PRIVATE_SLUG, caller);
        expect(detail.name).toBe(PRIVATE_NAME);
        expect(detail.hostId).toBe(OWNER_SUB);
        // The held file is absent for them, from the list and from the manifest.
        expect(detail.distributions.map((d) => d.id)).toEqual([clearDistributionId]);
        const manifest = JSON.stringify(await catalog.manifest(PRIVATE_SLUG, caller));
        expect(manifest).toContain('exam-001-slice-001.dcm');
        expect(manifest).not.toContain('exam-002-slice-001.dcm');
      },
    );

    it('gives everything, held files included, to an admin and to the owning host', async () => {
      for (const caller of [ADMIN, OWNER]) {
        const detail = await catalog.detail(PRIVATE_SLUG, caller);
        expect(detail.distributions.map((d) => d.id).sort()).toEqual(
          [clearDistributionId, heldDistributionId].sort(),
        );
      }
    });

    it('answers 404 to the owning host when their token does not carry the host group', async () => {
      // The record is gated on the group; the bytes, below, are not.
      await expect(catalog.detail(PRIVATE_SLUG, OWNER_WITHOUT_HOST_GROUP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // --- 3. Federation, 5. capabilities -----------------------------------

  describe('surfaces that take no caller', () => {
    it('is not in the Croissant catalogue index offered to federation peers', async () => {
      const index = await catalog.federationIndex('https://oci.example');
      const names = index.dataset.map((d) => d.name);
      expect(names).toContain('Public control');
      // RESTRICTED records are not offered to peers either.
      expect(names).toEqual(['Public control']);
      expect(JSON.stringify(index)).not.toContain('ephyrine');
    });

    it('is not in the capabilities document, which carries no dataset at all', () => {
      const document = JSON.stringify(new CapabilitiesService().document());
      for (const slug of [PRIVATE_SLUG, PUBLIC_SLUG, RESTRICTED_SLUG]) {
        expect(document).not.toContain(slug);
      }
      expect(document).not.toContain('ephyrine');
    });
  });

  // --- 6. Bytes ----------------------------------------------------------

  describe('files', () => {
    const everyoneButHostAndAdmin: Array<[string, CognitoAccessTokenPayload | undefined]> = [
      ...OUTSIDERS,
      ...AUDIT_READERS,
    ];

    it.each(everyoneButHostAndAdmin)(
      'refuses a file address, the archive and the bytes gate to %s',
      async (_who, caller) => {
        await expect(
          storage.getDownloadUrl({
            slug: PRIVATE_SLUG,
            distributionId: clearDistributionId,
            user: caller,
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          bulk.plan({ slug: PRIVATE_SLUG, includeManifest: true, user: caller }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        // The gate the DICOM series endpoints go through as well.
        await expect(
          storage.authoriseDatasetBytes({
            datasetId: privateId,
            requiresAccess: false,
            user: caller,
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it.each(OUTSIDERS)(
      'KNOWN: answers 403 for the private slug and 404 for an unknown one to %s, which confirms the slug exists',
      async (_who, caller) => {
        // Today's behaviour on the two download routes, pinned and not
        // changed here. It tells a caller who guesses a slug that a
        // dataset by that name exists; nothing else. Mitigation until
        // the routes answer alike: a slug that cannot be guessed.
        await expect(
          bulk.plan({ slug: PRIVATE_SLUG, includeManifest: false, user: caller }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          bulk.plan({ slug: UNKNOWN_SLUG, includeManifest: false, user: caller }),
        ).rejects.toBeInstanceOf(NotFoundException);
        // The single-file route needs a distribution id as well, which
        // an outsider has no way to learn: an invented one answers 404.
        await expect(
          storage.getDownloadUrl({
            slug: PRIVATE_SLUG,
            distributionId: randomUUID(),
            user: caller,
          }),
        ).rejects.toBeInstanceOf(NotFoundException);
      },
    );

    it('an approved access request does not open a PRIVATE dataset', async () => {
      const request = await prisma.accessRequest.create({
        data: {
          datasetId: privateId,
          requesterId: APPROVED_SUB,
          justification: 'Approved by hand, to show that approval is not read for PRIVATE.',
          status: 'APPROVED',
        },
      });
      await expect(
        storage.getDownloadUrl({
          slug: PRIVATE_SLUG,
          distributionId: clearDistributionId,
          user: APPROVED,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await prisma.accessRequest.delete({ where: { id: request.id } });
    });

    it('gives a signed address to the owning host and to an admin, held file included', async () => {
      for (const caller of [OWNER, ADMIN, OWNER_WITHOUT_HOST_GROUP]) {
        for (const distributionId of [clearDistributionId, heldDistributionId]) {
          const url = await storage.getDownloadUrl({
            slug: PRIVATE_SLUG,
            distributionId,
            user: caller,
          });
          expect(url).toContain('X-Amz-Signature=');
        }
      }
    });
  });

  // --- 8. Access requests and the agreement preview ----------------------

  describe('access requests and the data use agreement', () => {
    it.each(SIGNED_IN_OUTSIDERS)(
      'answers 404, as for an unknown slug, when %s asks for access, and stores nothing',
      async (_who, caller) => {
        const known = await accessRequests
          .create(PRIVATE_SLUG, { attestations: ATTESTATIONS }, caller)
          .catch((e: unknown) => e);
        const unknown = await accessRequests
          .create(UNKNOWN_SLUG, { attestations: ATTESTATIONS }, caller)
          .catch((e: unknown) => e);
        expect(known).toBeInstanceOf(NotFoundException);
        expect((known as Error).message.replace(PRIVATE_SLUG, 'X')).toBe(
          (unknown as Error).message.replace(UNKNOWN_SLUG, 'X'),
        );
        // Before the fix the request was stored, and this list then
        // returned the dataset's name, DUO terms and tier to the caller.
        expect(JSON.stringify(await accessRequests.listOwn(caller))).not.toContain('ephyrine');
        expect(await prisma.accessRequest.count({ where: { datasetId: privateId } })).toBe(0);
      },
    );

    it('still takes a request on a RESTRICTED dataset', async () => {
      const created = await accessRequests.create(
        RESTRICTED_SLUG,
        { attestations: ATTESTATIONS },
        PARTICIPANT,
      );
      expect(created.id).toEqual(expect.any(String));
      const own = await accessRequests.listOwn(PARTICIPANT);
      expect(own.map((r) => r.dataset.slug)).toEqual([RESTRICTED_SLUG]);
    });

    it.each(SIGNED_IN_OUTSIDERS)(
      'answers 404, as for an unknown slug, when %s asks for the agreement preview',
      async (_who, caller) => {
        const known = await dua
          .previewFor({ ...DUA_BODY, datasetSlug: PRIVATE_SLUG }, caller)
          .catch((e: unknown) => e);
        const unknown = await dua
          .previewFor({ ...DUA_BODY, datasetSlug: UNKNOWN_SLUG }, caller)
          .catch((e: unknown) => e);
        // Before the fix the preview rendered the DUO terms, the
        // commercial terms and the first domain of the e-mail allowlist.
        expect(known).toBeInstanceOf(NotFoundException);
        expect((known as Error).message.replace(PRIVATE_SLUG, 'X')).toBe(
          (unknown as Error).message.replace(UNKNOWN_SLUG, 'X'),
        );
      },
    );

    it.each(AUDIT_READERS)(
      'answers 404 on the agreement preview to %s, who is neither host nor admin',
      async (_who, caller) => {
        await expect(
          dua.previewFor({ ...DUA_BODY, datasetSlug: PRIVATE_SLUG }, caller),
        ).rejects.toBeInstanceOf(NotFoundException);
      },
    );

    it('renders the agreement preview for the owning host and for an admin', async () => {
      for (const caller of [OWNER, OWNER_WITHOUT_HOST_GROUP, ADMIN]) {
        const preview = await dua.previewFor({ ...DUA_BODY, datasetSlug: PRIVATE_SLUG }, caller);
        expect(preview.markdown).toContain(PRIVATE_DOMAIN);
      }
    });

    it('still renders the agreement preview of a RESTRICTED dataset for any signed-in account', async () => {
      const preview = await dua.previewFor(
        { ...DUA_BODY, datasetSlug: RESTRICTED_SLUG },
        PARTICIPANT,
      );
      expect(preview.templateId).toBe('dua-researcher');
    });

    it.each(SIGNED_IN_OUTSIDERS)(
      'KNOWN: the request inbox of the dataset answers 403 to %s and 404 for an unknown slug',
      async (_who, caller) => {
        // Existence of the slug only, as on the download routes. Pinned.
        await expect(accessRequests.listForDataset(PRIVATE_SLUG, caller)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        await expect(accessRequests.listForDataset(UNKNOWN_SLUG, caller)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      },
    );
  });

  // --- 9. Annotation ------------------------------------------------------

  describe('an annotation campaign on the dataset', () => {
    it('KNOWN: is listed with its name, description and dataset id to every signed-in account', async () => {
      // `GET /v2/annotation/campaigns` and `/:slug` are behind sign-in
      // only, and the service takes no caller: there is nothing to
      // filter on. What a campaign on the sample shows to an account
      // outside the workshop is what its author wrote in the name and
      // the description, plus the dataset's id. Not the dataset's name,
      // slug or files.
      const tool = await prisma.annotationToolIntegration.findFirstOrThrow();
      await prisma.annotationCampaign.create({
        data: {
          slug: 'reading-exercise-658',
          name: 'Reading exercise',
          description: 'Head CT, one answer per exam.',
          taskKind: 'CLASSIFICATION',
          datasetId: privateId,
          toolIntegrationId: tool.id,
          outputLicense: 'CUSTOM_RESTRICTED',
          workflowConfig: { nAnnotators: 3 },
          createdById: OWNER_SUB,
        },
      });

      expect(campaigns.list).toHaveLength(0);
      expect(campaigns.detail).toHaveLength(1);
      const listed = (await campaigns.list()).items.find((c) => c.slug === 'reading-exercise-658');
      expect(listed).toMatchObject({ name: 'Reading exercise', datasetId: privateId });
      const serialised = JSON.stringify([listed, await campaigns.detail('reading-exercise-658')]);
      expect(serialised).not.toContain(PRIVATE_SLUG);
      expect(serialised).not.toContain('ephyrine');
    });
  });

  // --- What option (b) would show: the RESTRICTED control ----------------

  describe('for comparison, a RESTRICTED dataset', () => {
    it('is absent for a signed-out visitor and for a signed-in account with no group', async () => {
      for (const caller of [ANONYMOUS, NO_GROUP]) {
        expect(slugsOf(await catalog.list(query(), caller))).not.toContain(RESTRICTED_SLUG);
        await expect(catalog.detail(RESTRICTED_SLUG, caller)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      }
    });

    it('shows its record, its manifest and every file name to any account with a group, approved or not', async () => {
      for (const caller of [PARTICIPANT, ANNOTATOR, OTHER_HOST]) {
        expect(slugsOf(await catalog.list(query(), caller))).toContain(RESTRICTED_SLUG);
        const detail = await catalog.detail(RESTRICTED_SLUG, caller);
        expect(detail.distributions.map((d) => d.filename)).toEqual(['gated-001.dcm']);
        expect(JSON.stringify(await catalog.manifest(RESTRICTED_SLUG, caller))).toContain(
          'gated-001.dcm',
        );
      }
    });

    it('gives its files only to the host, an admin, or an account with an approved request', async () => {
      const args = { slug: RESTRICTED_SLUG, distributionId: restrictedDistributionId };
      for (const caller of [ANONYMOUS, NO_GROUP, ANNOTATOR, OTHER_HOST, REGULATOR, SUPERVISOR]) {
        await expect(storage.getDownloadUrl({ ...args, user: caller })).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      }
      const restricted = await prisma.dataset.findUniqueOrThrow({
        where: { slug: RESTRICTED_SLUG },
      });
      await prisma.accessRequest.create({
        data: {
          datasetId: restricted.id,
          requesterId: APPROVED_SUB,
          justification: 'Approved for the comparison.',
          status: 'APPROVED',
        },
      });
      for (const caller of [APPROVED, OWNER, ADMIN]) {
        expect(await storage.getDownloadUrl({ ...args, user: caller })).toContain(
          'X-Amz-Signature=',
        );
      }
    });
  });
});
