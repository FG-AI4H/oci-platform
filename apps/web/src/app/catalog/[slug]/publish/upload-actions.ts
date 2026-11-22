'use server';

import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import {
  CompleteUploadRequestSchema,
  DatasetSlugSchema,
  InitUploadRequestSchema,
  type InitUploadResponse,
  type PartUrlResponse,
  type UploadedDistribution,
} from '@oci/shared-types';
import { fetchAsUser } from '../../../../lib/api-action';
import { isHost } from '../../../../lib/groups';
import { sessionForAction } from '../../../../lib/session-recovery';

/**
 * The four control calls of a multipart upload, made on the server on
 * behalf of the browser (#643).
 *
 * The browser used to make these calls itself, with the access token
 * handed to the uploader as a prop. That put a bearer token in the page
 * and left a long upload holding a token nobody could renew. Now the
 * browser asks these actions; they read the session, call the API and
 * hand back only what the upload needs: an upload id, a presigned URL
 * per part, the stored file. The bytes still go from the browser
 * straight to storage through the presigned URLs.
 *
 * An API refusal is returned, not thrown: a thrown error reaches the
 * client with its message removed in production, and the uploader shows
 * the message.
 */
export type UploadCallResult<T> = { ok: true; data: T } | { ok: false; error: string };

const UploadRefSchema = z.object({
  uploadId: z.string().min(1).max(1024),
  key: z.string().min(1).max(1024),
});
export type UploadRef = z.infer<typeof UploadRefSchema>;

const PartNumberSchema = z.number().int().min(1).max(10000);

const UploadedFileSchema = InitUploadRequestSchema.pick({
  contentType: true,
  contentSize: true,
  sha256: true,
});
export type UploadedFile = z.infer<typeof UploadedFileSchema>;

interface ApiCall {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
}

/**
 * Check the caller and the slug, then make one API call under
 * `/v2/catalog/datasets/<slug>/uploads`. `build` returns `null` when
 * the arguments the browser sent did not validate.
 */
async function call<T>(
  slugRaw: string,
  build: (uploadsUrl: string) => ApiCall | null,
  read: (res: Response) => Promise<T>,
): Promise<UploadCallResult<T>> {
  // Resolving the language costs a preferences read; only an error
  // message needs it, and the part-URL action runs once per part.
  const t = () => getTranslations('Publish');
  const session = await sessionForAction();
  if (!session?.user || !isHost(session)) {
    return { ok: false, error: (await t())('errors.onlyHostsUpload') };
  }
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { ok: false, error: (await t())('errors.apiBaseUrlMissing') };

  const slug = DatasetSlugSchema.safeParse(slugRaw);
  const request = slug.success
    ? build(`${base}/v2/catalog/datasets/${encodeURIComponent(slug.data)}/uploads`)
    : null;
  if (!slug.success || request === null) {
    return { ok: false, error: (await t())('errors.invalidUploadRequest') };
  }

  const res = await fetchAsUser(
    request.url,
    {
      method: request.method,
      ...(request.body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) }),
      cache: 'no-store',
    },
    { returnTo: `/catalog/${encodeURIComponent(slug.data)}/publish` },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `API ${res.status} ${res.statusText}: ${text.slice(0, 300)}` };
  }
  return { ok: true, data: await read(res) };
}

export async function initUploadAction(
  slug: string,
  request: unknown,
): Promise<UploadCallResult<InitUploadResponse>> {
  const parsed = InitUploadRequestSchema.safeParse(request);
  return call(
    slug,
    (uploadsUrl) =>
      parsed.success ? { url: uploadsUrl, method: 'POST', body: parsed.data } : null,
    async (res) => (await res.json()) as InitUploadResponse,
  );
}

export async function uploadPartUrlAction(
  slug: string,
  ref: unknown,
  partNumber: unknown,
): Promise<UploadCallResult<PartUrlResponse>> {
  const upload = UploadRefSchema.safeParse(ref);
  const part = PartNumberSchema.safeParse(partNumber);
  return call(
    slug,
    (uploadsUrl) =>
      upload.success && part.success
        ? {
            url: `${uploadsUrl}/${encodeURIComponent(upload.data.uploadId)}/parts/${part.data}/url?key=${encodeURIComponent(upload.data.key)}`,
            method: 'GET',
          }
        : null,
    async (res) => (await res.json()) as PartUrlResponse,
  );
}

export async function completeUploadAction(
  slug: string,
  ref: unknown,
  file: unknown,
  body: unknown,
): Promise<UploadCallResult<UploadedDistribution>> {
  const upload = UploadRefSchema.safeParse(ref);
  const uploaded = UploadedFileSchema.safeParse(file);
  const parts = CompleteUploadRequestSchema.safeParse(body);
  return call(
    slug,
    (uploadsUrl) => {
      if (!upload.success || !uploaded.success || !parts.success) return null;
      const query = new URLSearchParams({
        key: upload.data.key,
        contentType: uploaded.data.contentType,
        contentSize: String(uploaded.data.contentSize),
      });
      if (uploaded.data.sha256) query.set('sha256', uploaded.data.sha256);
      return {
        url: `${uploadsUrl}/${encodeURIComponent(upload.data.uploadId)}/complete?${query.toString()}`,
        method: 'POST',
        body: parts.data,
      };
    },
    async (res) => (await res.json()) as UploadedDistribution,
  );
}

export async function abortUploadAction(
  slug: string,
  ref: unknown,
): Promise<UploadCallResult<null>> {
  const upload = UploadRefSchema.safeParse(ref);
  return call(
    slug,
    (uploadsUrl) =>
      upload.success
        ? {
            url: `${uploadsUrl}/${encodeURIComponent(upload.data.uploadId)}/abort?key=${encodeURIComponent(upload.data.key)}`,
            method: 'POST',
          }
        : null,
    async () => null,
  );
}
