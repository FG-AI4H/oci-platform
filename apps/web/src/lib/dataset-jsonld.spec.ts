import { describe, expect, it } from 'vitest';
import type { DatasetDetail } from '@oci/shared-types';
import { datasetJsonLd } from './dataset-jsonld';

const baseDetail: DatasetDetail = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'rsna-pneumonia-2018',
  name: 'RSNA Pneumonia 2018',
  description: 'Chest X-ray pneumonia detection benchmark.',
  visibility: 'PUBLIC',
  status: 'PUBLISHED',
  conformanceVersion: '1.1',
  latestVersion: '1.0.0',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  croissant: {
    '@context': ['https://schema.org/', { sc: 'https://schema.org/' }],
    '@type': 'sc:Dataset',
    name: 'RSNA Pneumonia 2018',
    description: 'Chest X-ray pneumonia detection benchmark.',
    license: { name: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    url: 'https://www.kaggle.com/c/rsna-pneumonia-detection-challenge',
    citeAs: 'Shih G, et al. RSNA Pneumonia Detection Challenge. 2018.',
    keywords: ['radiology', 'chest x-ray', 'pneumonia'],
    'bio:imagingModality': [{ name: 'X-ray' }],
    'bio:bodyRegion': [{ name: 'Chest' }],
    'bio:diseaseCondition': [{ name: 'Pneumonia' }],
  },
  versions: [
    {
      id: '00000000-0000-0000-0000-000000000010',
      version: '1.0.0',
      croissantHash: 'abc',
      notes: null,
      publishedAt: '2026-04-15T00:00:00.000Z',
    },
  ],
  distributions: [
    {
      id: '00000000-0000-0000-0000-000000000020',
      croissantId: 'images.zip',
      contentUrl: 'https://example.org/images.zip',
      contentType: 'application/zip',
      contentSizeBytes: 1024,
      contentHash: 'deadbeef',
      requiresAccess: false,
    },
  ],
  sourceCatalog: null,
  originUrl: null,
  duoTerms: [],
};

describe('datasetJsonLd', () => {
  it('emits a Schema.org Dataset shape with canonical URLs', () => {
    const out = datasetJsonLd(baseDetail, 'https://oci.ai4h.net');
    expect(out['@context']).toBe('https://schema.org/');
    expect(out['@type']).toBe('Dataset');
    expect(out['@id']).toBe('https://oci.ai4h.net/catalog/rsna-pneumonia-2018');
    expect(out.url).toBe('https://oci.ai4h.net/catalog/rsna-pneumonia-2018');
    expect(out.mainEntityOfPage).toBe('https://oci.ai4h.net/catalog/rsna-pneumonia-2018');
    expect(out.name).toBe('RSNA Pneumonia 2018');
    expect(out.identifier).toBe('rsna-pneumonia-2018');
    expect(out.version).toBe('1.0.0');
  });

  it('flattens the license object to its URL when available', () => {
    const out = datasetJsonLd(baseDetail, 'https://oci.ai4h.net');
    expect(out.license).toBe('https://creativecommons.org/licenses/by/4.0/');
  });

  it('merges Croissant keywords with BIOCroissant terms (de-duped)', () => {
    const out = datasetJsonLd(baseDetail, 'https://oci.ai4h.net');
    expect(out.keywords).toEqual([
      'radiology',
      'chest x-ray',
      'pneumonia',
      'X-ray',
      'Chest',
      'Pneumonia',
    ]);
  });

  it('appends the Croissant manifest as a distribution[]', () => {
    const out = datasetJsonLd(baseDetail, 'https://oci.ai4h.net');
    const dist = out.distribution as Array<Record<string, unknown>>;
    const manifest = dist.find((d) => d.encodingFormat === 'application/ld+json');
    expect(manifest?.contentUrl).toBe('https://oci.ai4h.net/catalog/rsna-pneumonia-2018/croissant');
  });

  it('omits restricted distributions from the public JSON-LD', () => {
    const detail: DatasetDetail = {
      ...baseDetail,
      distributions: [
        { ...baseDetail.distributions[0]!, requiresAccess: true },
        { ...baseDetail.distributions[0]!, id: '00000000-0000-0000-0000-000000000021' },
      ],
    };
    const out = datasetJsonLd(detail, 'https://oci.ai4h.net');
    const dist = out.distribution as Array<Record<string, unknown>>;
    // Only the second (non-restricted) data file + the manifest itself.
    expect(dist).toHaveLength(2);
    expect(dist[0]?.encodingFormat).toBe('application/zip');
    expect(dist[1]?.encodingFormat).toBe('application/ld+json');
  });

  it('preserves homepage URL via sameAs when distinct from canonical', () => {
    const out = datasetJsonLd(baseDetail, 'https://oci.ai4h.net');
    expect(out.sameAs).toEqual(['https://www.kaggle.com/c/rsna-pneumonia-detection-challenge']);
  });

  it('marks isAccessibleForFree based on distribution gating', () => {
    expect(datasetJsonLd(baseDetail, 'https://oci.ai4h.net').isAccessibleForFree).toBe(true);
    const restricted: DatasetDetail = {
      ...baseDetail,
      distributions: [{ ...baseDetail.distributions[0]!, requiresAccess: true }],
    };
    expect(datasetJsonLd(restricted, 'https://oci.ai4h.net').isAccessibleForFree).toBe(false);
  });
});
