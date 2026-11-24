'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  RouteReviewStatusSchema,
  type EvaluationRouteResponse,
  type RouteReviewStatus,
} from '@oci/shared-types';
import { fetchAsUser } from '../../../../lib/api-action';
import { sessionForAction } from '../../../../lib/session-recovery';
import { describeRefusal, problemDetail, readReviewForm, type RefusalKind } from './review-outcome';

export type ReviewState =
  | { status: 'idle'; values?: { decision: string; rationale: string } }
  | { status: 'confirm'; to: RouteReviewStatus; rationale: string }
  | {
      status: 'error';
      kind: RefusalKind | 'invalid';
      message?: string;
      decisionError?: string;
      rationaleError?: string;
      /** Echoed so the form keeps what the reviewer chose and wrote. */
      values: { decision: string; rationale: string };
    };

const SLUG = /^[a-z0-9-]{1,120}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records a review outcome on an evaluation-method version (#649):
 * `POST /v2/evaluation/routes/:slug/versions/:version/review`.
 *
 * Two steps, both through here so they work before the page has hydrated:
 * `intent=preview` checks the form and answers with the confirmation step;
 * `intent=confirm` sends the decision; `intent=edit` goes back with the
 * values kept. Who may record what is the API's decision. Nothing here
 * pre-empts it, so its 403 is what the browser shows.
 */
export async function recordReviewAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const values = {
    decision: String(formData.get('decision') ?? ''),
    rationale: String(formData.get('rationale') ?? ''),
  };
  const intent = String(formData.get('intent') ?? 'preview');
  if (intent === 'edit') return { status: 'idle', values };
  const t = await getTranslations('EvaluationReview');

  const slug = String(formData.get('slug') ?? '');
  const version = String(formData.get('version') ?? '');
  const versionId = String(formData.get('versionId') ?? '');
  const expected = RouteReviewStatusSchema.safeParse(formData.get('expectedStatus'));
  if (!SLUG.test(slug) || !VERSION.test(version) || !UUID.test(versionId) || !expected.success) {
    return { status: 'error', kind: 'gone', message: t('gone'), values };
  }

  const read = readReviewForm(values, t);
  if (!read.ok) {
    return {
      status: 'error',
      kind: 'invalid',
      decisionError: read.decisionError,
      rationaleError: read.rationaleError,
      values,
    };
  }
  if (intent !== 'confirm') return { status: 'confirm', to: read.to, rationale: read.rationale };

  // The session is read before anything is sent: one that ended sends the
  // reviewer to sign in and back to this page.
  await sessionForAction(`/evaluation/routes/${slug}`);
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', kind: 'failed', message: t('unreachable'), values };
  const routePath = `/v2/evaluation/routes/${encodeURIComponent(slug)}`;

  let res: Response;
  try {
    // Tokens stay on the server: `fetchAsUser` attaches the caller's.
    res = await fetchAsUser(
      `${base}${routePath}/versions/${encodeURIComponent(version)}/review`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          status: read.to,
          reviewNotes: read.rationale.length > 0 ? read.rationale : null,
        }),
        cache: 'no-store',
      },
      { returnTo: `/evaluation/routes/${slug}` },
    );
  } catch (err) {
    unstable_rethrow(err);
    return { status: 'error', kind: 'failed', message: t('unreachable'), values };
  }

  if (!res.ok) {
    const detail = problemDetail(await res.text().catch(() => ''));
    const current = await currentStatus(`${base}${routePath}`, version);
    const refusal = describeRefusal(
      {
        httpStatus: res.status,
        detail,
        version,
        expected: expected.data,
        current,
      },
      t,
    );
    // The page behind the form shows the version as it is now.
    revalidatePath(`/evaluation/routes/${slug}`);
    return {
      status: 'error',
      kind: refusal.kind,
      message: refusal.message,
      rationaleError: refusal.kind === 'rationale' ? t('rationaleRequired') : undefined,
      values,
    };
  }

  revalidatePath(`/evaluation/routes/${slug}`);
  revalidatePath('/evaluation/routes');
  revalidatePath('/evaluation/routes/reviews');
  redirect(
    `/evaluation/routes/${slug}?recorded=${encodeURIComponent(version)}&to=${read.to}#version-${versionId}`,
  );
}

/** The version's status now, from the public read; null if it cannot be had. */
async function currentStatus(routeUrl: string, version: string): Promise<RouteReviewStatus | null> {
  try {
    const res = await fetch(routeUrl, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const route = (await res.json()) as EvaluationRouteResponse;
    return route.versions.find((v) => v.version === version)?.reviewStatus ?? null;
  } catch {
    return null;
  }
}
