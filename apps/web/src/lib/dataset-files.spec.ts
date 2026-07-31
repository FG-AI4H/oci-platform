import { describe, expect, it } from 'vitest';
import type { Distribution } from '@oci/shared-types';
import { isPlatformHosted, isPreviewableImage, summariseBulkDownload } from './dataset-files';

function dist(over: Partial<Distribution> = {}): Distribution {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    croissantId: '11111111-1111-4111-8111-111111111111',
    filename: 'IDRiD_001.jpg',
    contentUrl:
      '/v2/catalog/datasets/idrid-grading-demo/distributions/11111111-1111-4111-8111-111111111111/download',
    contentType: 'image/jpeg',
    contentSizeBytes: 1000,
    contentHash: null,
    requiresAccess: false,
    ...over,
  };
}

describe('isPlatformHosted', () => {
  it('accepts the relative gated-download path the API writes', () => {
    expect(isPlatformHosted('/v2/catalog/datasets/x/distributions/y/download')).toBe(true);
  });

  it('rejects absolute upstream URLs and missing URLs', () => {
    expect(isPlatformHosted('https://example.org/data/scan.nii.gz')).toBe(false);
    expect(isPlatformHosted(null)).toBe(false);
    expect(isPlatformHosted('')).toBe(false);
  });
});

describe('isPreviewableImage', () => {
  it('previews a hosted, ungated image', () => {
    expect(isPreviewableImage(dist())).toBe(true);
    expect(isPreviewableImage(dist({ contentType: 'image/png' }))).toBe(true);
  });

  it('refuses non-image content types', () => {
    expect(isPreviewableImage(dist({ contentType: 'text/csv' }))).toBe(false);
    expect(isPreviewableImage(dist({ contentType: 'application/dicom' }))).toBe(false);
    expect(isPreviewableImage(dist({ contentType: 'application/zip' }))).toBe(false);
  });

  it('refuses access-gated files — a preview would 403', () => {
    expect(isPreviewableImage(dist({ requiresAccess: true }))).toBe(false);
  });

  it('refuses upstream-hosted images — we have no bytes to sign', () => {
    expect(isPreviewableImage(dist({ contentUrl: 'https://example.org/fundus.jpg' }))).toBe(false);
    expect(isPreviewableImage(dist({ contentUrl: null }))).toBe(false);
  });
});

describe('summariseBulkDownload', () => {
  it('counts every hosted, ungated file as included', () => {
    const s = summariseBulkDownload([dist(), dist(), dist()]);
    expect(s).toMatchObject({
      includedCount: 3,
      gatedCount: 0,
      upstreamCount: 0,
      totalCount: 3,
      knownBytes: 3000,
      unknownSizeCount: 0,
    });
  });

  it('splits gated, upstream and included into buckets that sum to the total', () => {
    const s = summariseBulkDownload([
      dist(),
      dist({ requiresAccess: true }),
      dist({ contentUrl: 'https://example.org/scan.dcm' }),
      dist({ contentUrl: null }),
    ]);
    expect(s.includedCount).toBe(1);
    expect(s.gatedCount).toBe(1);
    expect(s.upstreamCount).toBe(2);
    expect(s.includedCount + s.gatedCount + s.upstreamCount).toBe(s.totalCount);
  });

  it('counts an access-gated file as gated even when the platform hosts it', () => {
    // Reason ordering matters: "request access" is the action the user
    // can take, so it wins over "hosted upstream" in the explanation.
    const s = summariseBulkDownload([dist({ requiresAccess: true })]);
    expect(s).toMatchObject({ gatedCount: 1, upstreamCount: 0, includedCount: 0 });
  });

  it('sums only declared sizes and reports how many were undeclared', () => {
    const s = summariseBulkDownload([
      dist({ contentSizeBytes: 1500 }),
      dist({ contentSizeBytes: null }),
      dist({ contentSizeBytes: null }),
      // Excluded rows never contribute bytes, declared or not.
      dist({ requiresAccess: true, contentSizeBytes: 9_000_000 }),
    ]);
    expect(s.knownBytes).toBe(1500);
    expect(s.unknownSizeCount).toBe(2);
    expect(s.includedCount).toBe(3);
  });

  it('reports nothing eligible when every file is gated or upstream', () => {
    const s = summariseBulkDownload([
      dist({ requiresAccess: true }),
      dist({ contentUrl: 'https://example.org/a.jpg' }),
    ]);
    expect(s.includedCount).toBe(0);
    expect(s.totalCount).toBe(2);
  });

  it('handles a dataset with no distributions', () => {
    expect(summariseBulkDownload([])).toMatchObject({ includedCount: 0, totalCount: 0 });
  });
});
