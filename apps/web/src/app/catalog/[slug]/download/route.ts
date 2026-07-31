import { NextResponse } from 'next/server';
import { auth } from '../../../../auth';

/**
 * Proxies the bulk dataset archive from the API
 * (`GET /v2/catalog/datasets/:slug/download`) under the web origin, the
 * same way `../croissant/route.ts` proxies the manifest and
 * `../distributions/[distributionId]/download/route.ts` proxies a single
 * file: a plain `<a href>` can't carry a Bearer token, so the browser
 * hits this handler and we forward the NextAuth-attached Cognito access
 * token server-side.
 *
 * The response body is streamed straight through — the archive is built
 * on the fly by the API (`yazl`, one S3 object in flight at a time) and
 * may be up to `OCI_BULK_DOWNLOAD_MAX_BYTES` (2 GiB by default), so it
 * must never be buffered here.
 *
 * `?manifest=true` adds croissant.json to the archive. The API rejects
 * anything other than the two literals with a 400, so the flag is
 * normalised to `true`/`false` before forwarding.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return NextResponse.json({ message: 'NEXT_PUBLIC_API_BASE_URL not set' }, { status: 500 });
  }

  const includeManifest = new URL(req.url).searchParams.get('manifest') === 'true';

  const session = await auth();
  const headers: Record<string, string> = { Accept: 'application/zip' };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const upstream = await fetch(
    `${base}/v2/catalog/datasets/${encodeURIComponent(slug)}/download?manifest=${includeManifest ? 'true' : 'false'}`,
    { headers, cache: 'no-store' },
  );

  if (!upstream.ok || upstream.body === null) {
    return NextResponse.json(
      { message: await explain(upstream), status: upstream.status },
      { status: upstream.status === 200 ? 502 : upstream.status },
    );
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/zip',
      'Content-Disposition':
        upstream.headers.get('content-disposition') ?? `attachment; filename="${slug}.zip"`,
      // Assembled per request (timestamped notices, live eligibility).
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Plain-language message for the failure cases the bulk route can
 * return. The API's own `message` is preferred where it is safe and
 * specific (409 explains the eligibility rule, 413 quotes the cap);
 * everything else gets copy aimed at the person who clicked.
 */
async function explain(upstream: Response): Promise<string> {
  const fromApi = await apiMessage(upstream);
  switch (upstream.status) {
    case 401:
    case 403:
      return 'Sign in or request access to download this dataset.';
    case 404:
      return 'Dataset not found, not visible to you, or not published yet.';
    case 409:
      return (
        fromApi ??
        'This dataset has no files the platform can bundle. Files that need approved access, ' +
          'or that the original publisher hosts, are never included in the archive.'
      );
    case 413:
      return (
        fromApi ??
        'This dataset is too large to stream as a single archive. Download the files individually.'
      );
    default:
      return (
        fromApi ?? 'The archive could not be built. Try again, or download files individually.'
      );
  }
}

async function apiMessage(upstream: Response): Promise<string | null> {
  const raw = await upstream.text().catch(() => '');
  if (raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      // The bulk route throws Nest exceptions with an object payload,
      // so the body is `{ message, slug, reason, … }`. `detail` is
      // accepted too, for the day a problem-details filter lands.
      const body = parsed as { message?: unknown; detail?: unknown };
      for (const candidate of [body.message, body.detail]) {
        if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
      }
    }
  } catch {
    // Not JSON — fall through to the caller's own copy.
  }
  return null;
}
