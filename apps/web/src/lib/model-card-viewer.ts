import type { Session } from 'next-auth';
import { unstable_rethrow } from 'next/navigation';
import {
  isModelCardReviewerGroups,
  type ListMyModelCardsResponse,
  type ModelCardActor,
} from '@oci/shared-types';
import { apiFetch } from './api';
import { userGroups } from './groups';

/**
 * The caller's own model cards (#651): `GET /v2/prediction/model-cards/mine`.
 * `null` when nobody is signed in or the API could not answer; the pages
 * that use it degrade to showing no workspace rather than failing.
 */
export async function myModelCards(
  session: Session | null | undefined,
): Promise<ListMyModelCardsResponse | null> {
  if (!session?.user) return null;
  try {
    return await apiFetch<ListMyModelCardsResponse>('/v2/prediction/model-cards/mine', {
      session,
      revalidate: 0,
    });
  } catch (err) {
    // Next.js signals (dynamic rendering, redirects) are not failures.
    unstable_rethrow(err);
    return null;
  }
}

/**
 * How the lifecycle rules see the caller for one card. "Submitter" is read
 * from the API's own list of the caller's cards, so the web app never has to
 * work out how the API maps a sign-in to a submitter id. "Reviewer" is the
 * group check the API makes (`isModelCardReviewerGroups`).
 */
export async function modelCardViewer(
  session: Session | null | undefined,
  slug: string,
): Promise<ModelCardActor> {
  const mine = await myModelCards(session);
  return {
    isSubmitter: mine?.items.some((c) => c.slug === slug) ?? false,
    isReviewer: isModelCardReviewerGroups(userGroups(session)),
  };
}
