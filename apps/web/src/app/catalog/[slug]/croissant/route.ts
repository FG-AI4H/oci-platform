import { NextResponse } from 'next/server';
import { auth } from '../../../../auth';

/**
 * Proxies the Croissant manifest from the API
 * (`GET /v2/catalog/datasets/:slug/croissant`) under the web origin so
 * the "download" link on the dataset page Just Works for both
 * anonymous (PUBLIC datasets) and signed-in (RESTRICTED) users — the
 * server-side fetch forwards the user's NextAuth-attached Cognito
 * access token, hitting the same `OptionalCognitoJwtGuard` that the
 * detail page already relies on.
 *
 * The response is sent as `application/ld+json` (Croissant is JSON-LD)
 * with a `Content-Disposition: attachment` so browsers offer to save
 * the file rather than render it as text.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return NextResponse.json({ message: 'NEXT_PUBLIC_API_BASE_URL not set' }, { status: 500 });
  }

  const session = await auth();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const upstream = await fetch(
    `${base}/v2/catalog/datasets/${encodeURIComponent(slug)}/croissant`,
    { headers, cache: 'no-store' },
  );
  if (upstream.status === 404) {
    return NextResponse.json(
      { message: `dataset "${slug}" not found or not visible` },
      { status: 404 },
    );
  }
  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '');
    return new NextResponse(body || upstream.statusText, { status: upstream.status });
  }

  const body = await upstream.text();
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/ld+json',
      'Content-Disposition': `attachment; filename="${slug}.croissant.json"`,
      'Cache-Control': 'public, max-age=30',
    },
  });
}
