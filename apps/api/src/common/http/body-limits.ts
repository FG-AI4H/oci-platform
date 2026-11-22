import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_REQUEST_BODY_LIMIT_BYTES,
  MANIFEST_PUBLISH_BODY_LIMIT_BYTES,
  PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES,
} from '@oci/shared-types';

/**
 * Request body limits, per route (#741).
 *
 * Fastify refuses a body over its limit with 413 before the route runs. The
 * server-wide limit is `DEFAULT_REQUEST_BODY_LIMIT_BYTES` (1 MiB, Fastify's own
 * default, now written down); the routes below take more. The numbers and their
 * arithmetic live in `@oci/shared-types` (`request-limits.ts`), so the scripts
 * that call these routes check a body against the same figure.
 *
 * Kept in one table rather than on each route: Nest passes no `bodyLimit` from
 * a route decorator to Fastify, so the limit is applied by an `onRoute` hook
 * (`applyRouteBodyLimits`), and a table that names a route which does not exist
 * fails at startup (`assertAllApplied`), so a renamed route cannot silently
 * fall back to 1 MiB.
 */

export interface RouteBodyLimit {
  method: 'POST' | 'PUT' | 'PATCH';
  /** The route as Fastify registers it: `/v2/...` with `:param` segments. */
  url: string;
  bytes: number;
  /** What the body is, for the 413 message: "The predictions body is larger…". */
  body: string;
  /** Said with the 413: what the caller can do about it. */
  advice: string;
}

const PREDICTIONS_ADVICE =
  'A submission carries at most 100,000 predictions, and fewer when the identifiers are long. Check that the file holds one prediction for each item of the task and nothing else.';

export const ROUTE_BODY_LIMITS: readonly RouteBodyLimit[] = [
  {
    method: 'POST',
    url: '/v2/evaluation/tasks/:slug/submissions',
    bytes: PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES,
    body: 'predictions submission',
    advice: PREDICTIONS_ADVICE,
  },
  {
    method: 'POST',
    url: '/v2/evaluation/seam/evalai/submissions',
    bytes: PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES,
    body: 'predictions submission',
    advice: PREDICTIONS_ADVICE,
  },
  {
    method: 'POST',
    url: '/v2/catalog/datasets/:slug/versions',
    bytes: MANIFEST_PUBLISH_BODY_LIMIT_BYTES,
    body: 'manifest',
    advice:
      'A manifest that lists every file on its own grows by about 350 bytes a file. Describe groups of files with a FileSet and an includes pattern instead of one FileObject per file.',
  },
];

/** The server-wide limit, passed to the Fastify adapter. */
export const SERVER_BODY_LIMIT_BYTES = DEFAULT_REQUEST_BODY_LIMIT_BYTES;

const keyOf = (method: string, url: string) => `${method.toUpperCase()} ${url}`;

/** The table entry for one route, or `undefined` when it keeps the server default. */
export function routeBodyLimitFor(
  method: string,
  url: string | undefined,
  table: readonly RouteBodyLimit[] = ROUTE_BODY_LIMITS,
): RouteBodyLimit | undefined {
  if (url === undefined) return undefined;
  return table.find((entry) => keyOf(entry.method, entry.url) === keyOf(method, url));
}

/**
 * Set each table route's `bodyLimit` as Fastify registers it. Call before the
 * routes are registered (before `app.init()`), then call `assertAllApplied()`
 * once they are.
 */
export function applyRouteBodyLimits(
  fastify: FastifyInstance,
  table: readonly RouteBodyLimit[] = ROUTE_BODY_LIMITS,
): { assertAllApplied(): void } {
  for (const entry of table) {
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) {
      throw new Error(
        `body limit for ${keyOf(entry.method, entry.url)} must be a positive integer`,
      );
    }
  }
  const applied = new Set<string>();
  fastify.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      const entry = routeBodyLimitFor(method, route.url, table);
      if (entry) {
        route.bodyLimit = entry.bytes;
        applied.add(keyOf(entry.method, entry.url));
      }
    }
  });
  return {
    assertAllApplied() {
      const missing = table
        .map((entry) => keyOf(entry.method, entry.url))
        .filter((key) => !applied.has(key));
      if (missing.length > 0) {
        throw new Error(
          `request body limits name routes that are not registered: ${missing.join(', ')}. ` +
            'Update ROUTE_BODY_LIMITS in apps/api/src/common/http/body-limits.ts.',
        );
      }
    },
  };
}
