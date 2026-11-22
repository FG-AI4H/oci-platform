import { NextResponse } from 'next/server';
import {
  EvaluationTaskSlugSchema,
  predictionsTemplateCsv,
  type EvaluationTaskDetail,
} from '@oci/shared-types';
import { apiFetch } from '../../../../lib/api';

/**
 * The predictions template for a task (#645): a CSV with the header and one
 * line per item, label left empty, sent as a download.
 *
 * Public, like the task page it is linked from: the identifiers are the same
 * set that page prints. No session is read and no token is sent.
 *
 * `?sep=semicolon` writes the semicolon-separated form. A spreadsheet whose
 * regional settings write decimals with a comma opens a comma-separated file
 * as a single column, which is the surest way to end up with a file the
 * platform cannot read; the submit page offers both.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = EvaluationTaskSlugSchema.safeParse(slug);
  if (!parsed.success) {
    return NextResponse.json({ message: 'evaluation task not found' }, { status: 404 });
  }

  let task: EvaluationTaskDetail | null;
  try {
    task = await apiFetch<EvaluationTaskDetail>(
      `/v2/evaluation/tasks/${encodeURIComponent(parsed.data)}`,
      { revalidate: 0 },
    );
  } catch {
    return NextResponse.json({ message: 'the evaluation service is unavailable' }, { status: 502 });
  }
  if (!task) {
    return NextResponse.json({ message: 'evaluation task not found' }, { status: 404 });
  }

  const semicolon = new URL(req.url).searchParams.get('sep') === 'semicolon';
  // A binary-finding task also takes an optional score per item (#650).
  const csv = predictionsTemplateCsv(task.itemIds, semicolon ? ';' : ',', {
    withScore: task.taskKind === 'BINARY_DIAGNOSTIC',
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // The slug is validated to lower-case letters, digits and hyphens, so it
      // is safe inside the quoted filename.
      'Content-Disposition': `attachment; filename="${parsed.data}-predictions-template.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
