import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PayloadTooLargeFilter } from '../exceptions/payload-too-large.filter.js';
import { applyRouteBodyLimits, ROUTE_BODY_LIMITS, type RouteBodyLimit } from './body-limits.js';

/**
 * Wire the request body limits into an application (#741): the per-route
 * limits and the 413 problem response. `main.ts` and the body-limit spec both
 * call this, so the spec tests what runs.
 *
 * The server-wide limit is the adapter's `bodyLimit` option
 * (`SERVER_BODY_LIMIT_BYTES`), set where the adapter is created.
 *
 * Call before `app.init()`; call `assertAllApplied()` after it.
 */
export function configureRequestBodyLimits(
  app: NestFastifyApplication,
  table: readonly RouteBodyLimit[] = ROUTE_BODY_LIMITS,
): { assertAllApplied(): void } {
  app.useGlobalFilters(new PayloadTooLargeFilter(app.getHttpAdapter()));
  return applyRouteBodyLimits(app.getHttpAdapter().getInstance(), table);
}
