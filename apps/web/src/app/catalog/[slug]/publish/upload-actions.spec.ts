import type { Session } from 'next-auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessionForAction: vi.fn(),
  fetchAsUser: vi.fn(),
}));
vi.mock('../../../../lib/session-recovery', () => ({ sessionForAction: mocks.sessionForAction }));
vi.mock('../../../../lib/api-action', () => ({ fetchAsUser: mocks.fetchAsUser }));

import {
  abortUploadAction,
  completeUploadAction,
  initUploadAction,
  uploadPartUrlAction,
} from './upload-actions';

const API = 'http://api.test';
const UPLOADS = `${API}/v2/catalog/datasets/chest-xr/uploads`;
const RETURN_TO = { returnTo: '/catalog/chest-xr/publish' };
const REF = { uploadId: 'up/1 2', key: 'datasets/chest-xr/a b.dcm' };

const host: Session = { user: { id: 'u1' }, groups: ['host'], expires: '' };
const participant: Session = { user: { id: 'u2' }, groups: ['participant'], expires: '' };

function apiAnswers(status: number, body: unknown = {}): void {
  mocks.fetchAsUser.mockResolvedValue(
    new Response(status === 204 ? null : JSON.stringify(body), { status }),
  );
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', API);
  mocks.sessionForAction.mockReset().mockResolvedValue(host);
  mocks.fetchAsUser.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('upload control calls made for the browser', () => {
  it('starts an upload: validated body, to this dataset, as the caller', async () => {
    apiAnswers(201, { uploadId: 'up-1', key: 'k', partSize: 16_777_216 });
    const result = await initUploadAction('chest-xr', {
      filename: 'study.dcm',
      contentType: 'application/dicom',
      contentSize: 1234,
      injected: 'dropped',
    });

    expect(result).toEqual({
      ok: true,
      data: { uploadId: 'up-1', key: 'k', partSize: 16_777_216 },
    });
    expect(mocks.fetchAsUser).toHaveBeenCalledWith(
      UPLOADS,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'study.dcm',
          contentType: 'application/dicom',
          contentSize: 1234,
        }),
        cache: 'no-store',
      },
      RETURN_TO,
    );
  });

  it('asks for a part URL, with the upload id and key encoded into the path and query', async () => {
    apiAnswers(200, { url: 'https://storage.test/presigned', expiresAt: '2026-12-17T10:00:00Z' });
    const result = await uploadPartUrlAction('chest-xr', REF, 7);

    expect(result).toEqual({
      ok: true,
      data: { url: 'https://storage.test/presigned', expiresAt: '2026-12-17T10:00:00Z' },
    });
    expect(mocks.fetchAsUser).toHaveBeenCalledWith(
      `${UPLOADS}/up%2F1%202/parts/7/url?key=datasets%2Fchest-xr%2Fa%20b.dcm`,
      { method: 'GET', cache: 'no-store' },
      RETURN_TO,
    );
  });

  it('completes an upload with the parts and the file facts', async () => {
    const stored = { distributionId: 'd1', name: 'a b.dcm', contentUrl: '/v2/x' };
    apiAnswers(201, stored);
    const sha256 = 'a'.repeat(64);
    const result = await completeUploadAction(
      'chest-xr',
      REF,
      { contentType: 'application/dicom', contentSize: 1234, sha256 },
      { parts: [{ partNumber: 1, etag: '"abc"' }] },
    );

    expect(result).toEqual({ ok: true, data: stored });
    const [url, init] = mocks.fetchAsUser.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/v2/catalog/datasets/chest-xr/uploads/up%2F1%202/complete');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      key: REF.key,
      contentType: 'application/dicom',
      contentSize: '1234',
      sha256,
    });
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ parts: [{ partNumber: 1, etag: '"abc"' }] }));
  });

  it('aborts an upload', async () => {
    apiAnswers(204);
    expect(await abortUploadAction('chest-xr', REF)).toEqual({ ok: true, data: null });
    expect(mocks.fetchAsUser).toHaveBeenCalledWith(
      `${UPLOADS}/up%2F1%202/abort?key=datasets%2Fchest-xr%2Fa%20b.dcm`,
      { method: 'POST', cache: 'no-store' },
      RETURN_TO,
    );
  });

  it('refuses a caller who is not a host, without calling the API', async () => {
    mocks.sessionForAction.mockResolvedValue(participant);
    expect(await uploadPartUrlAction('chest-xr', REF, 1)).toEqual({
      ok: false,
      error: 'Only hosts can upload files.',
    });
    expect(mocks.fetchAsUser).not.toHaveBeenCalled();
  });

  it.each([
    ['a slug that is a path', () => uploadPartUrlAction('../admin', REF, 1)],
    ['a part number of zero', () => uploadPartUrlAction('chest-xr', REF, 0)],
    ['a part number that is not a number', () => uploadPartUrlAction('chest-xr', REF, '1/../x')],
    ['an upload reference with no key', () => abortUploadAction('chest-xr', { uploadId: 'u' })],
    ['an init request with no file name', () => initUploadAction('chest-xr', { contentSize: 1 })],
    [
      'a checksum that is not one',
      () =>
        completeUploadAction(
          'chest-xr',
          REF,
          { contentType: 'x/y', contentSize: 1, sha256: 'not-hex' },
          { parts: [{ partNumber: 1, etag: 'e' }] },
        ),
    ],
    [
      'a completion with no parts',
      () =>
        completeUploadAction(
          'chest-xr',
          REF,
          { contentType: 'x/y', contentSize: 1 },
          { parts: [] },
        ),
    ],
  ])('refuses %s, without calling the API', async (_name, attempt) => {
    expect(await attempt()).toEqual({ ok: false, error: 'Invalid upload request.' });
    expect(mocks.fetchAsUser).not.toHaveBeenCalled();
  });

  it('returns an API refusal as a message the uploader can show', async () => {
    mocks.fetchAsUser.mockResolvedValue(
      new Response('{"detail":"not the host of this dataset"}', {
        status: 403,
        statusText: 'Forbidden',
      }),
    );
    expect(
      await initUploadAction('chest-xr', {
        filename: 'a',
        contentType: 'x/y',
        contentSize: 1,
      }),
    ).toEqual({
      ok: false,
      error: 'API 403 Forbidden: {"detail":"not the host of this dataset"}',
    });
  });
});
