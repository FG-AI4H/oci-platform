import { manifestWizardInputToCroissant } from '@oci/croissant';
// The Part 10 writer of the header-reading package's own tests. Reached
// by path, not through the package: the web app does not depend on
// `@oci/dicom`.
import { ctSlice } from '../../../../packages/dicom/src/test-support/build-part10';

/**
 * Synthetic DICOM datasets for end-to-end specs (#674): generated here,
 * never a downloaded file, never patient data. Seeded through the
 * upload API as a host, so every file goes through the same header
 * check and index as a real upload.
 *
 * Needs the API in local mode (it accepts the `dev:` bearer) and an
 * S3-compatible store.
 */

export const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const HOST_TOKEN = 'dev:e2e-dicom-host:host';
export const SIZE = 64;

/** Air, a soft-tissue disc with a dense rim, and a ring that grows with the slice. */
function phantom(n: number): Uint8Array {
  const out = new Int16Array(SIZE * SIZE);
  const centre = SIZE / 2;
  const ring = 6 + n;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const r = Math.hypot(x - centre, y - centre);
      let hu = -1000;
      if (r < 28) hu = 40;
      if (r < 28 && r > 25) hu = 700;
      if (Math.abs(r - ring) < 1.5) hu = 300;
      out[y * SIZE + x] = hu;
    }
  }
  return new Uint8Array(out.buffer);
}

/**
 * One CT slice of a series. `extra` adds header elements: a made-up
 * patient code, for instance, which holds the file (ADR-0026). `syntax`
 * declares a transfer syntax; the pixel data stays uncompressed.
 */
export function ctPhantomSlice(
  series: string,
  seriesNumber: number,
  n: number,
  extra: Array<{ tag: string; vr: string; value: string }> = [],
  syntax?: string,
): Uint8Array {
  return ctSlice(
    [
      { tag: '00080018', vr: 'UI', value: `${series}.${n}` },
      ...extra,
      { tag: '0020000e', vr: 'UI', value: series },
      { tag: '00200011', vr: 'IS', value: String(seriesNumber) },
      { tag: '00200013', vr: 'IS', value: String(n) },
      { tag: '00200032', vr: 'DS', value: `-16\\-16\\${n * 2}` },
      { tag: '00280002', vr: 'US', value: 1 },
      { tag: '00280010', vr: 'US', value: SIZE },
      { tag: '00280011', vr: 'US', value: SIZE },
      { tag: '00280101', vr: 'US', value: 16 },
      { tag: '00280102', vr: 'US', value: 15 },
      { tag: '00281052', vr: 'DS', value: '0' },
      { tag: '00281053', vr: 'DS', value: '1' },
      { tag: '7fe00010', vr: 'OW', value: phantom(n) },
    ],
    syntax,
  );
}

export async function hostApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${HOST_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** A public dataset with an empty published version 1.0.0. */
export async function createDicomDataset(slug: string, name: string): Promise<void> {
  await hostApi('/v2/catalog/datasets', {
    method: 'POST',
    body: JSON.stringify({ slug, name, visibility: 'PUBLIC' }),
  });
  await hostApi(`/v2/catalog/datasets/${slug}/versions`, {
    method: 'POST',
    body: JSON.stringify({
      version: '1.0.0',
      croissant: manifestWizardInputToCroissant({
        conformsTo: 'http://mlcommons.org/croissant/1.1',
        name,
        description: 'Synthetic images for an end-to-end test.',
        license: 'https://creativecommons.org/licenses/by/4.0/',
        homepage: 'https://example.org/',
        version: '1.0.0',
        datePublished: '2026-11-20',
        creators: [{ type: 'Organization', name: 'Test' }],
        imagingModality: [],
        bodyRegion: [],
        diseaseCondition: [],
        duoTerms: [],
        distributions: [],
      }),
    }),
  });
}

/** Upload one file to the dataset's latest version, in one part. */
export async function uploadDicom(slug: string, name: string, bytes: Uint8Array): Promise<void> {
  const contentType = 'application/dicom';
  const init = await hostApi<{ uploadId: string; key: string }>(
    `/v2/catalog/datasets/${slug}/uploads`,
    {
      method: 'POST',
      body: JSON.stringify({ filename: name, contentType, contentSize: bytes.length }),
    },
  );
  const uploadId = encodeURIComponent(init.uploadId);
  const part = await hostApi<{ url: string }>(
    `/v2/catalog/datasets/${slug}/uploads/${uploadId}/parts/1/url?key=${encodeURIComponent(init.key)}`,
  );
  const put = await fetch(part.url, { method: 'PUT', body: bytes });
  if (!put.ok) throw new Error(`PUT → ${put.status}`);
  const query = new URLSearchParams({
    key: init.key,
    contentType,
    contentSize: String(bytes.length),
  });
  await hostApi(`/v2/catalog/datasets/${slug}/uploads/${uploadId}/complete?${query}`, {
    method: 'POST',
    body: JSON.stringify({
      parts: [{ partNumber: 1, etag: put.headers.get('etag') }],
      croissantId: name,
    }),
  });
}
