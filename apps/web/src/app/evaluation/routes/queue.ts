import type { EvaluationRouteResponse, RouteVersionResponse } from '@oci/shared-types';

export interface AwaitingVersion {
  route: Pick<EvaluationRouteResponse, 'slug' | 'name' | 'mode' | 'isReference' | 'providerName'>;
  version: RouteVersionResponse;
}

/**
 * Versions waiting for a review decision (#649), from the public list:
 * those under review, then those declared and not yet under review, oldest
 * first in each, so the longest wait is at the top. An approved version can
 * still be rejected, but it is not waiting, so it is not listed.
 */
export function awaitingReview(routes: ReadonlyArray<EvaluationRouteResponse>): {
  underReview: AwaitingVersion[];
  declared: AwaitingVersion[];
} {
  const all = routes.flatMap((route) =>
    route.versions.map((version) => ({
      route: {
        slug: route.slug,
        name: route.name,
        mode: route.mode,
        isReference: route.isReference,
        providerName: route.providerName,
      },
      version,
    })),
  );
  const byAge = (a: AwaitingVersion, b: AwaitingVersion) =>
    a.version.createdAt.localeCompare(b.version.createdAt);
  return {
    underReview: all.filter((v) => v.version.reviewStatus === 'UNDER_REVIEW').sort(byAge),
    declared: all.filter((v) => v.version.reviewStatus === 'DECLARED').sort(byAge),
  };
}
