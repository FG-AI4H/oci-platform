import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type { CatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';

/**
 * ADR-0026: a held DICOM file is listed for its host and for platform
 * operators only. The dataset page derives its file list, its preview
 * actions and the size of the archive from this response, so a held
 * file must be absent from it, not merely marked.
 */

const HOST_SUB = '00000000-0000-4000-8000-000000000501';
const OTHER_SUB = '00000000-0000-4000-8000-000000000502';
const DATASET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CLEAN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HELD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function user(sub: string, ...groups: string[]): CognitoAccessTokenPayload {
  return { sub, 'cognito:groups': groups } as unknown as CognitoAccessTokenPayload;
}

let repo: {
  findBySlug: ReturnType<typeof vi.fn>;
  findIdAndHostBySlug: ReturnType<typeof vi.fn>;
  findHeldDistributionIds: ReturnType<typeof vi.fn>;
};
let svc: CatalogService;

beforeEach(() => {
  repo = {
    findBySlug: vi.fn(async () => ({
      id: DATASET_ID,
      slug: 'ct-demo',
      visibility: 'PUBLIC',
      status: 'PUBLISHED',
      croissant: {
        name: 'CT demo',
        distribution: [
          { '@id': 'readme.txt', contentUrl: 'https://example.org/readme.txt' },
          {
            '@id': 'slice-001.dcm',
            sha256: 'cd'.repeat(32),
            contentUrl: `/v2/catalog/datasets/ct-demo/distributions/${HELD_ID}/download`,
          },
        ],
      },
      distributions: [
        { id: CLEAN_ID, filename: 'readme.txt' },
        { id: HELD_ID, filename: 'slice-001.dcm' },
      ],
    })),
    findIdAndHostBySlug: vi.fn(async () => ({ id: DATASET_ID, hostId: HOST_SUB })),
    findHeldDistributionIds: vi.fn(async () => new Set([HELD_ID])),
  };
  svc = new CatalogService(repo as unknown as CatalogRepository);
});

const listed = async (caller?: CognitoAccessTokenPayload) =>
  (await svc.detail('ct-demo', caller)).distributions.map((d) => d.id);

describe('CatalogService.detail — held DICOM files', () => {
  it('leaves a held file out for an anonymous visitor', async () => {
    await expect(listed()).resolves.toEqual([CLEAN_ID]);
    expect(repo.findHeldDistributionIds).toHaveBeenCalledWith(DATASET_ID);
  });

  it.each([
    ['a participant', user(OTHER_SUB, 'participant')],
    ['the host of another dataset', user(OTHER_SUB, 'host')],
    // They see every dataset, and are still not operators.
    ['a regulator', user(OTHER_SUB, 'regulator')],
    ['a supervisor', user(OTHER_SUB, 'supervisor')],
  ])('leaves it out for %s', async (_who, caller) => {
    await expect(listed(caller)).resolves.toEqual([CLEAN_ID]);
  });

  it('lists it for the host of the dataset', async () => {
    await expect(listed(user(HOST_SUB, 'host'))).resolves.toEqual([CLEAN_ID, HELD_ID]);
  });

  it('lists it for the owner even when their token no longer carries the host group', async () => {
    // The download routes go by host id alone; the list must agree, or
    // the owner's own held files would seem to have vanished.
    await expect(listed(user(HOST_SUB, 'participant'))).resolves.toEqual([CLEAN_ID, HELD_ID]);
  });

  it('takes the held file out of the manifest too, name, hash and id', async () => {
    const forVisitor = JSON.stringify((await svc.detail('ct-demo')).croissant);
    expect(forVisitor).not.toContain('slice-001.dcm');
    expect(forVisitor).not.toContain(HELD_ID);
    expect(forVisitor).toContain('readme.txt');

    // `manifest()` is what the standalone manifest route serves.
    expect(JSON.stringify(await svc.manifest('ct-demo'))).not.toContain('slice-001.dcm');
    expect(JSON.stringify(await svc.manifest('ct-demo', user(HOST_SUB, 'host')))).toContain(
      'slice-001.dcm',
    );
  });

  it('lists it for an operator', async () => {
    await expect(listed(user(OTHER_SUB, 'admin'))).resolves.toEqual([CLEAN_ID, HELD_ID]);
    expect(repo.findHeldDistributionIds).not.toHaveBeenCalled();
  });

  it('returns the list untouched when nothing is held', async () => {
    repo.findHeldDistributionIds.mockResolvedValue(new Set());
    await expect(listed()).resolves.toEqual([CLEAN_ID, HELD_ID]);
  });
});
