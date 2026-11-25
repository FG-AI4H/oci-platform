import { NextResponse } from 'next/server';
import { CampaignSlugSchema } from '@oci/shared-types';
import { fetchAsUser } from '../../../../../lib/api-action';

/**
 * `/annotation/campaigns/:slug/export?format=csv|json`: the campaign's
 * annotation export (#648) under the web origin, so the download link
 * works with the session cookie while the token stays on the server
 * (ADR-0027). The API checks the caller's role, records the export in
 * the audit trail and returns the file; this passes it through.
 *
 * The body is passed as bytes, not text: decoding it as text would drop
 * the CSV's byte-order mark, which tells a spreadsheet the file is UTF-8.
 *
 * Linked with a plain `<a>`, never prefetched: every request is an
 * export, and every export is recorded.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsedSlug = CampaignSlugSchema.safeParse(slug);
  if (!parsedSlug.success) {
    return NextResponse.json({ message: 'unknown campaign' }, { status: 404 });
  }
  const format = new URL(request.url).searchParams.get('format');
  if (format !== 'csv' && format !== 'json') {
    return NextResponse.json({ message: 'format must be csv or json' }, { status: 400 });
  }
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return NextResponse.json({ message: 'NEXT_PUBLIC_API_BASE_URL not set' }, { status: 500 });
  }

  const page = `/annotation/campaigns/${parsedSlug.data}`;
  const upstream = await fetchAsUser(
    `${base}/v2/annotation/campaigns/${encodeURIComponent(parsedSlug.data)}/annotations.${format}`,
    { cache: 'no-store' },
    { returnTo: page },
  );
  const body = await upstream.arrayBuffer();
  if (!upstream.ok) {
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'text/plain' },
    });
  }

  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const name of [
    'Content-Type',
    'Content-Disposition',
    'X-OCI-Export-Id',
    'X-OCI-Export-Sha256',
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(body, { status: 200, headers });
}
