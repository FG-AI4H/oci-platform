'use server';

import { revalidatePath } from 'next/cache';
import type { PullNextResponse, SubmitAssignmentResponse } from '@oci/shared-types';
import { auth } from '../../../../../auth';
import { isAnnotationWorker } from '../../../../../lib/groups';

export type PullState =
  | { status: 'idle' }
  | { status: 'success'; assignmentId: string | null; message: string }
  | { status: 'error'; message: string };

export type SubmitState =
  | { status: 'idle' }
  | {
      status: 'success';
      assignmentId: string;
      message: string;
      newGateState: SubmitAssignmentResponse['newGateState'];
    }
  | { status: 'error'; message: string; submission: string };

// Initial `useActionState` values live in `annotate-form.tsx`. This
// file is `'use server'` — Next 16 only allows async exports here.

/**
 * Pull the caller's next eligible task. Idempotent — re-issues an
 * in-flight assignment if one exists, otherwise creates a new one
 * (router behaviour lives on the API side; this action just forwards).
 */
export async function pullNextAction(_prev: PullState, formData: FormData): Promise<PullState> {
  const session = await auth();
  if (!session?.accessToken || !isAnnotationWorker(session)) {
    return {
      status: 'error',
      message: 'You need an annotation role (annotator / arbitration-annotator / expert-reviewer).',
    };
  }
  const slug = String(formData.get('slug') ?? '');
  if (!slug) return { status: 'error', message: 'Missing campaign slug.' };

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };

  const res = await fetch(
    `${base}/v2/annotation/campaigns/${encodeURIComponent(slug)}/tasks/next`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
      cache: 'no-store',
    },
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
      message: 'No eligible tasks at your gate right now. Check back later.',
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
  const session = await auth();
  const submissionRaw = String(formData.get('submission') ?? '');
  if (!session?.accessToken || !isAnnotationWorker(session)) {
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

  let submission: Record<string, unknown>;
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

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return {
      status: 'error',
      message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.',
      submission: submissionRaw,
    };
  }
  const res = await fetch(
    `${base}/v2/annotation/assignments/${encodeURIComponent(assignmentId)}/submissions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ submission }),
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
      submission: submissionRaw,
    };
  }
  const out = (await res.json()) as SubmitAssignmentResponse;
  if (slug) revalidatePath(`/annotation/campaigns/${slug}/annotate`);

  const tail = out.newGateState
    ? out.newGateState === 'COMPLETED' || out.newGateState === 'SKIPPED'
      ? `Gate advanced to ${out.newGateState}. Task closed.`
      : `Gate advanced to ${out.newGateState}.`
    : 'Submission counted; waiting for the rest of the panel.';
  return {
    status: 'success',
    assignmentId: out.assignmentId,
    message: tail,
    newGateState: out.newGateState,
  };
}
