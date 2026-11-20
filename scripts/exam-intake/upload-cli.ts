/* eslint-disable security/detect-non-literal-fs-filename -- the folder and the files are the operator's own arguments; outputs are vetted by output-path.ts */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseRecord } from './arrival-record.js';
import { newOutputFile, replaceFile, rewritableOutputFile, writeNewFile } from './output-path.js';
import {
  checkApiBase,
  HttpPlatformApi,
  PlatformApiError,
  type PlatformApi,
} from './platform-api.js';
import { RecordPathError } from './purge-record.js';
import {
  emptyState,
  NotUploadable,
  PlatformDisagrees,
  readManifestBase,
  UPLOAD_TOOL,
  uploadSample,
  verifyBeforeUpload,
  type ManifestBase,
  type UploadState,
} from './upload-sample.js';

/** Name of the environment variable that carries the operator's session token. */
export const TOKEN_VARIABLE = 'OCI_API_TOKEN';

/** Everything the command touches outside its arguments, so tests can replace it. */
export interface UploadCliDependencies {
  env: Readonly<Record<string, string | undefined>>;
  workingDirectory: string;
  repositoryRoot: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Called at most once, and never for a dry run or a refused command. */
  openApi: (apiBase: string, token: string) => PlatformApi;
  now: () => Date;
}

export const EXIT_OK = 0;
/** The upload started and did not finish. Run it again: it resumes. */
export const EXIT_FAILED = 1;
/** The command was refused before anything was sent. */
export const EXIT_REFUSED = 2;

export const USAGE = `Upload a checked sample of exams as the files of one dataset version.

  upload-exam-sample <folder> --record <file> --sheet <file> --dataset <slug>
                     --state <file> --manifest-out <file> [options]

The folder must be exactly what the arrival check passed: it is checked again,
file by file, against the record's checksums, and the visual-check sheet must
name who looked at every exam, when, with the result "clear". Files go through
the platform's own upload API, so its header check and its hold apply to each.

  --record <file>          The record written by check-exam-sample.
  --sheet <file>           The visual-check sheet, filled in.
  --dataset <slug>         Dataset to upload into. It must be PRIVATE with access
                           tier CONTROLLED; it is created that way when missing.
  --api <url>              Address of the platform. Default: $OCI_API_BASE.
  --manifest-base <file>   Croissant description of the dataset (name, licence, DUO
                           terms; no file list). Needed to create the dataset, to
                           publish its first version, and for --publish-file-list.
  --first-version <semver> Version published when the dataset has none. Default 1.0.0.
  --publish-file-list <semver>
                           After the upload, publish this version with a manifest
                           that lists every file. Skipped, with a notice, when the
                           list is larger than the API accepts.
  --state <file>           Progress, rewritten after each file. Run the same command
                           again to resume an interrupted upload.
  --manifest-out <file>    Where the upload manifest is written at the end (new file).
  --concurrency <n>        Files uploaded at a time, 1 to 8. Default 4.
  --dry-run                Verify the folder, the record and the sheet, say what
                           would be uploaded, and stop. Opens no connection.
  -h, --help               Show this text.

The session token is read from $${TOKEN_VARIABLE} and from nowhere else. It is never
printed and never written to a file. The state and the manifest must be outside
any git working tree.
Operator steps: docs/runbooks/exam-sample-intake.md`;

class Refusal extends Error {}

const SLUG = /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

function readText(label: string, file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    throw new Refusal(
      `cannot read ${label} ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function readState(file: string, expected: UploadState): UploadState {
  if (!existsSync(file)) return expected;
  let state: UploadState;
  try {
    state = JSON.parse(readFileSync(file, 'utf8')) as UploadState;
  } catch {
    throw new Refusal(`the state file ${file} cannot be read as JSON`);
  }
  if (
    state.tool !== UPLOAD_TOOL ||
    state.apiBase !== expected.apiBase ||
    state.datasetSlug !== expected.datasetSlug ||
    state.recordDigest !== expected.recordDigest ||
    typeof state.uploaded !== 'object' ||
    state.uploaded === null
  ) {
    throw new Refusal(
      `the state file ${file} belongs to another upload (another platform, dataset or arrival-check record); give a new --state file`,
    );
  }
  return state;
}

function readBytes(file: string, offset: number, length: number): Uint8Array {
  const fd = openSync(file, 'r');
  try {
    const buffer = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const read = readSync(fd, buffer, filled, length - filled, offset + filled);
      if (read === 0) break;
      filled += read;
    }
    return buffer.subarray(0, filled);
  } finally {
    closeSync(fd);
  }
}

async function runUpload(argv: readonly string[], deps: UploadCliDependencies): Promise<number> {
  // A token on the command line stays in the shell history and in the process list.
  if (argv.some((argument) => /^--?(token|bearer|authorization)\b/i.test(argument))) {
    throw new Refusal(
      `the session token is never given on the command line: put it in $${TOKEN_VARIABLE}`,
    );
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        record: { type: 'string' },
        sheet: { type: 'string' },
        dataset: { type: 'string' },
        api: { type: 'string' },
        'manifest-base': { type: 'string' },
        'first-version': { type: 'string', default: '1.0.0' },
        'publish-file-list': { type: 'string' },
        state: { type: 'string' },
        'manifest-out': { type: 'string' },
        concurrency: { type: 'string', default: '4' },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    throw new Refusal(err instanceof Error ? err.message : String(err));
  }
  const { values, positionals } = parsed;
  if (values.help) {
    deps.out(USAGE);
    return EXIT_OK;
  }
  const stray = positionals.find((positional) => positional.startsWith('-'));
  if (stray) throw new Refusal(`"${stray}" came after a bare "--" and was not read as an option`);
  const [folderArgument, ...extra] = positionals;
  if (folderArgument === undefined || extra.length > 0) {
    throw new Refusal('give exactly one folder to upload');
  }
  const resolve = (file: string): string => path.resolve(deps.workingDirectory, file);
  const folder = resolve(folderArgument);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new Refusal(`${folder} is not a folder`);
  }
  const required = (name: 'record' | 'sheet' | 'dataset' | 'state' | 'manifest-out'): string => {
    // eslint-disable-next-line security/detect-object-injection -- `name` is one of the literals above
    const value = values[name];
    if (!value) throw new Refusal(`--${name} is required`);
    return value;
  };
  const slug = required('dataset');
  if (!SLUG.test(slug)) throw new Refusal(`"${slug}" is not a dataset slug`);
  for (const option of ['first-version', 'publish-file-list'] as const) {
    // eslint-disable-next-line security/detect-object-injection -- `option` is one of the two literals above
    const version = values[option];
    if (version !== undefined && !SEMVER.test(version)) {
      throw new Refusal(`--${option} "${version}" is not MAJOR.MINOR.PATCH`);
    }
  }
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Refusal('--concurrency must be a whole number from 1 to 8');
  }
  const rawApi = values.api ?? deps.env.OCI_API_BASE;
  if (!rawApi) throw new Refusal('no platform address: pass --api or set OCI_API_BASE');
  let apiBase: string;
  try {
    apiBase = checkApiBase(rawApi);
  } catch (err) {
    throw new Refusal(err instanceof Error ? err.message : String(err));
  }

  let manifestBase: ManifestBase | null = null;
  if (values['manifest-base']) {
    const file = resolve(values['manifest-base']);
    try {
      manifestBase = readManifestBase(JSON.parse(readText('the manifest base', file)));
    } catch (err) {
      if (err instanceof Refusal) throw err;
      throw new Refusal(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (values['publish-file-list'] && !manifestBase) {
    throw new Refusal('--publish-file-list needs --manifest-base');
  }

  const recordFile = resolve(required('record'));
  const recordText = readText('the arrival-check record', recordFile);
  let record;
  try {
    record = parseRecord(recordText);
  } catch (err) {
    throw new Refusal(`${recordFile}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const sheetText = readText('the visual-check sheet', resolve(required('sheet')));

  const statePath = rewritableOutputFile(
    required('state'),
    deps.workingDirectory,
    deps.repositoryRoot,
  );
  const manifestPath = newOutputFile(
    required('manifest-out'),
    deps.workingDirectory,
    deps.repositoryRoot,
  );
  if (statePath === manifestPath) {
    throw new Refusal('--state and --manifest-out name the same file');
  }

  deps.out(`Checking ${folder} against the record of ${record.checkedAt}…`);
  const sample = verifyBeforeUpload({ folder, record, recordText, sheetText });
  const bytes = record.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  deps.out(
    `The folder is what was checked: ${record.exams.length} exam(s), ${record.files.length} file(s), ` +
      `${(bytes / (1024 * 1024)).toFixed(1)} MiB; every exam has a visual check recorded as clear.`,
  );
  const held = record.files.filter((file) => file.acceptedFindings.length > 0).length;
  if (held > 0) {
    deps.out(
      `Note: ${held} file(s) carry a finding accepted by a recorded decision. The platform will hold them: ` +
        'nobody but the host and operators can open them until an operator records a decision there.',
    );
  }
  const state = readState(statePath, emptyState(apiBase, slug, sample.recordDigest));

  if (values['dry-run']) {
    deps.out('Dry run: no connection is opened, nothing is uploaded.');
    deps.out(`  would upload into "${slug}" on ${apiBase} (PRIVATE, access tier CONTROLLED)`);
    deps.out(
      `  ${Object.keys(state.uploaded).length} file(s) are recorded as uploaded in the state file`,
    );
    deps.out(`  state: ${statePath}`);
    deps.out(`  manifest: ${manifestPath}`);
    return EXIT_OK;
  }

  const token = deps.env.OCI_API_TOKEN;
  if (!token) {
    throw new Refusal(`no session token: put the operator's own token in $${TOKEN_VARIABLE}`);
  }
  const api = deps.openApi(apiBase, token);

  try {
    const manifest = await uploadSample(
      sample,
      {
        apiBase,
        datasetSlug: slug,
        firstVersion: values['first-version'],
        fileListVersion: values['publish-file-list'] ?? null,
        manifestBase,
        concurrency,
      },
      state,
      {
        api,
        read: (relative, offset, length) =>
          readBytes(path.join(folder, ...relative.split('/')), offset, length),
        saveState: (current) => replaceFile(statePath, `${JSON.stringify(current, null, 2)}\n`),
        out: deps.out,
        now: deps.now,
      },
    );
    writeNewFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    deps.out(
      `Done: ${manifest.files.length} file(s) attached to "${slug}" version ${manifest.version}` +
        `${manifest.heldFiles > 0 ? `, of which ${manifest.heldFiles} held by the platform` : ''}.`,
    );
    deps.out(`Manifest written to ${manifestPath}.`);
    return EXIT_OK;
  } catch (err) {
    if (err instanceof NotUploadable) throw err;
    const message =
      err instanceof PlatformApiError || err instanceof PlatformDisagrees || err instanceof Error
        ? err.message
        : 'unknown error';
    deps.err(`Stopped: ${message}`);
    if (!(err instanceof PlatformDisagrees)) {
      deps.err(
        `Progress is in ${statePath}. Run the same command again to continue` +
          `${err instanceof PlatformApiError && err.status === 401 ? `, with a new token in $${TOKEN_VARIABLE}` : ''}.`,
      );
    }
    return EXIT_FAILED;
  }
}

/** Run the command. Returns the process exit code; never calls `process.exit`. */
export async function run(argv: readonly string[], deps: UploadCliDependencies): Promise<number> {
  try {
    return await runUpload(argv, deps);
  } catch (err) {
    if (err instanceof NotUploadable) {
      deps.err('Refused: this folder may not be uploaded.');
      for (const reason of err.reasons) deps.err(`  ${reason}`);
      return EXIT_REFUSED;
    }
    if (err instanceof Refusal || err instanceof RecordPathError) {
      deps.err(`Refused: ${err.message}`);
      deps.err('Run with --help for the options.');
      return EXIT_REFUSED;
    }
    deps.err(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_FAILED;
  }
}

/** The real thing: the process environment and the platform's API over HTTPS. */
export function defaultDependencies(): UploadCliDependencies {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    env: process.env,
    workingDirectory: process.env.INIT_CWD ?? process.cwd(),
    repositoryRoot: path.resolve(here, '..', '..'),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    openApi: (apiBase, token) => new HttpPlatformApi(apiBase, token),
    now: () => new Date(),
  };
}
