'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { RouteVersionResponse } from '@oci/shared-types';
import { getFormatters } from '../../../../../../i18n/server';
import { fetchAsUser } from '../../../../../../lib/api-action';
import { sessionForAction } from '../../../../../../lib/session-recovery';
import { checkDraft, draftFromFormData, type DeclarationDraft } from './declaration-draft';
import { fieldMessage } from './strings';

export type DeclareState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      errors: Record<string, string>;
      /** Echoed so the form keeps every entry. */
      values: DeclarationDraft;
    };

const SLUG = /^[a-z0-9-]{1,120}$/;

/**
 * Declares a version of an evaluation method (#649):
 * `POST /v2/evaluation/routes/:slug/versions`. The draft is checked with
 * the API's own request schema first, so a mistake is named next to its
 * field; the API then decides who may declare (the submitter, or admin).
 */
export async function declareVersionAction(
  _prev: DeclareState,
  formData: FormData,
): Promise<DeclareState> {
  const values = draftFromFormData(formData);
  const [t, f] = await Promise.all([getTranslations('EvaluationDeclare'), getFormatters()]);
  const slug = String(formData.get('slug') ?? '');
  if (!SLUG.test(slug)) {
    return { status: 'error', message: t('gone'), errors: {}, values };
  }
  const check = checkDraft(values, (field) => fieldMessage(field, t, f));
  if (!check.ok) {
    return { status: 'error', message: t('fixFields'), errors: check.errors, values };
  }

  await sessionForAction(`/evaluation/routes/${slug}/versions/new`);
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: t('unreachable'), errors: {}, values };

  let res: Response;
  try {
    res = await fetchAsUser(
      `${base}/v2/evaluation/routes/${encodeURIComponent(slug)}/versions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(check.request),
        cache: 'no-store',
      },
      { returnTo: `/evaluation/routes/${slug}/versions/new` },
    );
  } catch (err) {
    unstable_rethrow(err);
    return { status: 'error', message: t('unreachable'), errors: {}, values };
  }

  if (!res.ok) {
    const message =
      res.status === 403
        ? t('forbidden')
        : res.status === 404
          ? t('gone')
          : res.status === 409
            ? t('conflict', { version: check.request.version })
            : t('failed', { status: String(res.status) });
    const errors: Record<string, string> =
      res.status === 409 ? { version: t('conflict', { version: check.request.version }) } : {};
    return { status: 'error', message, errors, values };
  }

  const created = (await res.json()) as RouteVersionResponse;
  revalidatePath(`/evaluation/routes/${slug}`);
  revalidatePath('/evaluation/routes');
  revalidatePath('/evaluation/routes/reviews');
  redirect(
    `/evaluation/routes/${slug}?declared=${encodeURIComponent(created.version)}#version-${created.id}`,
  );
}
