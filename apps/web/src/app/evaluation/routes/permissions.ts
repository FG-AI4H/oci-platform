import type { Session } from 'next-auth';
import { unstable_rethrow } from 'next/navigation';
import type { RoutePermissionsResponse } from '@oci/shared-types';
import { apiFetch } from '../../../lib/api';

export type RoutePermissionsRead =
  | { status: 'anonymous' }
  | { status: 'unavailable' }
  | { status: 'ok'; permissions: RoutePermissionsResponse };

/**
 * What the signed-in caller may do on an evaluation method (#649), from
 * `GET /v2/evaluation/routes/:slug/permissions`: the API applies its own
 * review and declaration rules, so the page offers only what it would
 * accept. Signed out, there is nothing to ask. A failure leaves the page
 * read-only; it never breaks the public view.
 */
export async function readRoutePermissions(
  slug: string,
  session: Session | null,
): Promise<RoutePermissionsRead> {
  if (!session?.user) return { status: 'anonymous' };
  try {
    const permissions = await apiFetch<RoutePermissionsResponse>(
      `/v2/evaluation/routes/${encodeURIComponent(slug)}/permissions`,
      { session, revalidate: 0 },
    );
    return permissions ? { status: 'ok', permissions } : { status: 'unavailable' };
  } catch (err) {
    unstable_rethrow(err);
    return { status: 'unavailable' };
  }
}
