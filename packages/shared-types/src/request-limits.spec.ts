import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUEST_BODY_LIMIT_BYTES,
  MANIFEST_PUBLISH_BODY_LIMIT_BYTES,
  MAX_PREDICTION_LABEL,
  MAX_PREDICTION_ROWS,
  PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES,
  SubmitPredictionsRequestSchema,
  formatByteLimit,
} from './index.js';

/**
 * Bytes of a body as the web and the scripts send it: compact JSON. Every body
 * here is ASCII, so its length in characters is its length in UTF-8 bytes.
 */
const bytesOf = (body: unknown): number => JSON.stringify(body).length;

/** A predictions body of `rows` rows, every identifier `idLength` characters long. */
function predictionsBody(rows: number, idLength: number) {
  return {
    methodName: 'm'.repeat(120),
    intent: 'VALIDATION' as const,
    predictions: Array.from({ length: rows }, (_, i) => ({
      imageId: String(i).padStart(idLength, 'x'),
      grade: MAX_PREDICTION_LABEL,
    })),
  };
}

describe('request body limits (#741)', () => {
  it('keeps the server default at 1 MiB', () => {
    expect(DEFAULT_REQUEST_BODY_LIMIT_BYTES).toBe(1_048_576);
  });

  it('carries the schema’s 100,000 predictions with 64-character identifiers', () => {
    const body = predictionsBody(MAX_PREDICTION_ROWS, 64);
    expect(SubmitPredictionsRequestSchema.safeParse(body).success).toBe(true);
    // 28 + 64 bytes a row, as the comment on the limit says.
    expect(bytesOf(body)).toBeLessThan(MAX_PREDICTION_ROWS * 92 + 300);
    expect(bytesOf(body)).toBeLessThanOrEqual(PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES);
  });

  it('does not carry 100,000 predictions with the longest identifiers the schema allows', () => {
    // The documented difference between the two caps: the schema allows a
    // body the transport refuses. If this starts failing, the limit or the
    // schema changed and the comment on the limit is out of date.
    const body = predictionsBody(MAX_PREDICTION_ROWS, 200);
    expect(SubmitPredictionsRequestSchema.safeParse(body).success).toBe(true);
    expect(bytesOf(body)).toBeGreaterThan(PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES);
  });

  it('carries any file the web submit page accepts (512 KiB of CSV)', () => {
    // The most a 512 KiB CSV can become: 100,000 rows of the shortest
    // identifiers, padded with longer ones up to the file size. Each row adds
    // 23 bytes going from `id,label\n` to compact JSON.
    const csvBytes = 512 * 1024;
    const worstJson = csvBytes + MAX_PREDICTION_ROWS * 23 + 300;
    expect(worstJson).toBeLessThan(PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES);
  });

  it('holds a per-file manifest of about 24,000 files', () => {
    // A distribution entry as the exam-sample upload writes one, with a
    // 60-character path: about 350 to 430 bytes.
    const entry = {
      '@id': 'EXAM-0001/SERIES-0001/'.padEnd(60, 'x'),
      '@type': 'cr:FileObject',
      name: 'f'.repeat(40),
      encodingFormat: 'application/dicom',
      contentUrl:
        '/v2/catalog/datasets/head-ct-sample-x7k2/distributions/11111111-1111-4111-8111-111111111111/download',
      contentSize: '524288 B',
      sha256: 'a'.repeat(64),
    };
    const perEntry = bytesOf(entry) + 1;
    expect(perEntry).toBeGreaterThan(300);
    expect(perEntry).toBeLessThan(450);
    expect(Math.floor(MANIFEST_PUBLISH_BODY_LIMIT_BYTES / 350)).toBeGreaterThan(23_900);
    expect(Math.floor(MANIFEST_PUBLISH_BODY_LIMIT_BYTES / perEntry)).toBeGreaterThan(18_000);
  });

  it('formats a limit as people read it', () => {
    expect(formatByteLimit(PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES)).toBe('10 MiB');
    expect(formatByteLimit(MANIFEST_PUBLISH_BODY_LIMIT_BYTES)).toBe('8 MiB');
    expect(formatByteLimit(512 * 1024)).toBe('512 KiB');
    expect(formatByteLimit(900)).toBe('900 bytes');
  });
});
