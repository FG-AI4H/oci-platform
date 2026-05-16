import { NextResponse } from 'next/server';
import type { ListDatasetsResponse } from '@oci/shared-types';
import { auth } from '../../../auth';

/**
 * Server-side proxy for the catalog list endpoint, scoped to the
 * dataset picker on `/annotation/campaigns/new` (user feedback
 * 2026-05-16).
 *
 * Why a proxy: the dataset picker is a client component (typeahead
 * needs `useState`), so it cannot use `apiFetch` (which carries the
 * server-only NextAuth session). This route forwards the request with
 * the caller's bearer token attached and returns the catalog list
 * payload verbatim. Anonymous calls return PUBLIC rows only — same
 * behaviour as `/catalog`.
 *
 * Only local datasets are returned (`source=local`). Federated rows
 * have UUIDs that don't FK to our annotation tables, so they wouldn't
 * be valid picks even if shown.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  if (q.length < 2) {
    return NextResponse.json({ items: [], nextCursor: null, totalEstimate: 0 });
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return NextResponse.json({ error: 'API base URL not configured' }, { status: 500 });
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;

  const apiUrl = `${base}/v2/catalog/datasets?source=local&limit=10&q=${encodeURIComponent(q)}`;
  const res = await fetch(apiUrl, { headers, cache: 'no-store' });
  if (!res.ok) {
    return NextResponse.json({ error: `Catalog ${res.status}` }, { status: 502 });
  }
  const body = (await res.json()) as ListDatasetsResponse;
  return NextResponse.json(body);
}
