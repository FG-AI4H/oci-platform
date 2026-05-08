import { NextResponse } from 'next/server';
import { auth } from '../../../../../../auth';

/**
 * Proxies a gated download for a platform-hosted distribution.
 *
 * The browser can't attach a Bearer JWT to a plain `<a href>`, so we
 * route via this Next.js handler: forward the user's NextAuth-attached
 * Cognito access token to the API, then redirect the browser to the
 * presigned S3 URL the API returns.
 *
 * The API endpoint itself (`GET /v2/catalog/datasets/:slug/distributions/:id/download`)
 * does the visibility + access-request check before signing — see
 * StorageService.getDownloadUrl. We just plumb auth and redirect.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; distributionId: string }> },
) {
  const { slug, distributionId } = await params;
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return NextResponse.json({ message: 'NEXT_PUBLIC_API_BASE_URL not set' }, { status: 500 });
  }

  const session = await auth();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  // The API returns 302 with the presigned URL in `Location`. Disable
  // automatic following so we can pass it through to the browser
  // unchanged — the signature is bound to the destination host so any
  // re-write here would invalidate it.
  const upstream = await fetch(
    `${base}/v2/catalog/datasets/${encodeURIComponent(slug)}/distributions/${encodeURIComponent(distributionId)}/download`,
    { headers, redirect: 'manual', cache: 'no-store' },
  );

  if (upstream.status === 302 || upstream.status === 307) {
    const location = upstream.headers.get('location');
    if (location) {
      return NextResponse.redirect(location, 302);
    }
  }
  if (upstream.status === 401 || upstream.status === 403) {
    return NextResponse.json(
      { message: 'Sign in or request access to download this distribution.' },
      { status: upstream.status },
    );
  }
  if (upstream.status === 404) {
    return NextResponse.json(
      { message: 'Distribution not found or not visible.' },
      { status: 404 },
    );
  }
  const body = await upstream.text().catch(() => '');
  return new NextResponse(body || upstream.statusText, { status: upstream.status });
}
