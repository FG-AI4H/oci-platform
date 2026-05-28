import { z, type ZodType } from 'zod';

/**
 * Schema-profile registry (ADR-0007 §"Submission contract" + §"Trust
 * posture: curated-only"). Every `AnnotationToolIntegrationVersion`
 * names a `schemaProfile`; the callback payload for that version is
 * validated against the Zod schema registered here before it touches
 * the database. New adapters add their profile in the same PR that
 * adds their version row — there is no runtime registration.
 *
 * A `Map` (not a plain object) is used deliberately so external profile
 * ids can't reach a prototype-chain key (`security/detect-object-injection`).
 */

/** `classification-v1` — single-label classification result. */
const ClassificationResultV1 = z
  .object({
    label: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

/** `bbox-v1` — one or more axis-aligned bounding boxes. */
const BboxResultV1 = z
  .object({
    boxes: z
      .array(
        z
          .object({
            label: z.string().min(1),
            x: z.number(),
            y: z.number(),
            width: z.number().positive(),
            height: z.number().positive(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** `segmentation-mask-v1` — reference to an uploaded mask artifact. */
const SegmentationMaskV1 = z
  .object({
    maskRef: z.string().min(1),
    labelMap: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const SCHEMA_PROFILES = new Map<string, ZodType>([
  ['classification-v1', ClassificationResultV1],
  ['bbox-v1', BboxResultV1],
  ['segmentation-mask-v1', SegmentationMaskV1],
]);

/** Resolve a profile validator by id, or `undefined` if unregistered. */
export function getSchemaProfile(id: string): ZodType | undefined {
  return SCHEMA_PROFILES.get(id);
}

/** Registered profile ids (for the integration-detail surface + tests). */
export function schemaProfileIds(): string[] {
  return [...SCHEMA_PROFILES.keys()];
}
