'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import {
  EvaluationTaskSlugSchema,
  ScoredSubmissionQuotaStateSchema,
  SubmissionValidationReportSchema,
  SubmitPredictionsRequestSchema,
  SubmitPredictionsResponseSchema,
  parsePredictionsFile,
  type EvaluationTaskDetail,
  type PredictionRow,
  type PredictionsFileIssue,
} from '@oci/shared-types';
import { auth } from '../../../../auth';
import {
  buildFormatReport,
  type FormatReportView,
} from '../../../../components/evaluation/format-report';
import { describeQuotaRefusal } from '../../../../components/evaluation/quota-text';
import { apiFetch, reauthUrl } from '../../../../lib/api';
import { fetchAsUser } from '../../../../lib/api-action';
import { MAX_PREDICTIONS_FILE_BYTES, MAX_PREDICTIONS_FILE_LABEL } from './limits';

export interface SubmitPredictionsValues {
  methodName: string;
}

/**
 * What the form shows after the action ran. Plain data only (it crosses to the
 * browser), and never the predictions themselves.
 *
 * `values` echoes the method name on every branch, so nothing typed is lost.
 * The file cannot be echoed — a browser will not let a page set a file input —
 * which is why the form keeps the chosen file selected instead of resetting.
 */
export type SubmitPredictionsState =
  | { status: 'idle' }
  | {
      /** "Check format" ran to the end. `report.ok` says whether the file passed. */
      status: 'checked';
      values: SubmitPredictionsValues;
      fileName: string;
      report: FormatReportView;
    }
  | {
      status: 'error';
      values: SubmitPredictionsValues;
      /** One sentence saying what happened and that nothing was scored. */
      message: string;
      methodNameError?: string;
      /** Shown next to the file field. */
      fileError?: string;
      /** The lines of the file that could not be read. */
      fileIssues?: {
        issues: PredictionsFileIssue[];
        issueCount: number;
        /** How many of them are a line with no label. */
        missingLabelCount: number;
      };
      fileName?: string;
      /** The format check's findings, when the file was readable but not valid. */
      report?: FormatReportView;
      /** A failed attempt the scoring service recorded, to link to. */
      failedSubmissionId?: string;
    };

const MethodNameSchema = SubmitPredictionsRequestSchema.shape.methodName;

/** Name sent with a format check when the form's method name is still empty. */
const UNNAMED_CHECK = 'format check';

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;
  const { message } = body as { message: unknown };
  return typeof message === 'string' ? message : null;
}

/**
 * The submit page's one action (#645). The two buttons post the same form with
 * a different `intent`:
 *
 *   - `check`  — read the file and ask the API's validation path about it.
 *     Needs no session and sends no token: the check is open to anyone, and a
 *     stale token must not turn a free check into a sign-in prompt.
 *   - `submit` — the same check first, then, only if the file passes, post it
 *     for scoring with the session's token. A file with a problem is therefore
 *     never sent for scoring from this page, so it costs no quota and leaves no
 *     failed attempt behind.
 *
 * The token never comes into this file: `fetchAsUser` reads it from the
 * encrypted session, on the server, and sends it only to the API. It is not in
 * the page, the form or the returned state.
 */
export async function submitPredictionsAction(
  slug: string,
  _prev: SubmitPredictionsState,
  formData: FormData,
): Promise<SubmitPredictionsState> {
  const intent = formData.get('intent') === 'submit' ? 'submit' : 'check';
  const values: SubmitPredictionsValues = {
    methodName: String(formData.get('methodName') ?? '').trim(),
  };
  const fail = (
    message: string,
    extra: Partial<Extract<SubmitPredictionsState, { status: 'error' }>> = {},
  ): SubmitPredictionsState => ({ status: 'error', values, message, ...extra });

  // The slug is an argument bound on the client, so it is checked like any
  // other input before it is put in a URL.
  const slugCheck = EvaluationTaskSlugSchema.safeParse(slug);
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!slugCheck.success) return fail('This evaluation task does not exist.');
  if (!base) return fail('The scoring service is not configured on this environment.');
  const taskPath = `/v2/evaluation/tasks/${encodeURIComponent(slugCheck.data)}`;

  // ---- the two fields --------------------------------------------------------

  const session = await auth();
  if (intent === 'submit' && !session?.user) {
    return fail('Sign in to submit for scoring. Checking the format needs no account.');
  }

  if (intent === 'submit' && values.methodName === '') {
    const methodNameError = 'Give your method a name. It is shown with the result.';
    return fail('Not submitted: the method name is missing.', { methodNameError });
  }
  if (values.methodName !== '' && !MethodNameSchema.safeParse(values.methodName).success) {
    const methodNameError = 'The method name can be up to 120 characters.';
    return fail('The method name is too long.', { methodNameError });
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    const fileError = 'Choose a predictions file (CSV or JSON).';
    return fail('No file was chosen.', { fileError });
  }
  const fileName = file.name;
  if (file.size > MAX_PREDICTIONS_FILE_BYTES) {
    const fileError = `This file is larger than ${MAX_PREDICTIONS_FILE_LABEL}, the most this page takes.`;
    return fail('The file is too large.', { fileError, fileName });
  }

  // The task first: whether the file may carry a score column depends on its
  // kind (#650). Public read, no token. If the service cannot be reached, the
  // file is still read (leniently, a score column allowed) so its own problems
  // are reported, as they were before the task was needed for reading it.
  let task: EvaluationTaskDetail | null = null;
  let unreachable = false;
  try {
    task = await apiFetch<EvaluationTaskDetail>(taskPath, { revalidate: 0 });
  } catch {
    unreachable = true;
  }

  const parsed = parsePredictionsFile(await file.text(), {
    allowScore: task ? task.taskKind === 'BINARY_DIAGNOSTIC' : true,
  });
  if (!parsed.ok) {
    const count = parsed.issueCount;
    return fail('The file could not be read. Nothing was sent for scoring.', {
      fileName,
      fileError:
        count === 1
          ? 'There is 1 problem in this file.'
          : `There are ${count} problems in this file.`,
      fileIssues: {
        issues: parsed.issues,
        issueCount: count,
        missingLabelCount: parsed.missingLabelCount,
      },
    });
  }

  if (unreachable) {
    return fail('The scoring service could not be reached. Try again in a moment.', { fileName });
  }
  if (!task) return fail('This evaluation task does not exist.', { fileName });

  // ---- the format check (no token) ------------------------------------------

  const report = await checkFormat(`${base}${taskPath}/submissions`, {
    methodName: values.methodName || UNNAMED_CHECK,
    predictions: parsed.predictions,
  });
  if (!report) {
    return fail('The format check could not be completed. Try again in a moment.', { fileName });
  }
  const view = buildFormatReport({ report, predictions: parsed.predictions, task });

  if (intent === 'check') return { status: 'checked', values, fileName, report: view };

  if (!view.ok) {
    return fail(
      'Not submitted: the file has problems. Nothing was scored and none of your scored submissions was used.',
      { fileName, report: view },
    );
  }

  // ---- scoring (the session's token, server-side) ----------------------------

  // `fetchAsUser` attaches the token. If the API answers 401 it renews the
  // token once and sends the file again: a 401 comes from the API's check of
  // the caller, before anything is scored, so this cannot use a second slot.
  // If the session is over it signs the reader out and sends them to sign in.
  const submitPath = `/evaluation/${slugCheck.data}/submit`;
  let res: Response;
  try {
    res = await fetchAsUser(
      `${base}${taskPath}/submissions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          methodName: values.methodName,
          intent: 'SCORED',
          predictions: parsed.predictions,
        }),
        cache: 'no-store',
      },
      { returnTo: submitPath },
    );
  } catch (err) {
    // Being sent to sign in is not a failure of the scoring service.
    unstable_rethrow(err);
    // The request may have arrived before the connection dropped, so this does
    // not claim nothing was submitted: a blind retry could spend a second slot.
    return fail(
      'The scoring service did not answer. Look for the result on the task page before submitting again.',
      { fileName },
    );
  }

  // The session is there but the API does not accept its token and no new
  // one could be had just now.
  if (res.status === 401) redirect(reauthUrl(submitPath));

  const body: unknown = await res.json().catch(() => null);

  if (res.ok) {
    const scored = SubmitPredictionsResponseSchema.safeParse(body);
    if (!scored.success) {
      return fail(
        'The file was submitted, but the answer could not be read. Look for the result on the task page before submitting again.',
        { fileName },
      );
    }
    redirect(`/evaluation/${slugCheck.data}/submissions/${scored.data.id}`);
  }

  if (res.status === 403) {
    const quota = ScoredSubmissionQuotaStateSchema.safeParse(
      typeof body === 'object' && body !== null && 'quota' in body ? body.quota : undefined,
    );
    return fail(
      quota.success
        ? describeQuotaRefusal(quota.data)
        : 'Not submitted: you are not allowed to submit for scoring on this task.',
      { fileName },
    );
  }

  if (res.status === 400) {
    // The check above passed and the scoring service still refused the file.
    // It records such an attempt as failed, without using quota, and says why.
    const submissionId =
      typeof body === 'object' && body !== null && 'submissionId' in body
        ? body.submissionId
        : undefined;
    return fail(
      `Not scored: ${messageOf(body) ?? 'the scoring service refused the file'}. None of your scored submissions was used.`,
      { fileName, failedSubmissionId: typeof submissionId === 'string' ? submissionId : undefined },
    );
  }

  if (res.status === 413) {
    return fail('Not submitted: the file is too large for the scoring service.', { fileName });
  }

  return fail(`Not submitted: the scoring service answered with an error (${res.status}).`, {
    fileName,
  });
}

/**
 * Ask the API's validation path about a file. No `Authorization` header, on
 * purpose (see the action's note). Returns `null` when no report came back.
 */
async function checkFormat(
  url: string,
  body: { methodName: string; predictions: PredictionRow[] },
) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...body, intent: 'VALIDATION' }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const report = SubmissionValidationReportSchema.safeParse(await res.json());
    return report.success ? report.data : null;
  } catch {
    return null;
  }
}
