/* eslint-disable security/detect-non-literal-fs-filename -- the folder and the files are the operator's own arguments; outputs are vetted by output-path.ts */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { IDENTIFYING_ATTRIBUTES } from '@oci/dicom';
import {
  ACCEPTABLE_BY_DECISION,
  AcceptedFindingsSchema,
  attributeListDigest,
  checkSample,
  type AcceptedFindings,
  type ArrivalCheckResult,
} from './arrival-check.js';
import { buildRecord } from './arrival-record.js';
import { newOutputFile, writeNewFile } from './output-path.js';
import { RecordPathError } from './purge-record.js';
import { describeError } from './safe-error.js';
import { describeTransferSyntax } from './transfer-syntaxes.js';
import { buildSheet } from './visual-check-sheet.js';

/** Everything the command touches outside its arguments, so tests can replace it. */
export interface CheckCliDependencies {
  /** Folder that relative paths on the command line are read against. */
  workingDirectory: string;
  /** The checkout this script runs from; nothing is written inside it. */
  repositoryRoot: string;
  out: (line: string) => void;
  err: (line: string) => void;
  now: () => Date;
}

export const EXIT_OK = 0;
/** The sample was read and is refused. Nothing may be uploaded. */
export const EXIT_SAMPLE_REFUSED = 1;
/** The command itself was refused, before any file was read. */
export const EXIT_REFUSED = 2;
/** The command failed part-way for a reason of its own (an output could not be written). */
export const EXIT_FAILED = 3;

/** How many files of one problem are named in the terminal; the record names them all. */
const FILES_SHOWN = 20;

export const USAGE = `Check a sample of exams on arrival, before anything is uploaded.

  check-exam-sample <folder> [options]

Reads the header of every file under the folder, with the platform's own DICOM
reader and its own list of identifying attributes. Opens no network connection.
Refuses the sample (exit 1) when an identifying attribute is populated, when a
file or folder name breaks the naming convention, or when a file is not a DICOM
image. Prints, per exam: series, images, slice thickness, modality and transfer
syntax. Never prints the value of an identifying attribute, nor a name it refuses.

Options
  --record-out <file>       Write the record of the check (JSON: paths, checksums,
                            counts, attribute names). Needed later by the upload.
  --sheet-out <file>        Write the record sheet of the visual check (CSV, one line
                            per exam) for the person who looks for burned-in text.
  --accept-findings <file>  A recorded decision (JSON) that accepts named attributes,
                            limited to: ${ACCEPTABLE_BY_DECISION.join(', ')}.
                            Without it every finding refuses the sample.
  --list-attributes         Print the platform's list of identifying attributes and stop.
  -h, --help                Show this text.

Both output files must be new and outside any git working tree.
Guide for the institution: docs/for-hosts/providing-an-exam-sample.md
Operator steps: docs/runbooks/exam-sample-intake.md`;

class Refusal extends Error {}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function readDecisions(file: string, deps: CheckCliDependencies): AcceptedFindings {
  const absolute = path.resolve(deps.workingDirectory, file);
  let text: string;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch (err) {
    throw new Refusal(`cannot read the decisions file ${absolute}: ${describeError(err)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // The parser's message quotes the text it could not read.
    throw new Refusal(`the decisions file ${absolute} is not JSON`);
  }
  const parsed = AcceptedFindingsSchema.safeParse(json);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(file)'}: ${issue.message}`,
    );
    throw new Refusal(`the decisions file ${absolute} is not valid:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

function printReport(result: ArrivalCheckResult, deps: CheckCliDependencies): void {
  const { out } = deps;
  out(
    `Read ${result.filesRead} file(s), ${megabytes(result.totalBytes)}, against the platform's list of ` +
      `${IDENTIFYING_ATTRIBUTES.length} identifying attributes (list ${attributeListDigest().slice(0, 12)}).`,
  );
  out('');
  for (const exam of result.exams) {
    out(`Exam ${exam.exam}  (ref ${exam.ref})  folder: ${exam.folders.join(', ')}`);
    for (const series of exam.series) {
      const syntaxes = series.transferSyntaxes.map((uid) => describeTransferSyntax(uid).name);
      const parts = [
        `series ${series.number ?? '?'}`,
        series.modality ?? 'no modality',
        `${series.images} image(s)`,
        series.dimensions.join(' and ') || 'no size',
        series.sliceThicknessMm.length > 0
          ? `slice thickness ${series.sliceThicknessMm.join(', ')} mm`
          : 'no slice thickness',
        syntaxes.join(', ') || 'no transfer syntax',
      ];
      if (series.multiFrameObjects > 0) parts.push(`${series.multiFrameObjects} multi-frame`);
      if (series.secondaryCapture) parts.push('SECONDARY CAPTURE');
      out(`  ${parts.join('  |  ')}`);
    }
  }
  if (result.exams.length > 0) out('');

  if (result.accepted.length > 0) {
    out('Accepted by a recorded decision (the platform will still hold these files after upload):');
    for (const accepted of result.accepted) {
      out(
        `  ${accepted.attribute}: ${accepted.files} file(s), ${accepted.distinctValues} distinct value(s). Reason recorded: ${accepted.reason}`,
      );
    }
    out('');
  }
  if (result.warnings.length > 0) {
    out('To know before the workshop (none of these refuses the sample):');
    for (const warning of result.warnings) out(`  ${warning}`);
    out('');
  }
  if (result.problems.length > 0) {
    out('Problems:');
    for (const problem of result.problems) {
      out(
        `  ${problem.summary}${problem.files.length > 0 ? `: ${problem.files.length} file(s)` : ''}`,
      );
      for (const file of problem.files.slice(0, FILES_SHOWN)) out(`      ${file}`);
      if (problem.files.length > FILES_SHOWN) {
        out(`      … and ${problem.files.length - FILES_SHOWN} more, all named in the record`);
      }
    }
    out('');
  }
}

function runCheck(argv: readonly string[], deps: CheckCliDependencies): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        'record-out': { type: 'string' },
        'sheet-out': { type: 'string' },
        'accept-findings': { type: 'string' },
        'list-attributes': { type: 'boolean', default: false },
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
  if (values['list-attributes']) {
    for (const { tag, attribute } of IDENTIFYING_ATTRIBUTES) {
      deps.out(`(${tag.slice(0, 4)},${tag.slice(4)})  ${attribute}`);
    }
    return EXIT_OK;
  }
  const stray = positionals.find((positional) => positional.startsWith('-'));
  if (stray) throw new Refusal(`"${stray}" came after a bare "--" and was not read as an option`);
  const [folderArgument, ...extra] = positionals;
  if (folderArgument === undefined || extra.length > 0) {
    throw new Refusal('give exactly one folder to check');
  }
  const folder = path.resolve(deps.workingDirectory, folderArgument);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new Refusal(`${folder} is not a folder`);
  }

  // Everything that can refuse the command comes before the first file is read.
  const decisions = values['accept-findings']
    ? readDecisions(values['accept-findings'], deps)
    : null;
  const recordPath = values['record-out']
    ? newOutputFile(values['record-out'], deps.workingDirectory, deps.repositoryRoot)
    : null;
  const sheetPath = values['sheet-out']
    ? newOutputFile(values['sheet-out'], deps.workingDirectory, deps.repositoryRoot)
    : null;
  if (recordPath !== null && recordPath === sheetPath) {
    throw new Refusal('--record-out and --sheet-out name the same file');
  }

  const result = checkSample(folder, { accepted: decisions });
  printReport(result, deps);
  const record = buildRecord(result, decisions, deps.now());

  if (recordPath) {
    writeNewFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    deps.out(`Record written to ${recordPath}.`);
  }
  if (result.verdict === 'REFUSED') {
    deps.err(
      `REFUSED: ${result.problems.length} kind(s) of problem. Nothing may be uploaded. ` +
        'The institution corrects the sample at source and sends it again; do not edit the files here.',
    );
    return EXIT_SAMPLE_REFUSED;
  }

  if (sheetPath) {
    writeNewFile(sheetPath, buildSheet(record));
    deps.out(`Visual-check sheet written to ${sheetPath}: one line per exam, to fill in.`);
  }
  deps.out(
    `PASSED: ${result.exams.length} exam(s), ${result.files.length} image(s). ` +
      'Still to do before any upload: a person opens every exam once and looks for text burned into the images.',
  );
  if (!recordPath || !sheetPath) {
    deps.out('The upload needs both --record-out and --sheet-out: run again with them.');
  }
  return EXIT_OK;
}

/** Run the command. Returns the process exit code; never calls `process.exit`. */
export function run(argv: readonly string[], deps: CheckCliDependencies): number {
  try {
    return runCheck(argv, deps);
  } catch (err) {
    if (err instanceof Refusal || err instanceof RecordPathError) {
      deps.err(`Refused: ${err.message}`);
      deps.err('Run with --help for the options.');
      return EXIT_REFUSED;
    }
    deps.err(`Failed: ${describeError(err)}`);
    return EXIT_FAILED;
  }
}

/** The real thing: the process's folders and its terminal. */
export function defaultDependencies(): CheckCliDependencies {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    // `pnpm run` starts the script in this package's folder and keeps the
    // folder the operator was in as INIT_CWD.
    workingDirectory: process.env.INIT_CWD ?? process.cwd(),
    repositoryRoot: path.resolve(here, '..', '..'),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    now: () => new Date(),
  };
}
