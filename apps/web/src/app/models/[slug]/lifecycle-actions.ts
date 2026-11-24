'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ModelCardSlugSchema, ModelCardStatusSchema } from '@oci/shared-types';
import { fetchAsUser } from '../../../lib/api-action';
import { sessionForAction } from '../../../lib/session-recovery';

export type ModelCardLifecycleState = { status: 'idle' } | { status: 'error'; message: string };

/**
 * Move a card through its lifecycle from its page (#651): submit for review,
 * publish, return to draft, withdraw. The page shows only the moves
 * `modelCardMovesFor` allows the caller; the API checks the same rule and
 * its answer stands. On success the page is reloaded with the new status.
 */
export async function changeModelCardStatusAction(
  _prev: ModelCardLifecycleState,
  formData: FormData,
): Promise<ModelCardLifecycleState> {
  const [t, tCommon] = await Promise.all([
    getTranslations('ModelCardForm'),
    getTranslations('Common'),
  ]);
  const slug = ModelCardSlugSchema.safeParse(formData.get('slug'));
  const status = ModelCardStatusSchema.safeParse(formData.get('status'));
  if (!slug.success || !status.success) {
    return { status: 'error', message: t('lifecycle.invalid') };
  }
  const page = `/models/${encodeURIComponent(slug.data)}`;
  await sessionForAction(page);

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: tCommon('apiBaseUrlMissing') };

  const res = await fetchAsUser(
    `${base}/v2/prediction/model-cards/${encodeURIComponent(slug.data)}/status`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status.data }),
      cache: 'no-store',
    },
    { returnTo: page },
  );
  if (res.status === 403) return { status: 'error', message: t('lifecycle.forbidden') };
  if (res.status === 400 || res.status === 409) {
    return { status: 'error', message: t('lifecycle.stale') };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return {
      status: 'error',
      message: tCommon('apiError', {
        status: res.status,
        statusText: res.statusText,
        detail: detail.slice(0, 300),
      }),
    };
  }
  redirect(page);
}
