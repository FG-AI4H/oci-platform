import { createHash } from 'node:crypto';
import { z } from 'zod';
import { attributeListDigest, checkSample } from './arrival-check.js';
import type { ArrivalRecord } from './arrival-record.js';
import {
  API_BODY_LIMIT_BYTES,
  type FileToUpload,
  type PlatformApi,
  type PlatformDataset,
} from './platform-api.js';
import { readVisualCheck } from './visual-check-sheet.js';

/**
 * Upload of a checked sample as the files of one dataset version (#658).
 *
 * Two halves. `verifyBeforeUpload` is local: it holds the folder against
 * the arrival-check record and the visual-check sheet, and refuses
 * unless the folder is exactly what was checked. `uploadSample` talks
 * to the platform through `PlatformApi`, one file at a time, and can be
 * stopped and started again.
 */

export const UPLOAD_TOOL = 'upload-exam-sample';
/** Bump when the manifest's shape or the upload's behaviour changes. */
export const UPLOAD_TOOL_VERSION = '1';

export const DICOM_CONTENT_TYPE = 'application/dicom';

/** How the platform's silence about a stored file is written: it did not see a DICOM file. */
const NOT_DICOM = 'not DICOM';

/** A reason the folder may not be uploaded. Carries every finding, not the first. */
export class NotUploadable extends Error {
  override readonly name = 'NotUploadable';
  constructor(readonly reasons: string[]) {
    super(reasons.join('\n'));
  }
}

/** The platform answered something the arrival check did not predict. Stop at once. */
export class PlatformDisagrees extends Error {
  override readonly name = 'PlatformDisagrees';
}

export interface VerifiedSample {
  record: ArrivalRecord;
  /** SHA-256 of the record file as read: ties the manifest to one record. */
  recordDigest: string;
  visualChecks: Array<{ exam: number; checkedBy: string; checkedOn: string }>;
}

/**
 * Refuse unless the folder holds exactly the files the record passed.
 *
 * The folder is checked again from scratch, with the decisions the
 * record carries, and the result must be a pass listing the same files
 * with the same sizes and checksums. A record alone is therefore never
 * enough: a file changed, added or removed since the check, or a record
 * edited by hand to say PASS, is caught here.
 */
export function verifyBeforeUpload(args: {
  folder: string;
  record: ArrivalRecord;
  recordText: string;
  sheetText: string;
}): VerifiedSample {
  const { record } = args;
  const reasons: string[] = [];
  if (record.verdict !== 'PASS') {
    throw new NotUploadable(['the arrival-check record says REFUSED: this sample did not pass']);
  }
  if (record.attributeListDigest !== attributeListDigest()) {
    throw new NotUploadable([
      "the record was made with another version of the platform's list of identifying attributes: run the arrival check again",
    ]);
  }

  const now = checkSample(args.folder, { accepted: record.decisions });
  if (now.verdict !== 'PASS') {
    reasons.push(
      `checked again just now, the folder is refused (${now.problems.map((p) => p.summary).join('; ')})`,
    );
  }
  const recorded = new Map(record.files.map((file) => [file.path, file]));
  const present = new Map(now.files.map((file) => [file.path, file]));
  let changed = 0;
  let added = 0;
  for (const [path, file] of present) {
    const before = recorded.get(path);
    if (!before) added += 1;
    else if (before.sha256 !== file.sha256 || before.sizeBytes !== file.sizeBytes) changed += 1;
  }
  const missing = [...recorded.keys()].filter((path) => !present.has(path)).length;
  if (added > 0) reasons.push(`${added} file(s) in the folder are not in the record`);
  if (missing > 0) reasons.push(`${missing} file(s) of the record are no longer in the folder`);
  if (changed > 0) reasons.push(`${changed} file(s) have changed since the check (checksum)`);
  if (now.filesRead !== record.filesRead) {
    reasons.push(
      `the folder holds ${now.filesRead} file(s), the record was made on ${record.filesRead}`,
    );
  }

  const visual = readVisualCheck(args.sheetText, record);
  if (!visual.ok) {
    reasons.push(
      'the visual check is not complete:',
      ...visual.issues.map((issue) => `  ${issue}`),
    );
  }
  if (reasons.length > 0) throw new NotUploadable(reasons);

  return {
    record,
    recordDigest: createHash('sha256').update(args.recordText).digest('hex'),
    visualChecks: visual.checks,
  };
}

/** A storage name for a file: its path, flattened. One segment, unique within the sample. */
export function storageName(relativePath: string): string {
  return relativePath.replaceAll('/', '__');
}

/** What is kept between two runs, so that an interrupted upload resumes. No token, no address. */
export const UploadStateSchema = z.object({
  tool: z.literal(UPLOAD_TOOL),
  apiBase: z.string(),
  datasetSlug: z.string(),
  recordDigest: z.string(),
  /** By path relative to the sample folder: what was sent, and the platform's answer for it. */
  uploaded: z.record(
    z.string(),
    z.object({
      sha256: z.string(),
      distributionId: z.string(),
      /** The platform's check outcome; null when it did not see a DICOM file. */
      dicomCheckStatus: z.string().nullable(),
    }),
  ),
});
export type UploadState = z.infer<typeof UploadStateSchema>;

export function emptyState(
  apiBase: string,
  datasetSlug: string,
  recordDigest: string,
): UploadState {
  return { tool: UPLOAD_TOOL, apiBase, datasetSlug, recordDigest, uploaded: {} };
}

/** The descriptive part of the dataset's manifest, written by the operator; no file list. */
export interface ManifestBase {
  name: string;
  description: string | null;
  croissant: Record<string, unknown>;
}

export function readManifestBase(json: unknown): ManifestBase {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('the manifest base is not a JSON object');
  }
  const croissant = json as Record<string, unknown>;
  const name = croissant.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('the manifest base has no "name"');
  }
  const files = croissant.distribution ?? croissant['sc:distribution'];
  if (Array.isArray(files) && files.length > 0) {
    throw new Error('the manifest base lists files; the upload writes the file list itself');
  }
  const description = croissant.description;
  return { name, description: typeof description === 'string' ? description : null, croissant };
}

export interface UploadPlan {
  apiBase: string;
  datasetSlug: string;
  /** Version published first, when the dataset has none, so that files can attach to it. */
  firstVersion: string;
  /** When set, a version whose manifest lists every file is published at the end. */
  fileListVersion: string | null;
  manifestBase: ManifestBase | null;
  concurrency: number;
}

export interface UploadManifest {
  tool: typeof UPLOAD_TOOL;
  toolVersion: string;
  apiBase: string;
  datasetSlug: string;
  visibility: string;
  accessTier: string;
  /** The version the files are attached to. */
  version: string;
  /** The version whose manifest lists the files, when one was published. */
  fileListVersion: string | null;
  arrivalRecordDigest: string;
  attributeListDigest: string;
  startedAt: string;
  finishedAt: string;
  exams: number;
  files: Array<{
    path: string;
    storageName: string;
    sha256: string;
    sizeBytes: number;
    exam: number;
    seriesRef: string;
    distributionId: string;
    dicomCheckStatus: string | null;
  }>;
  /** Files the platform holds: served to nobody but the host and operators until an operator decides. */
  heldFiles: number;
  visualChecks: VerifiedSample['visualChecks'];
  /** The Croissant file list, written here whether or not it was published. */
  croissantDistribution: unknown[];
}

export interface UploadDependencies {
  api: PlatformApi;
  /** Bytes of a file of the sample, by relative path. */
  read: (relativePath: string, offset: number, length: number) => Uint8Array;
  /** Called after each file, so that progress survives an interruption. */
  saveState: (state: UploadState) => void;
  out: (line: string) => void;
  now: () => Date;
}

function requireRestricted(dataset: PlatformDataset): void {
  if (dataset.visibility !== 'PRIVATE' || dataset.accessTier !== 'CONTROLLED') {
    throw new NotUploadable([
      `the dataset "${dataset.slug}" is ${dataset.visibility} with access tier ${dataset.accessTier}; ` +
        'a sample of exams is uploaded only into a dataset that is PRIVATE with access tier CONTROLLED',
    ]);
  }
}

/**
 * The platform's answer for a stored file against what the arrival
 * check predicts: CLEAR for a file without findings; HELD for a file
 * whose findings a recorded decision accepted (or RELEASED, once an
 * operator has decided on the platform).
 */
function requireAgreement(
  file: { path: string; acceptedFindings: string[] },
  status: string,
): void {
  const expected = file.acceptedFindings.length > 0 ? ['HELD', 'RELEASED'] : ['CLEAR'];
  if (expected.includes(status)) return;
  throw new PlatformDisagrees(
    `the platform's check of ${file.path} says ${status}, the arrival check expected ${expected.join(' or ')}. ` +
      'The upload stops here. The file is stored on the platform: remove it with the deletion runbook, ' +
      'then find out why the two checks differ before uploading anything else.',
  );
}

function distributionEntry(
  slug: string,
  file: { path: string; sha256: string; sizeBytes: number },
  distributionId: string,
): Record<string, unknown> {
  return {
    '@id': file.path,
    '@type': 'cr:FileObject',
    name: storageName(file.path),
    encodingFormat: DICOM_CONTENT_TYPE,
    contentUrl: `/v2/catalog/datasets/${slug}/distributions/${distributionId}/download`,
    contentSize: `${file.sizeBytes} B`,
    sha256: file.sha256,
  };
}

/**
 * Upload every file of a verified sample that the platform does not
 * have yet, then say what is there. Stops at the first failure and at
 * the first file on which the platform's own check disagrees with the
 * arrival check; what was uploaded before stays recorded in the state.
 */
export async function uploadSample(
  sample: VerifiedSample,
  plan: UploadPlan,
  state: UploadState,
  deps: UploadDependencies,
): Promise<UploadManifest> {
  const { api, out } = deps;
  const startedAt = deps.now().toISOString();
  const slug = plan.datasetSlug;

  let dataset = await api.getDataset(slug);
  if (dataset === null) {
    if (!plan.manifestBase) {
      throw new NotUploadable([
        `the dataset "${slug}" does not exist (or this account may not see it); give --manifest-base to create it`,
      ]);
    }
    await api.createDataset({
      slug,
      name: plan.manifestBase.name,
      description: plan.manifestBase.description,
      visibility: 'PRIVATE',
      accessTier: 'CONTROLLED',
    });
    out(`Created the dataset "${slug}": PRIVATE, access tier CONTROLLED.`);
    dataset = await api.getDataset(slug);
    if (dataset === null) throw new Error('the dataset was created and cannot be read back');
  }
  requireRestricted(dataset);

  if (dataset.versions.length === 0) {
    if (!plan.manifestBase) {
      throw new NotUploadable([
        `the dataset "${slug}" has no published version; give --manifest-base to publish the first one`,
      ]);
    }
    await api.publishVersion(slug, {
      version: plan.firstVersion,
      croissant: { ...plan.manifestBase.croissant, version: plan.firstVersion, distribution: [] },
      notes: 'Description only; the files are attached by upload.',
    });
    out(`Published version ${plan.firstVersion} (description, no file yet).`);
    dataset = await api.getDataset(slug);
    if (dataset === null) throw new Error('the dataset cannot be read back after publishing');
    requireRestricted(dataset);
  }
  const target = dataset.versions[0];
  if (!target) throw new Error('the dataset has no version to attach files to');

  // A file an earlier run uploaded and the platform judged differently
  // from the arrival check stops this run too: it is not "done".
  const isRecorded = (file: { path: string; sha256: string }): boolean =>
    state.uploaded[file.path]?.sha256 === file.sha256;
  for (const file of sample.record.files) {
    const known = state.uploaded[file.path];
    if (known && isRecorded(file)) {
      requireAgreement(file, known.dicomCheckStatus ?? NOT_DICOM);
    }
  }

  // A file is done only when this state file holds the platform's own
  // answer for it. The dataset detail does not return that answer, so a
  // file the platform holds and the state does not know is never taken
  // as done: its outcome would be a guess. It is sent again, which
  // replaces its row on the platform and brings the answer back. That
  // happens when the state file was lost, or when an answer did not
  // arrive. The copy stored first stays in the bucket, unlisted, until
  // the dataset is deleted.
  const onPlatform = new Set(dataset.distributions.map((d) => d.croissantId));
  const pending = sample.record.files.filter((file) => !isRecorded(file));
  const sentAgain = pending.filter((file) => onPlatform.has(file.path)).length;
  if (sentAgain > 0) {
    out(
      `${sentAgain} file(s) are on the platform without an outcome recorded in the state file: they are sent again. ` +
        'Their first copy stays in storage, unlisted, until the dataset is deleted.',
    );
  }
  const total = sample.record.files.length;
  out(
    `Dataset "${slug}", version ${target.version}: ${total - pending.length} of ${total} file(s) already there, ${pending.length} to upload.`,
  );

  let done = 0;
  let stop: unknown = null;
  const queue = [...pending];
  const worker = async (): Promise<void> => {
    for (let file = queue.shift(); file !== undefined && stop === null; file = queue.shift()) {
      const current = file;
      try {
        const upload: FileToUpload = {
          filename: storageName(current.path),
          croissantId: current.path,
          contentType: DICOM_CONTENT_TYPE,
          sizeBytes: current.sizeBytes,
          sha256: current.sha256,
          read: (offset, length) => deps.read(current.path, offset, length),
        };
        const uploaded = await api.uploadFile(slug, upload);
        state.uploaded[current.path] = {
          sha256: current.sha256,
          distributionId: uploaded.distributionId,
          dicomCheckStatus: uploaded.dicomCheckStatus,
        };
        deps.saveState(state);

        // The platform runs the same check on what it stored. It must
        // agree with the arrival check, file by file.
        requireAgreement(current, uploaded.dicomCheckStatus ?? NOT_DICOM);
        done += 1;
        if (done % 100 === 0) out(`  ${done} of ${pending.length} uploaded`);
      } catch (err) {
        stop ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, plan.concurrency) }, () => worker()));
  deps.saveState(state);
  if (stop !== null) throw stop;

  // Everything is there. Check that it all went to one version.
  const after = await api.getDataset(slug);
  if (after === null) throw new Error('the dataset cannot be read back after the upload');
  if (after.visibility !== 'PRIVATE' || after.accessTier !== 'CONTROLLED') {
    // Not a refusal: the files are on the platform by now.
    throw new Error(
      `the dataset "${slug}" is now ${after.visibility} with access tier ${after.accessTier}: ` +
        'someone changed it during the upload. The files are stored; make it PRIVATE again or delete it.',
    );
  }
  if (after.versions[0]?.id !== target.id) {
    throw new Error(
      `a new version of "${slug}" was published during the upload: the files are split between two versions`,
    );
  }
  const attached = new Map(after.distributions.map((d) => [d.croissantId, d]));
  const absent = sample.record.files.filter(
    (file) => attached.get(file.path)?.contentHash !== file.sha256,
  );
  if (absent.length > 0) {
    throw new Error(
      `${absent.length} file(s) are not attached to version ${target.version} after the upload`,
    );
  }

  const files = sample.record.files.map((file) => {
    const entry = state.uploaded[file.path];
    const distributionId = attached.get(file.path)?.id ?? entry?.distributionId ?? '';
    return {
      path: file.path,
      storageName: storageName(file.path),
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      exam: file.exam,
      seriesRef: file.seriesRef,
      distributionId,
      // Always the platform's own answer, as this state file recorded it.
      dicomCheckStatus: entry?.dicomCheckStatus ?? NOT_DICOM,
    };
  });
  const croissantDistribution = files.map((file) =>
    distributionEntry(slug, file, file.distributionId),
  );

  let fileListVersion: string | null = null;
  if (plan.fileListVersion !== null) {
    if (!plan.manifestBase) {
      throw new NotUploadable(['publishing the file list needs --manifest-base']);
    }
    const body = {
      version: plan.fileListVersion,
      croissant: {
        ...plan.manifestBase.croissant,
        version: plan.fileListVersion,
        distribution: croissantDistribution,
      },
      notes: `File list of ${files.length} file(s), written by ${UPLOAD_TOOL}.`,
    };
    const size = new TextEncoder().encode(JSON.stringify(body)).length;
    if (after.versions.some((version) => version.version === plan.fileListVersion)) {
      fileListVersion = plan.fileListVersion;
      out(`Version ${fileListVersion} is already published; nothing to publish.`);
    } else if (size > API_BODY_LIMIT_BYTES) {
      out(
        `The file list is ${size} bytes and the API takes ${API_BODY_LIMIT_BYTES} at most: ` +
          `version ${plan.fileListVersion} is NOT published. The files stay attached to version ${target.version}, ` +
          'and the list is in the manifest file.',
      );
    } else {
      await api.publishVersion(slug, body);
      fileListVersion = plan.fileListVersion;
      out(`Published version ${fileListVersion}: its manifest lists the ${files.length} file(s).`);
    }
  }

  return {
    tool: UPLOAD_TOOL,
    toolVersion: UPLOAD_TOOL_VERSION,
    apiBase: plan.apiBase,
    datasetSlug: slug,
    visibility: after.visibility,
    accessTier: after.accessTier,
    version: target.version,
    fileListVersion,
    arrivalRecordDigest: sample.recordDigest,
    attributeListDigest: sample.record.attributeListDigest,
    startedAt,
    finishedAt: deps.now().toISOString(),
    exams: sample.record.exams.length,
    files,
    heldFiles: files.filter((file) => file.dicomCheckStatus === 'HELD').length,
    visualChecks: sample.visualChecks,
    croissantDistribution,
  };
}
