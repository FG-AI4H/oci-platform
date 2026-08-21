import { z } from 'zod';

/**
 * The platform's slug primitive. Extracted from `index.ts` so modules that
 * need it can depend on it WITHOUT importing the barrel — importing the barrel
 * from a module the barrel re-exports is a cycle, and at module-eval time the
 * schema then reads as `undefined`. Re-exported from `index.ts`, so every
 * existing `@oci/shared-types` consumer is unaffected.
 */
/**
 * Slug rules: lower-case alphanumerics, hyphens; 3–80 chars; no leading
 * or trailing hyphen, no consecutive hyphens. Identical to the rule
 * NPM applies to package names so URLs share that ergonomic shape.
 */
export const DatasetSlugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(
    /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$/,
    'slug must be lower-case alphanumerics with single hyphens, 3-80 chars',
  );
export type DatasetSlug = z.infer<typeof DatasetSlugSchema>;
