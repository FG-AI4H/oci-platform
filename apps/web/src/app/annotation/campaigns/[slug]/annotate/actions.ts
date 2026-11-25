'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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
  const [t, common] = await Promise.all([
    getTranslations('Annotate.actions'),
    getTranslations('Common'),
  ]);
  if (!session?.user || !isAnnotationWorker(session)) {
    return {
      status: 'error',
      message: t('needRole'),
    };
  }
  const slug = String(formData.get('slug') ?? '');
  if (!slug) return { status: 'error', message: t('missingSlug') };

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: common('apiBaseUrlMissing') };

  const res = await fetchAsUser(
    `${base}/v2/annotation/campaigns/${encodeURIComponent(slug)}/tasks/next`,
    { method: 'POST', cache: 'no-store' },
  );
  if (!res.ok) {
    // The reader sees a sentence in their language, never the API's
    // English body (#646 review); the body goes to the server log.
    logRefusal('start', res.status, await res.text().catch(() => ''));
    const message =
      res.status === 403
        ? t('startForbidden')
        : res.status === 404
          ? t('campaignNotFound')
          : res.status === 409
            ? t('campaignNotRunning')
            : t('serverError', { status: res.status });
    return { status: 'error', message };
  }
  const out = (await res.json()) as PullNextResponse;
  revalidatePath(`/annotation/campaigns/${slug}/annotate`);
  if (!out.assignment) {
    return {
      status: 'success',
      assignmentId: null,
      message: t('nothingWaiting'),
    };
  }
  return {
    status: 'success',
    assignmentId: out.assignment.id,
    message: t('pickedUp', { sampleRef: out.assignment.sampleRef }),
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
  const [t, common] = await Promise.all([
    getTranslations('Annotate.actions'),
    getTranslations('Common'),
  ]);
  let submissionRaw = String(formData.get('submission') ?? '');
  if (!session?.user || !isAnnotationWorker(session)) {
    return {
      status: 'error',
      message: t('needRoleToSubmit'),
      submission: submissionRaw,
    };
  }
  const assignmentId = String(formData.get('assignmentId') ?? '');
  if (!assignmentId) {
    return {
      status: 'error',
      message: t('missingAssignment'),
      submission: submissionRaw,
    };
  }
  const slug = String(formData.get('slug') ?? '');
  // Set by the instructions checkbox; absent when the campaign has no
  // published instructions.
  const acknowledgedInstructionsVersion = String(
    formData.get('acknowledgedInstructionsVersion') ?? '',
  );

  // What the DICOM viewer had on screen (#674). The field is there only
  // when the task is a series, and empty while the image asked for is
  // not drawn: the answer would not say what it is about. The API
  // checks the view against the series; an image answer has none.
  const viewField = formData.get('view');
  let view: unknown;
  if (viewField !== null) {
    try {
      view = JSON.parse(String(viewField));
    } catch {
      view = undefined;
    }
  }

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
      ...(view !== undefined ? { view } : {}),
    };
    submissionRaw = JSON.stringify(submission);
    if (!label) {
      return { status: 'error', message: t('chooseAnswer'), submission: submissionRaw };
    }
    if (reason === '') {
      return {
        status: 'error',
        message: t('giveReason'),
        submission: submissionRaw,
      };
    }
  } else {
    try {
      const parsed: unknown = JSON.parse(submissionRaw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(t('notJsonObject'));
      }
      submission = {
        ...(parsed as Record<string, unknown>),
        ...(view !== undefined ? { view } : {}),
      };
    } catch (err) {
      return {
        status: 'error',
        message: t('invalidJson', {
          detail: err instanceof Error ? err.message : t('unparseable'),
        }),
        submission: submissionRaw,
      };
    }
  }
  if (viewField !== null && view === undefined) {
    return {
      status: 'error',
      message: t('notOnScreen'),
      submission: submissionRaw,
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return {
      status: 'error',
      message: common('apiBaseUrlMissing'),
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
        message: t('instructionsChanged', { version: body.requiredInstructionsVersion }),
        submission: submissionRaw,
      };
    }
    // Any other 409: the task closed while the reader worked on it
    // (another arbiter settled it, it moved on, it expired, or it was
    // already answered). Nothing can be saved, so back to the queue,
    // which says so and offers the next task.
    logRefusal('submit', res.status, JSON.stringify(body));
    revalidatePath(`/annotation/campaigns/${slug}/annotate`);
    redirect(`/annotation/campaigns/${encodeURIComponent(slug)}/annotate?after=closed`);
  }
  if (!res.ok) {
    // The reader sees a sentence in their language, never the API's
    // English body (#646 review). The 422 reasons are the API's
    // English too; the form already checks what they cover.
    logRefusal('submit', res.status, await res.text().catch(() => ''));
    const message =
      res.status === 422
        ? t('notAccepted')
        : res.status === 403
          ? t('notYourTask')
          : res.status === 404
            ? t('taskNotFound')
            : t('serverError', { status: res.status });
    return { status: 'error', message, submission: submissionRaw };
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
  const [t, common] = await Promise.all([
    getTranslations('Annotate.actions'),
    getTranslations('Common'),
  ]);
  if (!session?.user || !isAnnotationWorker(session)) {
    return { status: 'error', message: t('needRoleToSkip') };
  }
  const assignmentId = String(formData.get('assignmentId') ?? '');
  const slug = String(formData.get('slug') ?? '');
  if (!assignmentId || !slug) return { status: 'error', message: t('missingAssignmentOrCampaign') };

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: common('apiBaseUrlMissing') };

  const res = await fetchAsUser(
    `${base}/v2/annotation/assignments/${encodeURIComponent(assignmentId)}/release`,
    { method: 'POST', cache: 'no-store' },
  );
  // 409: already submitted, expired or released — the task is no
  // longer the caller's either way, so carry on to the queue.
  if (!res.ok && res.status !== 409) {
    logRefusal('release', res.status, await res.text().catch(() => ''));
    const message =
      res.status === 403
        ? t('skipForbidden')
        : res.status === 404
          ? t('taskNotFound')
          : t('serverError', { status: res.status });
    return { status: 'error', message };
  }
  revalidatePath(`/annotation/campaigns/${slug}/annotate`);
  redirect(`/annotation/campaigns/${encodeURIComponent(slug)}/annotate?after=skipped`);
}

/** What the API said, for the server log; the reader gets a translated sentence. */
function logRefusal(action: string, status: number, body: string): void {
  console.warn(`annotate ${action}: API answered ${status}: ${body.slice(0, 300)}`);
}
