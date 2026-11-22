import { NextResponse } from 'next/server';
import { AssignmentSampleResponseSchema } from '@oci/shared-types';
import { fetchAsUser } from '../../../../../lib/api-action';

const NO_STORE = { 'Cache-Control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The sample of one assignment for the viewer in the browser (#646,
 * #674), with fresh short-lived addresses. The DICOM viewer asks again
 * here when the addresses it holds expire.
 *
 * The browser does not hold the reader's access token, so it asks here
 * and this handler forwards the request as the signed-in caller. The
 * API decides who may have the sample (the task's rule); nothing is
 * decided here.
 *
 * Never cached: the answer depends on who asks and carries signed
 * addresses.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const { assignmentId } = await params;
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return NextResponse.json(
      { message: 'NEXT_PUBLIC_API_BASE_URL not set' },
      { status: 500, headers: NO_STORE },
    );
  }
  if (!UUID.test(assignmentId)) {
    return NextResponse.json({ message: 'Task not found.' }, { status: 404, headers: NO_STORE });
  }

  const upstream = await fetchAsUser(`${base}/v2/annotation/assignments/${assignmentId}/sample`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!upstream.ok) {
    // 403: no longer the reader's task; 404: not a sample the platform
    // can show; 409: a file of it is held. The viewer stops either way.
    return NextResponse.json(
      { message: 'The sample could not be loaded.' },
      { status: upstream.status, headers: NO_STORE },
    );
  }
  const parsed = AssignmentSampleResponseSchema.safeParse(await upstream.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'The sample could not be loaded.' },
      { status: 502, headers: NO_STORE },
    );
  }
  return NextResponse.json(parsed.data, { headers: NO_STORE });
}
