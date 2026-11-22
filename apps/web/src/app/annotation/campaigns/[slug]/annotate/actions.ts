'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { PullNextResponse } from '@oci/shared-types';
import { fetchAsUser } from '../../../../../lib/api-action';
import { isAnnotationWorker } from '../../../../../lib/groups';
import { sessionForAction } from '../../../../../lib/session-recovery';

export type PullState =
  | { status: 'idle' }
  | { status: 'success'; assignmentId: string | null; message: string }
  | { status: 'error'; message: string };

// A successful submit redirects back to the queue, so only the idle
// and error states reach the form.
export type SubmitState =
  | { status: 'idle' }
  | { status: 'error'; message: string; submission: string };

export type ReleaseState = { status: 'idle' } | { status: 'error'; message: string };

// Initial `useActionState` values live in `annotate-form.tsx`. This
// file is `'use server'` — Next 16 only allows async exports here.

/**
 * "Start": reserve the caller's next eligible task. Opening the page
 * reserves nothing (#646); this is the only place a task is taken.
 * Idempotent — re-issues an in-flight assignment if one exists
 * (router behaviour lives on the API side; this action just forwards).
 */
export async function startTaskAction(_prev: PullState, formData: FormData): Promise<PullState> {
  const session = await sessionForAction();
  if (!session?.user || !isAnnotationWorker(session)) {
    return {
      status: 'error',
      message: 'You need an annotation role (annotator / arbitration-annotator / expert-reviewer).',
    };
  }
  const slug = String(formData.get('slug') ?? '');
  if (!slug) return { status: 'error', message: 'Missing campaign slug.' };

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };

  const res = await fetchAsUser(
    `${base}/v2/annotation/campaigns/${encodeURIComponent(slug)}/tasks/next`,
    { method: 'POST', cache: 'no-store' },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
    };
  }
  const out = (await res.json()) as PullNextResponse;
  revalidatePath(`/annotation/campaigns/${slug}/annotate`);
  if (!out.assignment) {
    return {
      status: 'success',
      assignmentId: null,
      message:
        'No tasks are waiting for you right now. New ones appear when the campaign manager adds them or when an earlier step finishes.',
    };
  }
  return {
    status: 'success',
    assignmentId: out.assignment.id,
    message: `You picked up ${out.assignment.sampleRef}.`,
  };
}

/**
 * Submit annotation work for the current in-flight assignment. The
 * raw `submission` textarea is parsed as JSON and forwarded verbatim
 * to `POST /v2/annotation/assignments/:id/submissions` — tool-
 * integration-aware schema validation per ADR-0007 lands with #214.
 */
export async function submitAssignmentAction(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const session = await sessionForAction();
  let submissionRaw = String(formData.get('submission') ?? '');
  if (!session?.user || !isAnnotationWorker(session)) {
    return {
      status: 'error',
      message: 'You need an annotation role to submit.',
      submission: submissionRaw,
    };
  }
  const assignmentId = String(formData.get('assignmentId') ?? '');
  if (!assignmentId) {
    return {
      status: 'error',
      message: 'Missing assignment id.',
      submission: submissionRaw,
    };
  }
  const slug = String(formData.get('slug') ?? '');
  // Set by the instructions checkbox; absent when the campaign has no
  // published instructions.
  const acknowledgedInstructionsVersion = String(
    formData.get('acknowledgedInstructionsVersion') ?? '',
  );

  let submission: Record<string, unknown>;
  if (formData.get('mode') === 'labels') {
    // The label form (#646): one radio choice and an optional comment;
    // at arbitration, the final label and the required reason.
    const label = String(formData.get('label') ?? '');
    const comment = String(formData.get('comment') ?? '').trim();
    const reasonField = formData.get('reason');
    const reason = reasonField === null ? null : String(reasonField).trim();
    submission = {
      label,
      ...(comment ? { comment } : {}),
      ...(reason !== null ? { reason } : {}),
    };
    submissionRaw = JSON.stringify(submission);
    if (!label) {
      return { status: 'error', message: 'Choose an answer first.', submission: submissionRaw };
    }
    if (reason === '') {
      return {
        status: 'error',
        message: 'Give the reason for the final label.',
        submission: submissionRaw,
      };
    }
  } else {
    try {
      const parsed: unknown = JSON.parse(submissionRaw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Submission must be a JSON object.');
      }
      submission = parsed as Record<string, unknown>;
    } catch (err) {
      return {
        status: 'error',
        message: `Invalid JSON: ${err instanceof Error ? err.message : 'unparseable'}`,
        submission: submissionRaw,
      };
    }
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return {
      status: 'error',
      message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.',
      submission: submissionRaw,
    };
  }
  const res = await fetchAsUser(
    `${base}/v2/annotation/assignments/${encodeURIComponent(assignmentId)}/submissions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        submission,
        ...(acknowledgedInstructionsVersion ? { acknowledgedInstructionsVersion } : {}),
      }),
      cache: 'no-store',
    },
  );
  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as {
      requiredInstructionsVersion?: unknown;
    } | null;
    if (typeof body?.requiredInstructionsVersion === 'string') {
      // The instructions changed while the annotator worked. Re-render
      // so the form shows the new version to acknowledge.
      if (slug) revalidatePath(`/annotation/campaigns/${slug}/annotate`);
      return {
        status: 'error',
        message: `The instructions have changed (now version ${body.requiredInstructionsVersion}). Read the current instructions and confirm them before submitting. Your annotation was kept.`,
        submission: submissionRaw,
      };
    }
  }
  if (res.status === 422) {
    // Refused by the campaign's rules (completeness or labels, #646).
    const body = (await res.json().catch(() => null)) as { reasons?: unknown } | null;
    const reasons = Array.isArray(body?.reasons)
      ? body.reasons.filter((r) => typeof r === 'string')
      : [];
    return {
      status: 'error',
      message: `The answer was not accepted${reasons.length ? `: ${reasons.join('; ')}` : '.'}`,
      submission: submissionRaw,
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
      submission: submissionRaw,
    };
  }
  // Back to the queue, which offers the next task. The gate the task
  // moved to is not shown: it would tell the last reader whether the
  // others agreed.
  revalidatePath(`/annotation/campaigns/${slug}/annotate`);
  redirect(`/annotation/campaigns/${encodeURIComponent(slug)}/annotate?after=submitted`);
}

/**
 * "Skip": give the current task back unread (#646). The slot reopens
 * for other annotators at once; the queue then offers the next task,
 * preferring ones the caller hasn't skipped.
 */
export async function releaseAssignmentAction(
  _prev: ReleaseState,
  formData: FormData,
): Promise<ReleaseState> {
  const session = await sessionForAction();
  if (!session?.user || !isAnnotationWorker(session)) {
    return { status: 'error', message: 'You need an annotation role to skip a task.' };
  }
  const assignmentId = String(formData.get('assignmentId') ?? '');
  const slug = String(formData.get('slug') ?? '');
  if (!assignmentId || !slug)
    return { status: 'error', message: 'Missing assignment or campaign.' };

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };

  const res = await fetchAsUser(
    `${base}/v2/annotation/assignments/${encodeURIComponent(assignmentId)}/release`,
    { method: 'POST', cache: 'no-store' },
  );
  // 409: already submitted, expired or released — the task is no
  // longer the caller's either way, so carry on to the queue.
  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
    };
  }
  revalidatePath(`/annotation/campaigns/${slug}/annotate`);
  redirect(`/annotation/campaigns/${encodeURIComponent(slug)}/annotate?after=skipped`);
}
