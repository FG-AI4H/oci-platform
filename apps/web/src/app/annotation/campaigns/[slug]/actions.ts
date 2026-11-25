'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import {
  CampaignTransitionActionSchema,
  type CampaignTransitionAction,
  type CampaignDetail,
} from '@oci/shared-types';
import { fetchAsUser } from '../../../../lib/api-action';
import { isCampaignManager } from '../../../../lib/groups';
import { sessionForAction } from '../../../../lib/session-recovery';

export type TransitionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

/**
 * Drive a campaign lifecycle transition (#215). Form submits hidden
 * `action` + optional `reason`; the API enforces the state-machine
 * guard, so this action just forwards.
 */
export async function transitionCampaignAction(
  _prev: TransitionState,
  formData: FormData,
): Promise<TransitionState> {
  const session = await sessionForAction();
  const [t, tc, common] = await Promise.all([
    getTranslations('Campaign.transitions'),
    getTranslations('Campaign'),
    getTranslations('Common'),
  ]);
  if (!session?.user || !isCampaignManager(session)) {
    return { status: 'error', message: t('onlyManagers') };
  }

  const slug = String(formData.get('slug') ?? '');
  if (!slug) return { status: 'error', message: tc('seedActions.missingSlug') };

  const actionRaw = String(formData.get('action') ?? '');
  const actionParse = CampaignTransitionActionSchema.safeParse(actionRaw);
  if (!actionParse.success) {
    return { status: 'error', message: t('unknownAction', { action: actionRaw }) };
  }
  const action: CampaignTransitionAction = actionParse.data;

  const reasonRaw = formData.get('reason');
  const reason =
    typeof reasonRaw === 'string' && reasonRaw.trim().length > 0 ? reasonRaw.trim() : undefined;

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: common('apiBaseUrlMissing') };

  const res = await fetchAsUser(
    `${base}/v2/annotation/campaigns/${encodeURIComponent(slug)}/transitions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    // A sentence in the manager's language; the API's body goes to the log.
    const body = await res.text().catch(() => '');
    console.warn(`campaign transition: API answered ${res.status}: ${body.slice(0, 300)}`);
    const message =
      res.status === 403
        ? t('forbidden')
        : res.status === 404
          ? tc('seedActions.campaignNotFound')
          : res.status === 409 || res.status === 400
            ? t('notAllowed')
            : tc('seedActions.serverError', { status: res.status });
    return { status: 'error', message };
  }

  const detail = (await res.json()) as CampaignDetail;

  revalidatePath(`/annotation/campaigns/${slug}`);
  revalidatePath('/annotation/campaigns');

  return {
    status: 'success',
    message: t('nowStatus', { status: tc(`status.${detail.status}`) }),
  };
}
