import { NextResponse } from 'next/server';
import { fetchAsUser } from '../../../../lib/api-action';
import { apiQuery, readFilters } from '../filters';

/**
 * `/admin/audit/export?format=csv|json&<filters>`: the audit export
 * under the web origin, so the download link works with the session
 * cookie while the token stays on the server (ADR-0027). The API checks
 * the caller's role, records the export and returns the file; this
 * passes the file and its headers through.
 *
 * Linked with a plain `<a>`, never prefetched: every request is an
 * export, and every export is recorded.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get('format');
  if (format !== 'csv' && format !== 'json') {
    return NextResponse.json({ message: 'format must be csv or json' }, { status: 400 });
  }
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return NextResponse.json({ message: 'NEXT_PUBLIC_API_BASE_URL not set' }, { status: 500 });
  }

  const filters = readFilters(Object.fromEntries(url.searchParams.entries()));
  const query = apiQuery(filters);
  const upstream = await fetchAsUser(
    `${base}/v2/audit/events.${format}${query ? `?${query}` : ''}`,
    { cache: 'no-store' },
    { returnTo: '/admin/audit' },
  );
  const body = await upstream.text();
  if (!upstream.ok) {
    return new NextResponse(body || upstream.statusText, {
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
