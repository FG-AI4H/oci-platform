import { NextResponse } from 'next/server';
import { DicomSeriesDetailSchema } from '@oci/shared-types';
import { auth } from '../../../../../../auth';

const NO_STORE = { 'Cache-Control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One DICOM series for the viewer in the browser (#674, ADR-0026): its
 * instances in display order, each with a short-lived storage address.
 *
 * The browser cannot attach the reader's access token to a request to
 * the API, so it asks here and this handler forwards the token, as the
 * download route beside it does. The API decides who may have the
 * series (`GET /v2/storage/dicom/series/:id`); nothing is decided here
 * except that the series belongs to the dataset in the path.
 *
 * Never cached: the answer depends on who asks and carries signed
 * addresses.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; seriesId: string }> },
) {
  const { slug, seriesId } = await params;
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return NextResponse.json(
      { message: 'NEXT_PUBLIC_API_BASE_URL not set' },
      { status: 500, headers: NO_STORE },
    );
  }
  if (!UUID.test(seriesId)) {
    return NextResponse.json({ message: 'Series not found.' }, { status: 404, headers: NO_STORE });
  }

  const session = await auth();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const upstream = await fetch(`${base}/v2/storage/dicom/series/${seriesId}`, {
    headers,
    cache: 'no-store',
  });

  if (upstream.status === 401 || upstream.status === 403) {
    return NextResponse.json(
      { message: 'Sign in or request access to open this series.' },
      { status: upstream.status, headers: NO_STORE },
    );
  }
  if (upstream.status === 404) {
    return NextResponse.json({ message: 'Series not found.' }, { status: 404, headers: NO_STORE });
  }
  if (!upstream.ok) {
    return NextResponse.json(
      { message: 'The series could not be loaded.' },
      { status: 502, headers: NO_STORE },
    );
  }

  const parsed = DicomSeriesDetailSchema.safeParse(await upstream.json().catch(() => null));
  // A series of another dataset is not served under this dataset's path.
  if (!parsed.success || parsed.data.datasetSlug !== slug) {
    return NextResponse.json({ message: 'Series not found.' }, { status: 404, headers: NO_STORE });
  }
  return NextResponse.json(parsed.data, { headers: NO_STORE });
}
