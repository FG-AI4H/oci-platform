'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import {
  DatasetSlugSchema,
  RecordDicomFindingDecisionRequestSchema,
  type DicomFindingDecisionResult,
} from '@oci/shared-types';
import { fetchAsUser } from '../../../../lib/api-action';
import { parseFindingToken } from '../../../../lib/dicom-findings';
import { isAdmin } from '../../../../lib/groups';
import { sessionForAction } from '../../../../lib/session-recovery';

export type DecisionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | {
      status: 'error';
      message: string;
      reasonError?: string;
      /** Echoed so the form keeps what the operator typed and ticked. */
      values?: { reason: string; selected: string[] };
    };

/**
 * Records an operator's decision on findings of a dataset: forwards to
 * `POST /v2/storage/datasets/:slug/dicom/findings/decisions`, which
 * releases the files the decision covers and writes the audit event.
 *
 * The API decides who is an operator. The check here only spares a
 * round trip.
 */
export async function recordDecisionAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const reason = String(formData.get('reason') ?? '');
  const selected = formData.getAll('finding').map(String);
  const values = { reason, selected };

  // Tokens stay on the server (ADR-0027): `fetchAsUser` attaches the
  // caller's, renewing it if it is due.
  const session = await sessionForAction();
  if (!session?.user || !isAdmin(session)) {
    return { status: 'error', message: 'Only platform operators can decide on findings.', values };
  }
  const slug = DatasetSlugSchema.safeParse(String(formData.get('slug') ?? ''));
  if (!slug.success) return { status: 'error', message: 'Unknown dataset.', values };

  const parsed = RecordDicomFindingDecisionRequestSchema.safeParse({
    reason,
    findings: selected.map(parseFindingToken).filter((ref) => ref !== null),
  });
  if (!parsed.success) {
    const issue = (name: string) => parsed.error.issues.find((i) => i.path.at(0) === name)?.message;
    return {
      status: 'error',
      message: issue('findings') ?? 'The decision could not be recorded. Check the reason.',
      reasonError: issue('reason'),
      values,
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set.', values };

  let res: Response;
  try {
    res = await fetchAsUser(
      `${base}/v2/storage/datasets/${encodeURIComponent(slug.data)}/dicom/findings/decisions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(parsed.data),
        cache: 'no-store',
      },
    );
  } catch (err) {
    // When the session is over, `fetchAsUser` sends the operator to sign
    // in by throwing a redirect: that one has to pass.
    unstable_rethrow(err);
    return { status: 'error', message: 'The platform could not be reached. Try again.', values };
  }

  if (res.status === 409) {
    // Someone else decided in the meantime: show the current list.
    revalidatePath(`/admin/dicom/${slug.data}`);
    return {
      status: 'error',
      message:
        'None of the selected findings is waiting for a decision any more. The list below is up to date.',
      values: { reason, selected: [] },
    };
  }
  if (res.status === 422) {
    // A selected value can no longer be shown. Show the current list.
    revalidatePath(`/admin/dicom/${slug.data}`);
    return {
      status: 'error',
      message:
        'Some of the selected findings cannot be accepted: their value could not be read back from the stored file, or is too long to be shown whole. Nothing was recorded.',
      values: { reason, selected: [] },
    };
  }
  if (!res.ok) {
    return {
      status: 'error',
      message:
        res.status === 401 || res.status === 403
          ? 'Your session does not allow this. Sign in again as an operator.'
          : `The decision could not be recorded (${res.status}). Nothing was changed.`,
      values,
    };
  }

  const result = (await res.json()) as DicomFindingDecisionResult;
  revalidatePath(`/admin/dicom/${slug.data}`);
  revalidatePath('/admin/dicom');
  revalidatePath(`/catalog/${slug.data}`);
  const images = (n: number) => `${n} ${n === 1 ? 'image' : 'images'}`;
  return {
    status: 'success',
    message:
      `Decision recorded. ${images(result.releasedInstanceCount)} released` +
      (result.stillHeldInstanceCount > 0
        ? `; ${images(result.stillHeldInstanceCount)} still held for other findings.`
        : '; nothing of this dataset is held for findings any more.'),
  };
}
