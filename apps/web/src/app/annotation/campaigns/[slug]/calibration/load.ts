import type { Session } from 'next-auth';
import type {
  AnnotatorQualitySummary,
  CalibrationFlag,
  ListCalibrationFlagsResponse,
} from '@oci/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';

// Raw API errors (internal path + response body) are never rendered;
// the API logs the detail with a correlation id. `unauthenticated` is
// a 401 (e.g. an expired access token): the page sends the caller to
// sign in again.
export type FlagsResult =
  | { kind: 'ok'; items: CalibrationFlag[] }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'unauthenticated' }
  | { kind: 'error' };

export type QualityResult =
  | { kind: 'ok'; summary: AnnotatorQualitySummary | null }
  | { kind: 'unauthenticated' }
  | { kind: 'error' };

function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

export async function loadFlags(slug: string, session: Session): Promise<FlagsResult> {
  try {
    const res = await apiFetch<ListCalibrationFlagsResponse>(
      `/v2/annotation/campaigns/${encodeURIComponent(slug)}/calibration/flags`,
      { session, revalidate: 0 },
    );
    if (!res) return { kind: 'not-found' };
    return { kind: 'ok', items: res.items };
  } catch (err) {
    if (isUnauthorized(err)) return { kind: 'unauthenticated' };
    if (err instanceof ApiError && err.status === 403) return { kind: 'forbidden' };
    return { kind: 'error' };
  }
}

export async function loadQuality(
  slug: string,
  annotatorUserId: string,
  session: Session,
): Promise<QualityResult> {
  try {
    const summary = await apiFetch<AnnotatorQualitySummary>(
      `/v2/annotation/campaigns/${encodeURIComponent(slug)}/annotators/${encodeURIComponent(annotatorUserId)}/quality`,
      { session, revalidate: 0 },
    );
    return { kind: 'ok', summary };
  } catch (err) {
    if (isUnauthorized(err)) return { kind: 'unauthenticated' };
    return { kind: 'error' };
  }
}
