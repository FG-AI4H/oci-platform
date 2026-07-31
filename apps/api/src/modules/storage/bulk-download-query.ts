import { z } from 'zod';

/**
 * `?manifest=true|false` on the bulk-download route. Absent → false, so the
 * default archive carries data + notices but not the JSON-LD. Anything other
 * than the two literals is a 400 rather than a silent falsy — a typo'd
 * `manifest=1` should be loud.
 *
 * Accepts a real boolean as well as the two string literals, because the
 * global `ValidationPipe({ transform: true })` in `main.ts` gets there first:
 * the handler declares `manifest: boolean`, so Nest's `transformPrimitive`
 * has already coerced `'true'` → `true` by the time this schema runs. A
 * string-only enum therefore rejected EVERY value in the deployed app while
 * passing in isolation.
 *
 * Kept in its own module (rather than beside the route) so the regression
 * test can mount it on a probe controller without dragging in the real
 * controller's Prisma / S3 / auth-guard import graph.
 * See `bulk-download-query.spec.ts`.
 */
export const BulkDownloadManifestFlagSchema = z
  .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
  .optional()
  .default(false);
