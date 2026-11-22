import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { StorageAccessError, type ObjectVersionStore } from './purge-object-store.js';
import {
  checkPrefix,
  isEmpty,
  PrefixRefusedError,
  purgePrefix,
  type Inventory,
  type PurgeReport,
} from './purge-objects.js';
import {
  assertRecordPathAllowed,
  PURGE_TOOL,
  PURGE_TOOL_VERSION,
  RecordPathError,
  writeRecord,
  type PurgeRecord,
} from './purge-record.js';
import { S3ObjectVersionStore } from './purge-s3-object-store.js';

/** Everything the command touches outside its arguments, so tests can replace it. */
export interface PurgeCliDependencies {
  env: Readonly<Record<string, string | undefined>>;
  /** Folder that relative paths on the command line are read against. */
  workingDirectory: string;
  /** The checkout this script runs from; the record may not be inside it. */
  repositoryRoot: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Called at most once, and never for a refused command. */
  openStore: (bucket: string, region: string, endpoint: string | undefined) => ObjectVersionStore;
  now: () => Date;
}

export const EXIT_OK = 0;
/** The command ran and something is left, or the storage could not be used. */
export const EXIT_FAILED = 1;
/** The command was refused before anything was changed. */
export const EXIT_REFUSED = 2;

export const USAGE = `Remove every object version, delete marker and unfinished upload of one dataset
from a versioned bucket. Without --execute it only counts.

  purge-dataset-objects --prefix <slug>/ [--bucket <name>]
  purge-dataset-objects --prefix <slug>/ --execute --confirm-prefix <slug>/ --record-out <file>

On a versioned bucket an ordinary delete only hides an object; the bytes stay as a
noncurrent version. This command names and removes every version, then lists again
and fails unless nothing is left.

Options
  --bucket <name>          Bucket to work on. Default: $OCI_DATASETS_BUCKET.
  --prefix <slug>/         Key prefix of the dataset: its slug followed by "/".
  --execute                Delete. Without it nothing is changed.
  --confirm-prefix <p>     Required with --execute; must repeat --prefix exactly.
  --record-out <file>      Write the deletion record (counts and sizes, no keys) to this
                           new file, outside any git working tree. Required with --execute.
  --region <region>        Default: $AWS_REGION, else eu-central-1.
  -h, --help               Show this text.

Credentials come from the environment (the operator's assumed role). Keys are never
printed or recorded: a file name is part of its key. Database rows are not touched;
see docs/runbooks/exam-sample-deletion.md for the whole procedure.`;

class Refusal extends Error {}

interface Arguments {
  bucket: string | null;
  prefix: string | null;
  confirmPrefix: string | null;
  recordOut: string | null;
  region: string;
  execute: boolean;
  help: boolean;
}

function readArguments(argv: readonly string[], deps: PurgeCliDependencies): Arguments {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: {
        bucket: { type: 'string' },
        prefix: { type: 'string' },
        'confirm-prefix': { type: 'string' },
        'record-out': { type: 'string' },
        region: { type: 'string' },
        execute: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    throw new Refusal(err instanceof Error ? err.message : String(err));
  }
  const { values } = parsed;
  return {
    bucket: values.bucket ?? deps.env.OCI_DATASETS_BUCKET ?? null,
    prefix: values.prefix ?? null,
    confirmPrefix: values['confirm-prefix'] ?? null,
    recordOut: values['record-out'] ?? null,
    region: values.region ?? deps.env.AWS_REGION ?? 'eu-central-1',
    execute: values.execute,
    help: values.help,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units.at(unit) ?? 'TiB'} (${bytes} bytes)`;
}

function printInventory(inventory: Inventory, deps: PurgeCliDependencies): void {
  const noncurrent = inventory.versions - inventory.currentVersions;
  deps.out(`  keys                ${inventory.keys}`);
  deps.out(
    `  object versions     ${inventory.versions}  (${inventory.currentVersions} current, ${noncurrent} noncurrent), ${formatBytes(inventory.bytes)}`,
  );
  deps.out(`  delete markers      ${inventory.deleteMarkers}`);
  deps.out(`  unfinished uploads  ${inventory.incompleteUploads}  (parts not sized)`);
}

/**
 * A storage message can quote the key it was about. Anything that
 * starts like a key under the prefix is cut out before printing.
 */
export function withoutKeys(message: string, prefix: string): string {
  let out = message;
  for (let at = out.indexOf(prefix); at !== -1; at = out.indexOf(prefix, at + 5)) {
    let end = at + prefix.length;
    while (end < out.length && !/[\s"'<>,;)]/.test(out.charAt(end))) end += 1;
    out = `${out.slice(0, at)}<key>${out.slice(end)}`;
  }
  return out;
}

function outcomeOf(report: PurgeReport): PurgeRecord['outcome'] {
  if (report.deleted === null || report.remaining === null) return 'dry-run';
  return isEmpty(report.remaining) && Object.keys(report.failures).length === 0
    ? 'complete'
    : 'incomplete';
}

async function runPurge(args: Arguments, deps: PurgeCliDependencies): Promise<number> {
  // Order matters: every check that can refuse the command comes before
  // openStore, so a slip costs no call to the storage.
  if (args.prefix === null) throw new Refusal('give the dataset prefix: --prefix <slug>/');
  const prefix = checkPrefix(args.prefix);
  if (!args.bucket) throw new Refusal('no bucket: pass --bucket or set OCI_DATASETS_BUCKET');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(args.bucket)) {
    throw new Refusal(`"${args.bucket}" is not a bucket name`);
  }
  if (!args.execute && args.confirmPrefix !== null) {
    throw new Refusal(
      '--confirm-prefix is only read with --execute; without it nothing is deleted',
    );
  }
  if (args.execute) {
    if (args.confirmPrefix === null) {
      throw new Refusal(`--execute needs --confirm-prefix ${prefix}`);
    }
    if (args.confirmPrefix !== prefix) {
      throw new Refusal(
        `--confirm-prefix "${args.confirmPrefix}" is not the prefix "${prefix}"; nothing was deleted`,
      );
    }
    if (args.recordOut === null) {
      throw new Refusal(
        '--execute needs --record-out <file>: the record is the evidence of the deletion',
      );
    }
  }
  const recordPath =
    args.recordOut === null
      ? null
      : assertRecordPathAllowed(
          path.resolve(deps.workingDirectory, args.recordOut),
          deps.repositoryRoot,
        );

  const endpoint = deps.env.S3_ENDPOINT || undefined;
  const store = deps.openStore(args.bucket, args.region, endpoint);
  const startedAt = deps.now();

  const versioning = await store.versioning();
  const locked = await store.objectLockEnabled();
  deps.out(
    `Bucket ${args.bucket}, prefix ${prefix}  (versioning: ${versioning}, Object Lock: ${locked ? 'on' : 'off'})`,
  );
  if (endpoint) deps.out(`Storage endpoint: ${endpoint} (not AWS)`);
  if (locked && args.execute) {
    throw new Refusal(
      'Object Lock is on for this bucket: locked versions cannot be removed, and this command never bypasses a retention rule. Nothing was deleted.',
    );
  }

  deps.out(
    args.execute
      ? 'Deleting: every version, delete marker and unfinished upload under the prefix.'
      : 'Dry run: nothing is deleted.',
  );
  const report = await purgePrefix({ store, prefix, execute: args.execute, progress: deps.out });

  deps.out('Found under the prefix:');
  printInventory(report.found, deps);
  if (locked) {
    deps.out('Object Lock is on for this bucket: a run with --execute would be refused.');
  }

  const outcome = outcomeOf(report);
  if (report.deleted !== null && report.remaining !== null) {
    deps.out('Deleted:');
    deps.out(
      `  object versions     ${report.deleted.versions}, ${formatBytes(report.deleted.bytes)}`,
    );
    deps.out(`  delete markers      ${report.deleted.deleteMarkers}`);
    deps.out(`  unfinished uploads  ${report.deleted.incompleteUploadsAborted}`);
    for (const [code, count] of Object.entries(report.failures)) {
      deps.err(`  could not remove ${count} entr${count === 1 ? 'y' : 'ies'}: ${code}`);
    }
    deps.out('Left under the prefix, from a fresh listing:');
    printInventory(report.remaining, deps);
  }

  if (recordPath !== null) {
    writeRecord(recordPath, {
      tool: PURGE_TOOL,
      toolVersion: PURGE_TOOL_VERSION,
      mode: args.execute ? 'execute' : 'dry-run',
      outcome,
      bucket: args.bucket,
      prefix,
      endpoint: endpoint ?? null,
      versioning,
      startedAt: startedAt.toISOString(),
      finishedAt: deps.now().toISOString(),
      ...report,
    });
    deps.out(`Record written to ${recordPath} (counts only, no keys).`);
  }

  switch (outcome) {
    case 'dry-run':
      deps.out(
        isEmpty(report.found)
          ? 'Nothing is stored under this prefix.'
          : `To delete: run again with --execute --confirm-prefix ${prefix} --record-out <file>`,
      );
      return EXIT_OK;
    case 'complete':
      deps.out(
        isEmpty(report.found)
          ? 'Nothing was stored under this prefix; nothing to delete.'
          : 'Done: nothing is left under the prefix.',
      );
      return EXIT_OK;
    case 'incomplete':
      deps.err(
        'NOT complete: something is left under the prefix. Find the cause from the codes above, then run the same command again; it is safe to repeat.',
      );
      return EXIT_FAILED;
  }
}

/** Run the command. Returns the process exit code; never calls `process.exit`. */
export async function run(argv: readonly string[], deps: PurgeCliDependencies): Promise<number> {
  let prefixForRedaction = '';
  try {
    const args = readArguments(argv, deps);
    if (args.help) {
      deps.out(USAGE);
      return EXIT_OK;
    }
    prefixForRedaction = args.prefix?.trim() ?? '';
    return await runPurge(args, deps);
  } catch (err) {
    if (
      err instanceof Refusal ||
      err instanceof PrefixRefusedError ||
      err instanceof RecordPathError
    ) {
      deps.err(`Refused: ${err.message}`);
      deps.err('Run with --help for the options.');
      return EXIT_REFUSED;
    }
    if (err instanceof StorageAccessError) {
      deps.err(
        `Failed: ${err.message}. Check the role you are signed in with and the bucket name.`,
      );
      return EXIT_FAILED;
    }
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    deps.err(
      `Failed: ${name}: ${prefixForRedaction ? withoutKeys(message, prefixForRedaction) : message}`,
    );
    return EXIT_FAILED;
  }
}

/** The real thing: the process environment and an S3 bucket. */
export function defaultDependencies(): PurgeCliDependencies {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    env: process.env,
    // `pnpm run` starts the script in this package's folder and keeps the
    // folder the operator was in as INIT_CWD.
    workingDirectory: process.env.INIT_CWD ?? process.cwd(),
    repositoryRoot: path.resolve(here, '..', '..'),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    openStore: (bucket, region, endpoint) =>
      S3ObjectVersionStore.forBucket(bucket, region, endpoint),
    now: () => new Date(),
  };
}
