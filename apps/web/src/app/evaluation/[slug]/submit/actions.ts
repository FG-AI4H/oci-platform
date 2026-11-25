'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  EvaluationTaskSlugSchema,
  NoMethodVersionRefusalSchema,
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
import {
  modelCardRefusalOf,
  readModelCardChoice,
} from '../../../../components/evaluation/model-card-choice';
import { describeQuotaRefusal } from '../../../../components/evaluation/quota-text';
import { getEvaluationI18n } from '../../../../components/evaluation/server-i18n';
import { apiFetch, reauthUrl } from '../../../../lib/api';
import { fetchAsUser } from '../../../../lib/api-action';
import { MAX_PREDICTIONS_FILE_BYTES, MAX_PREDICTIONS_FILE_KIB } from './limits';

export interface SubmitPredictionsValues {
  methodName: string;
  /** The chosen model card's id (#587); `''` for "No model card". */
  modelCardId: string;
}

/**
 * What the form shows after the action ran. Plain data only (it crosses to the
 * browser), and never the predictions themselves.
 *
 * `values` echoes the method name and the model card on every branch, so
 * nothing chosen is lost.
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
      /** Shown next to the model card picker (#587). */
      modelCardError?: string;
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
 *
 * Every message is in the interface language (#654). The lines the file
 * parser reports (`fileIssues`) and a refusal reason from the scoring
 * service are passed on as they come.
 */
export async function submitPredictionsAction(
  slug: string,
  _prev: SubmitPredictionsState,
  formData: FormData,
): Promise<SubmitPredictionsState> {
  const [t, i18n] = await Promise.all([getTranslations('EvaluationSubmit'), getEvaluationI18n()]);
  const intent = formData.get('intent') === 'submit' ? 'submit' : 'check';
  const modelCard = readModelCardChoice(formData.get('modelCardId'));
  const values: SubmitPredictionsValues = {
    methodName: String(formData.get('methodName') ?? '').trim(),
    modelCardId: modelCard.ok ? (modelCard.modelCardId ?? '') : '',
  };
  const fail = (
    message: string,
    extra: Partial<Extract<SubmitPredictionsState, { status: 'error' }>> = {},
  ): SubmitPredictionsState => ({ status: 'error', values, message, ...extra });

  // The slug is an argument bound on the client, so it is checked like any
  // other input before it is put in a URL.
  const slugCheck = EvaluationTaskSlugSchema.safeParse(slug);
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!slugCheck.success) return fail(t('action.taskMissing'));
  if (!base) return fail(t('action.notConfigured'));
  const taskPath = `/v2/evaluation/tasks/${encodeURIComponent(slugCheck.data)}`;

  // ---- the two fields --------------------------------------------------------

  const session = await auth();
  if (intent === 'submit' && !session?.user) {
    return fail(t('action.signInToSubmit'));
  }

  if (intent === 'submit' && values.methodName === '') {
    const methodNameError = t('methodNameMissing');
    return fail(t('action.nameMissing'), { methodNameError });
  }
  if (values.methodName !== '' && !MethodNameSchema.safeParse(values.methodName).success) {
    const methodNameError = t('action.nameTooLongField');
    return fail(t('action.nameTooLong'), { methodNameError });
  }

  // The model card (#587) counts only for scoring: a format check records
  // nothing, so it neither sends nor checks one.
  if (intent === 'submit' && !modelCard.ok) {
    const modelCardError = t('modelCard.invalid');
    return fail(t('action.modelCardInvalid'), { modelCardError });
  }
  const modelCardId = intent === 'submit' && modelCard.ok ? modelCard.modelCardId : null;

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    const fileError = t('action.chooseFile');
    return fail(t('action.noFile'), { fileError });
  }
  const fileName = file.name;
  if (file.size > MAX_PREDICTIONS_FILE_BYTES) {
    const max = t('maxSize', { n: i18n.f.number(MAX_PREDICTIONS_FILE_KIB) });
    const fileError = t('fileTooLarge', { max });
    return fail(t('action.tooLarge'), { fileError, fileName });
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
    return fail(t('action.unreadable'), {
      fileName,
      fileError: t('action.problemCount', { count, n: i18n.f.number(count) }),
      fileIssues: {
        issues: parsed.issues,
        issueCount: count,
        missingLabelCount: parsed.missingLabelCount,
      },
    });
  }

  if (unreachable) {
    return fail(t('action.unreachable'), { fileName });
  }
  if (!task) return fail(t('action.taskMissing'), { fileName });

  // ---- the format check (no token) ------------------------------------------

  const report = await checkFormat(`${base}${taskPath}/submissions`, {
    methodName: values.methodName || UNNAMED_CHECK,
    predictions: parsed.predictions,
  });
  if (!report) {
    return fail(t('action.checkIncomplete'), { fileName });
  }
  const view = buildFormatReport({ report, predictions: parsed.predictions, task, i18n });

  if (intent === 'check') return { status: 'checked', values, fileName, report: view };

  if (!view.ok) {
    return fail(t('action.hasProblems'), { fileName, report: view });
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
          // Sent only when one was chosen: without it the result is linked to no card.
          ...(modelCardId ? { modelCardId } : {}),
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
    return fail(t('action.noAnswer'), { fileName });
  }

  // The session is there but the API does not accept its token and no new
  // one could be had just now.
  if (res.status === 401) redirect(reauthUrl(submitPath));

  const body: unknown = await res.json().catch(() => null);

  if (res.ok) {
    const scored = SubmitPredictionsResponseSchema.safeParse(body);
    if (!scored.success) {
      return fail(t('action.unreadableAnswer'), { fileName });
    }
    redirect(`/evaluation/${slugCheck.data}/submissions/${scored.data.id}`);
  }

  if (res.status === 403) {
    const quota = ScoredSubmissionQuotaStateSchema.safeParse(
      typeof body === 'object' && body !== null && 'quota' in body ? body.quota : undefined,
    );
    if (quota.success) return fail(describeQuotaRefusal(i18n, quota.data), { fileName });
  }

  // No evaluation method version could be recorded for the result (#583). The
  // API checks it before the card, and a withdrawn card is a 409 too, so it
  // is told apart by its code, not its status.
  if (res.status === 409 && NoMethodVersionRefusalSchema.safeParse(body).success) {
    return fail(t('action.noMethodVersion'), { fileName });
  }

  // The card is checked before the quota and before anything is written
  // (#587), so a refused card costs nothing. The API's own sentence is not
  // shown: it is in English and names the card by its id.
  const refusal = modelCardId ? modelCardRefusalOf(res.status) : null;
  if (refusal) {
    return fail(t(`action.modelCard.${refusal}`), {
      fileName,
      modelCardError: t(`modelCard.refused.${refusal}`),
    });
  }

  if (res.status === 403) return fail(t('action.notAllowed'), { fileName });

  if (res.status === 400) {
    // The check above passed and the scoring service still refused the file.
    // It records such an attempt as failed, without using quota, and says why.
    const submissionId =
      typeof body === 'object' && body !== null && 'submissionId' in body
        ? body.submissionId
        : undefined;
    return fail(t('action.refused', { reason: messageOf(body) ?? t('action.refusedFallback') }), {
      fileName,
      failedSubmissionId: typeof submissionId === 'string' ? submissionId : undefined,
    });
  }

  if (res.status === 413) {
    return fail(t('action.tooLargeForService'), { fileName });
  }

  return fail(t('action.serviceError', { status: res.status }), { fileName });
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
