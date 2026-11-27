import { NextResponse } from 'next/server';
import { ActivityReportMonthSchema } from '@oci/shared-types';
import { fetchAsUser } from '../../../../lib/api-action';

/**
 * `/admin/reports/export?month=YYYY-MM`: the activity report as a JSON file
 * (#828), under the web origin, so the download link works with the session
 * cookie while the token stays on the server (ADR-0027). The API checks the
 * caller's role and assembles the report; this passes it through as a file.
 */
export async function GET(request: Request) {
  const month = ActivityReportMonthSchema.safeParse(new URL(request.url).searchParams.get('month'));
  if (!month.success) {
    return NextResponse.json({ message: 'month must be YYYY-MM' }, { status: 400 });
  }
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return NextResponse.json({ message: 'NEXT_PUBLIC_API_BASE_URL not set' }, { status: 500 });
  }

  const upstream = await fetchAsUser(
    `${base}/v2/reports/activity?month=${month.data}`,
    { cache: 'no-store' },
    { returnTo: '/admin/reports' },
  );
  const body = await upstream.text();
  if (!upstream.ok) {
    return new NextResponse(body || upstream.statusText, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'text/plain' },
    });
  }
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="oci-activity-report-${month.data}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
