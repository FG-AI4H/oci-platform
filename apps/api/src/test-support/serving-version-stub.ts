import type { SubmissionMode } from '@oci/shared-types';
import { vi } from 'vitest';
import type {
  PinnedRouteVersion,
  RouteRegistryService,
  ServingVersionOutcome,
} from '../modules/evaluation/route-registry.service.js';

/**
 * The reference method versions as the migration seeds them: one per mode,
 * DECLARED, since nothing self-approves (#583 pins every submission to one).
 */
export const SERVING_VERSIONS = {
  PREDICTIONS: {
    routeId: '3f0e6a52-0000-4000-8000-000000000002',
    routeSlug: 'oci-predictions-scoring',
    versionId: '3f0e6a52-0000-4000-8000-000000000012',
    version: '1.0.0',
    reviewStatus: 'DECLARED',
  },
  CONTAINER: {
    routeId: '3f0e6a52-0000-4000-8000-000000000001',
    routeSlug: 'oci-sealed-execution',
    versionId: '3f0e6a52-0000-4000-8000-000000000011',
    version: '1.0.0',
    reviewStatus: 'DECLARED',
  },
} as const satisfies Record<'PREDICTIONS' | 'CONTAINER', PinnedRouteVersion>;

/**
 * A `RouteRegistryService` stand-in for unit specs of the submission paths.
 * `resolveServingVersion` answers with the seeded version of the mode unless
 * a spec overrides it.
 */
export function servingVersionStub() {
  const resolveServingVersion = vi.fn(
    async (mode: SubmissionMode): Promise<ServingVersionOutcome> => {
      if (mode === 'PREDICTIONS') return { ok: true, pinned: { ...SERVING_VERSIONS.PREDICTIONS } };
      if (mode === 'CONTAINER') return { ok: true, pinned: { ...SERVING_VERSIONS.CONTAINER } };
      return { ok: false, reason: 'NO_VERSION', mode };
    },
  );
  return {
    resolveServingVersion,
    asService: () => ({ resolveServingVersion }) as unknown as RouteRegistryService,
  };
}
