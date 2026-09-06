import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type { AccessTier, PublishDatasetVersionRequest } from '@oci/shared-types';
import type { CatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';

/**
 * `publishVersion` runs the `bio-prov` layer with the dataset row's
 * access tier, strict (#504). The tier changes the verdict: the same
 * manifest is refused on a SENSITIVE dataset and accepted on an OPEN
 * one. Manifests without the `bio:provenanceProfile` marker never see
 * the layer, whatever the tier.
 */

// UUID-shaped subs short-circuit the UUIDv5 derivation.
const HOST_SUB = '00000000-0000-4000-8000-000000000401';
const DATASET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SLUG = 'fixture-chest-xray-2026-q2';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedFixturesDir = path.resolve(here, '../../../../../packages/database/seed/fixtures');

type Json = Record<string, unknown>;

function user(sub: string, ...groups: string[]): CognitoAccessTokenPayload {
  return { sub, 'cognito:groups': groups } as unknown as CognitoAccessTokenPayload;
}

/**
 * A synthetic clinical manifest that meets every `bio-prov` MUST at
 * SENSITIVE except H5 (ethics approval): P1 organization, P2 dated
 * activity with an agent (P4), H1 site, H2 timeframe, H3 device
 * manufacturer, H4 de-identification matching the declared level, H6
 * label protocol. H5 is a MUST at SENSITIVE and a MAY at OPEN (spec
 * section 3).
 */
function manifestWithoutEthicsApproval(): Json {
  return {
    '@context': {
      '@vocab': 'https://schema.org/',
      sc: 'https://schema.org/',
      cr: 'http://mlcommons.org/croissant/',
      rai: 'http://mlcommons.org/croissant/RAI/',
      prov: 'http://www.w3.org/ns/prov#',
      dct: 'http://purl.org/dc/terms/',
      bio: 'https://oci.ai4h.net/biocroissant/v0.1#',
    },
    '@type': 'sc:Dataset',
    'dct:conformsTo': 'http://mlcommons.org/croissant/1.1',
    name: SLUG,
    description: 'Synthetic chest radiograph manifest for the publish-path provenance test.',
    license: 'https://spdx.org/licenses/CDLA-Permissive-2.0',
    url: `https://example.org/datasets/${SLUG}`,
    creator: { '@type': 'sc:Organization', name: 'Test Hospital' },
    datePublished: '2026-04-01',
    version: '1.0.0',
    distribution: [
      {
        '@type': 'sc:FileObject',
        '@id': 'manifest.csv',
        name: 'manifest.csv',
        contentUrl: `https://example.org/datasets/${SLUG}/manifest.csv`,
        encodingFormat: 'text/csv',
        sha256: '1111111111111111111111111111111111111111111111111111111111111111',
      },
    ],
    'cr:consentCode': [
      {
        '@type': 'sc:DefinedTerm',
        '@id': 'http://purl.obolibrary.org/obo/DUO_0000042',
        termCode: 'DUO_0000042',
        name: 'general research use',
      },
    ],
    'bio:imagingModality': { '@type': 'sc:DefinedTerm', name: 'Plain Radiography' },
    'bio:dataAcquisitionEquipment': [{ manufacturer: 'Siemens Healthineers', model: 'MULTIX' }],
    'bio:anonymizationLevel': 'DEIDENTIFIED',
    'bio:provenanceProfile': 'bio-prov/0.1',
    'prov:wasAttributedTo': [{ '@type': 'prov:Organization', name: 'Test Hospital' }],
    'prov:wasGeneratedBy': {
      '@type': 'prov:Activity',
      '@id': '#collection-2024',
      name: 'Prospective collection of chest radiographs',
      'prov:startedAtTime': '2024-01-01',
      'prov:endedAtTime': '2024-12-31',
      'prov:wasAssociatedWith': { '@type': 'prov:Organization', name: 'Test Hospital' },
    },
    'bio:sourceSite': [{ name: 'Test Hospital, main campus', country: 'US' }],
    'rai:dataCollectionTimeframe': '2024-01-01/2024-12-31',
    'bio:deidentification': {
      '@type': 'prov:Activity',
      method: 'SAFE_HARBOR',
      resultingLevel: 'DEIDENTIFIED',
      'prov:endedAtTime': '2025-01-15',
    },
    'bio:labelProtocol': {
      version: 'CXR pneumonia protocol v3',
      labelScale: 'binary: pneumonia present / absent',
      gradersPerItem: 3,
    },
  };
}

interface RepoMock {
  findIdAndHostBySlug: ReturnType<typeof vi.fn>;
  findDistributionsForAdoption: ReturnType<typeof vi.fn>;
  publishVersion: ReturnType<typeof vi.fn>;
  findBySlug: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let svc: CatalogService;

function datasetRow(accessTier: AccessTier) {
  return {
    id: DATASET_ID,
    hostId: HOST_SUB,
    visibility: 'PUBLIC' as const,
    duoTerms: [],
    modalities: [],
    accessTier,
    emailDomainAllowlist: [],
    commercialUseTerms: 'OK' as const,
    commercialClauses: null,
  };
}

beforeEach(() => {
  repo = {
    findIdAndHostBySlug: vi.fn(),
    findDistributionsForAdoption: vi.fn(async () => []),
    publishVersion: vi.fn(async () => undefined),
    findBySlug: vi.fn(async () => ({ slug: SLUG, id: DATASET_ID })),
  };
  svc = new CatalogService(repo as unknown as CatalogRepository);
});

function request(croissant: unknown): PublishDatasetVersionRequest {
  return { version: '1.0.0', notes: null, croissant } as PublishDatasetVersionRequest;
}

async function publishOn(accessTier: AccessTier, croissant: unknown) {
  repo.findIdAndHostBySlug.mockResolvedValue(datasetRow(accessTier));
  return svc.publishVersion(SLUG, request(croissant), user(HOST_SUB, 'host'));
}

describe('CatalogService.publishVersion — bio-prov at the dataset row’s tier (#504)', () => {
  it('refuses a SENSITIVE dataset whose manifest carries the marker but no ethics approval (H5)', async () => {
    let caught: unknown;
    try {
      await publishOn('SENSITIVE', manifestWithoutEthicsApproval());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const body = (caught as BadRequestException).getResponse() as {
      message: string;
      conformance: string;
      issues: Array<{ code: string; level: string; path: string }>;
    };
    expect(body.message).toBe('Croissant manifest validation failed');
    expect(body.conformance).toBe('croissant-1.1');
    expect(body.issues.map((i) => i.code)).toEqual(['provenance.missing.H5']);
    expect(body.issues[0]).toMatchObject({ level: 'error', path: '/irbApproval' });
    expect(repo.publishVersion).not.toHaveBeenCalled();
  });

  it('publishes the same manifest on an OPEN dataset (H5 is a MAY at OPEN)', async () => {
    await publishOn('OPEN', manifestWithoutEthicsApproval());
    expect(repo.publishVersion).toHaveBeenCalledTimes(1);
    expect(repo.publishVersion.mock.calls[0]?.[0]).toMatchObject({
      datasetId: DATASET_ID,
      version: '1.0.0',
      conformanceVersion: '1.1',
      duoTerms: ['DUO_0000042'],
    });
  });

  it('does not run the layer on a manifest without the marker, even at SENSITIVE', async () => {
    const m = manifestWithoutEthicsApproval();
    delete m['bio:provenanceProfile'];
    await publishOn('SENSITIVE', m);
    expect(repo.publishVersion).toHaveBeenCalledTimes(1);
  });

  it('the seeded oci-demo-chest-xr manifest (no marker) publishes at SENSITIVE unchanged', async () => {
    const m = JSON.parse(
      readFileSync(path.join(seedFixturesDir, 'oci-demo-chest-xr', 'manifest.json'), 'utf8'),
    ) as Json;
    await publishOn('SENSITIVE', m);
    expect(repo.publishVersion).toHaveBeenCalledTimes(1);
  });
});
