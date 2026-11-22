/**
 * Request body limits of the API (#741), in bytes.
 *
 * One definition, read by the API (which enforces them), by the scripts that
 * call it (which check a body before sending it) and by the documentation.
 * The arithmetic behind each number is written next to it; the spec in this
 * package checks it against the request schemas, so a schema change that
 * outgrows a limit fails a test instead of a request.
 *
 * The load balancer's WAF does not enforce a body size (#736): the managed
 * core rule set's 8 KB body rule is set to count, and these limits are the
 * control. See docs/security.md.
 */

const MiB = 1024 * 1024;

/**
 * Every route not listed below: the server's default, kept at what Fastify
 * uses when nothing is set (1 MiB), but written down. No other route takes
 * anything near it: the largest ordinary bodies are a few kilobytes of form
 * data.
 */
export const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 1 * MiB;

/**
 * `POST /v2/evaluation/tasks/:slug/submissions` and the EvalAI seam intake
 * (`POST /v2/evaluation/seam/evalai/submissions`): up to `MAX_PREDICTION_ROWS`
 * (100,000) rows.
 *
 * One row as `JSON.stringify` writes it is
 * `{"imageId":"<id>","grade":<label>},` = 12 + id + 10 + label + 1 + 1 bytes,
 * that is 28 + id bytes with a label of up to four digits. With identifiers of
 * up to 64 characters (the longest a DICOM UID can be), 100,000 rows are
 * 9,200,000 bytes, plus about 200 bytes for the other fields: under 10 MiB
 * (10,485,760). The schema allows identifiers of up to 200 characters; at that
 * length 10 MiB holds about 46,000 rows, and a longer body is refused with 413.
 *
 * The web submit page refuses a file over 512 KiB before anything is sent. Its
 * JSON is at most about 2.8 MB (100,000 rows add 22 to 23 bytes each to the
 * CSV), so a file the page accepts never reaches this limit.
 */
export const PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES = 10 * MiB;

/**
 * `POST /v2/catalog/datasets/:slug/versions`: a Croissant manifest. The
 * manifest itself has no size cap in the schema; this is the cap.
 *
 * A manifest that lists every file of an uploaded sample carries one
 * distribution entry per file, about 350 bytes each (a 1 MiB body held about
 * 3,000 files, docs/runbooks/exam-sample-intake.md). 8 MiB (8,388,608) holds
 * about 24,000 entries: fifty exams of about 480 thin slices each. The seeded
 * manifests are 5 to 94 KB.
 */
export const MANIFEST_PUBLISH_BODY_LIMIT_BYTES = 8 * MiB;

/** A byte count as people read it: `10 MiB`, `512 KiB`, `900 bytes`. */
export function formatByteLimit(bytes: number): string {
  if (bytes >= MiB && bytes % MiB === 0) return `${bytes / MiB} MiB`;
  if (bytes >= 1024 && bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes} bytes`;
}
