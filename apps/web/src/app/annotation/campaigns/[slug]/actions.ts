'use server';

import { revalidatePath } from 'next/cache';
import {
  CampaignTransitionActionSchema,
  type CampaignTransitionAction,
  type CampaignDetail,
} from '@oci/shared-types';
import { auth } from '../../../../auth';
import { isCampaignManager } from '../../../../lib/groups';

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
  const session = await auth();
  if (!session?.accessToken || !isCampaignManager(session)) {
    return { status: 'error', message: 'Only campaign managers can transition campaigns.' };
  }

  const slug = String(formData.get('slug') ?? '');
  if (!slug) return { status: 'error', message: 'Missing campaign slug.' };

  const actionRaw = String(formData.get('action') ?? '');
  const actionParse = CampaignTransitionActionSchema.safeParse(actionRaw);
  if (!actionParse.success) {
    return { status: 'error', message: `Unknown action: ${actionRaw}` };
  }
  const action: CampaignTransitionAction = actionParse.data;

  const reasonRaw = formData.get('reason');
  const reason =
    typeof reasonRaw === 'string' && reasonRaw.trim().length > 0 ? reasonRaw.trim() : undefined;

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };

  const res = await fetch(
    `${base}/v2/annotation/campaigns/${encodeURIComponent(slug)}/transitions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
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

  const detail = (await res.json()) as CampaignDetail;

  revalidatePath(`/annotation/campaigns/${slug}`);
  revalidatePath('/annotation/campaigns');

  return {
    status: 'success',
    message: `Campaign is now ${detail.status.toLowerCase()}.`,
  };
}
