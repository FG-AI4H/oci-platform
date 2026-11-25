'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { EvaluationTaskSlugSchema } from '@oci/shared-types';
import {
  modelCardRefusalOf,
  readModelCardChoice,
} from '../../../../../components/evaluation/model-card-choice';
import { reauthUrl } from '../../../../../lib/api';
import { fetchAsUser } from '../../../../../lib/api-action';
import { sessionForAction } from '../../../../../lib/session-recovery';

/** What the link form shows after a refusal. Plain data: it crosses to the browser. */
export type LinkModelCardState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      /** The card that was chosen, echoed so the picker keeps it; `''` for none. */
      modelCardId: string;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Link a submission to one of the caller's model cards, move the link, or
 * remove it, from the submission page (#587):
 * `PATCH /v2/evaluation/submissions/:id/model-card` with the chosen card's id,
 * or `null` for "No model card".
 *
 * The page shows the form to the submission's submitter only; the API checks
 * the same and its answer stands. Keeping the card that is linked now sends
 * nothing (a card withdrawn since would otherwise be refused for being
 * restated). On success the page is loaded again, saying what changed.
 *
 * The API's refusal sentences are not shown: they are in English and name a
 * card by its id. Each status is worded in the interface language instead.
 */
export async function linkModelCardAction(
  slug: string,
  submissionId: string,
  _prev: LinkModelCardState,
  formData: FormData,
): Promise<LinkModelCardState> {
  const [t, tCommon] = await Promise.all([
    getTranslations('EvaluationSubmit'),
    getTranslations('Common'),
  ]);
  const choice = readModelCardChoice(formData.get('modelCardId'));
  const chosen = choice.ok ? (choice.modelCardId ?? '') : '';
  const fail = (message: string): LinkModelCardState => ({
    status: 'error',
    message,
    modelCardId: chosen,
  });

  // Both are bound on the client, so both are checked before going in a URL.
  const slugCheck = EvaluationTaskSlugSchema.safeParse(slug);
  if (!slugCheck.success || !UUID.test(submissionId)) return fail(t('modelCard.link.invalid'));
  if (!choice.ok) return fail(t('modelCard.invalid'));

  const page = `/evaluation/${slugCheck.data}/submissions/${submissionId}`;
  await sessionForAction(page);

  const current = readModelCardChoice(formData.get('currentModelCardId'));
  if (current.ok && current.modelCardId === choice.modelCardId) {
    redirect(`${page}?modelCard=unchanged`);
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return fail(tCommon('apiBaseUrlMissing'));

  const res = await fetchAsUser(
    `${base}/v2/evaluation/submissions/${submissionId}/model-card`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ modelCardId: choice.modelCardId }),
      cache: 'no-store',
    },
    { returnTo: page },
  );

  // The session is there but no new token could be had just now.
  if (res.status === 401) redirect(reauthUrl(page));

  if (res.ok) redirect(`${page}?modelCard=${choice.modelCardId ? 'linked' : 'unlinked'}`);

  // A 403 here may also be about the submission (only its submitter changes
  // its link), so it has its own sentence covering both. Removing a link
  // names no card, so a 404 then is about the submission.
  if (res.status === 403) return fail(t('modelCard.link.notAllowed'));
  if (res.status === 404 && choice.modelCardId === null) {
    return fail(t('modelCard.link.submissionMissing'));
  }
  const refusal = modelCardRefusalOf(res.status);
  if (refusal) return fail(t(`modelCard.refused.${refusal}`));
  if (res.status === 400) return fail(t('modelCard.link.invalid'));
  return fail(t('modelCard.link.serviceError', { status: res.status }));
}
