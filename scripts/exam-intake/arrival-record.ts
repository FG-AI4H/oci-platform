import { z } from 'zod';
import {
  ARRIVAL_CHECK_TOOL,
  ARRIVAL_CHECK_VERSION,
  AcceptedFindingsSchema,
  attributeListDigest,
  type AcceptedFindings,
  type ArrivalCheckResult,
} from './arrival-check.js';

/**
 * The arrival-check record: a JSON file that says which files were
 * checked (by checksum), with which attribute list, and what was found.
 * The uploader refuses a folder without a passing record for exactly
 * its files.
 *
 * It holds paths, checksums, counts, attribute names, and the technical
 * description of each series (modality code, image size, slice
 * thickness, transfer syntax). It never holds
 * the value of an identifying attribute, and it refers to an exam and
 * a series by a short salted digest of their UID, not by the UID.
 */

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const ArrivalRecordSchema = z.object({
  tool: z.literal(ARRIVAL_CHECK_TOOL),
  toolVersion: z.string(),
  /** Which attribute table of the platform the files were checked against. */
  attributeListDigest: Sha256,
  checkedAt: z.string(),
  verdict: z.enum(['PASS', 'REFUSED']),
  filesRead: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  decisions: AcceptedFindingsSchema.nullable(),
  accepted: z.array(
    z.object({
      attribute: z.string(),
      reason: z.string(),
      files: z.number().int(),
      distinctValues: z.number().int(),
    }),
  ),
  exams: z.array(
    z.object({
      exam: z.number().int().positive(),
      ref: z.string(),
      folders: z.array(z.string()),
      lookClosely: z.array(z.string()),
      series: z.array(
        z.object({
          ref: z.string(),
          number: z.number().nullable(),
          modality: z.string().nullable(),
          images: z.number().int(),
          multiFrameObjects: z.number().int(),
          dimensions: z.array(z.string()),
          sliceThicknessMm: z.array(z.number()),
          transferSyntaxes: z.array(z.string()),
          secondaryCapture: z.boolean(),
        }),
      ),
    }),
  ),
  files: z.array(
    z.object({
      path: z.string(),
      sha256: Sha256,
      sizeBytes: z.number().int().nonnegative(),
      exam: z.number().int().positive(),
      seriesRef: z.string(),
      acceptedFindings: z.array(z.string()),
    }),
  ),
  problems: z.array(
    z.object({ code: z.string(), summary: z.string(), files: z.array(z.string()) }),
  ),
  warnings: z.array(z.string()),
});
export type ArrivalRecord = z.infer<typeof ArrivalRecordSchema>;

export function buildRecord(
  result: ArrivalCheckResult,
  decisions: AcceptedFindings | null,
  now: Date,
): ArrivalRecord {
  return {
    tool: ARRIVAL_CHECK_TOOL,
    toolVersion: ARRIVAL_CHECK_VERSION,
    attributeListDigest: attributeListDigest(),
    checkedAt: now.toISOString(),
    verdict: result.verdict,
    filesRead: result.filesRead,
    totalBytes: result.totalBytes,
    decisions,
    accepted: result.accepted,
    exams: result.exams,
    files: result.files,
    problems: result.problems,
    warnings: result.warnings,
  };
}

/** Parse a record read from disk. Throws a plain Error naming what is wrong. */
export function parseRecord(text: string): ArrivalRecord {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('the arrival-check record is not JSON');
  }
  const parsed = ArrivalRecordSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `the arrival-check record does not have the expected shape (${first ? `${first.path.join('.')}: ${first.message}` : 'unknown'})`,
    );
  }
  return parsed.data;
}
