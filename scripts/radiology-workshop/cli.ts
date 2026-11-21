/* eslint-disable security/detect-non-literal-fs-filename --
 * An operator tool: every path is a directory the operator passed on the
 * command line, or a fixed file name inside the profile directory. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { NIH_DOWNLOAD_PAGE } from './content.js';
import { prepareImages } from './fetch.js';
import { buildProfileOutputs } from './generate.js';
import {
  CAMPAIGN_SIZE,
  DATASET_SLUG,
  PROFILE,
  PROFILE_DIR,
  REPO_ROOT,
  SEED,
  SLICE_SIZE,
  sha256Hex,
} from './profile.js';
import { selectImages, type SelectionOptions } from './select.js';
import {
  formatJson,
  hiddenLabelsCsv,
  parseHiddenLabels,
  parseSelection,
  SelectionSchema,
  type Selection,
} from './selection-file.js';
import {
  renderStandInImage,
  STAND_IN_FINDING,
  STAND_IN_LABELS_FILE,
  STAND_IN_METADATA_FILE,
  standInUpstream,
} from './standin.js';
import {
  labelsFromAdjudicatedFile,
  labelsFromReportMining,
  readNihMetadata,
  type LabelSource,
} from './upstream.js';

/**
 * Operator commands for the `radiology-workshop` seed profile (#644).
 * Operator guide: docs/for-operators/demo-seed.md.
 *
 *   standin         write synthetic stand-in metadata and label files
 *   select          choose the images; writes selection.json and the hidden labels
 *   standin-images  draw the placeholder images of a stand-in selection
 *   fetch           fetch, verify, resize; pins checksums into selection.json
 *   generate        write the manifest, metadata, teaching files and seed SQL
 *   check           fail if the committed files differ from a fresh generation
 *   upload          upload the prepared files to a datasets bucket
 *
 * No command prints a reference label. Counts are printed; identifiers with
 * their label never are.
 */

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

const HELP = `usage: pnpm radiology-workshop <command> [options]

  standin         --dir <dir>
  select          --metadata <csv> --label-source <adjudicated|report-mined> --finding <name>
                  --finding-fr <text> [--labels <csv>] [--finding-en <text>] [--views PA]
                  [--prevalence 0.4] [--prepared-on YYYY-MM-DD] [--stand-in]
  standin-images  --dir <dir>
  fetch           --source-dir <dir> --work-dir <dir> [--base-url <https://…>]
                  [--fetched-from <text>] [--pin] [--repin-hosted]
  generate        [--work-dir <dir>]
  check
  upload          --work-dir <dir> --bucket <name> [--endpoint <url>]

Every command takes --profile-dir <dir> (default: the committed profile).`;

class UsageError extends Error {}

function need(value: string | undefined, option: string): string {
  if (value === undefined || value === '') throw new UsageError(`--${option} is required.`);
  return value;
}

interface Paths {
  profileDir: string;
  selection: string;
  hiddenLabels: string;
}

function pathsOf(profileDir: string): Paths {
  return {
    profileDir,
    selection: path.join(profileDir, 'selection.json'),
    hiddenLabels: path.join(profileDir, 'reference-labels.hidden.csv'),
  };
}

function loadSelection(paths: Paths): Selection {
  if (!existsSync(paths.selection)) {
    throw new UsageError(`${paths.selection} does not exist yet: run "select" first.`);
  }
  return parseSelection(readFileSync(paths.selection, 'utf8'));
}

async function saveSelection(paths: Paths, selection: Selection): Promise<void> {
  mkdirSync(paths.profileDir, { recursive: true });
  writeFileSync(paths.selection, await formatJson(SelectionSchema.parse(selection)));
}

function ruleInWords(options: SelectionOptions): string {
  return (
    `${options.size} images drawn with a fixed seed (${options.seed}) from the images of the metadata file that have a reference label, ` +
    `a patient aged 18 or over, sex recorded as F or M and a ${options.views.join(' or ')} projection. ` +
    `Six strata (sex by age band: 18-39, 40-59, 60+) of equal size to within one image, ${Math.round(options.prevalence * 100)}% of each with the finding; ` +
    `at most one image per patient. ${options.campaignSize} of them, with the same balance, form the reading subset.`
  );
}

// --- commands ----------------------------------------------------------------

function standin(dir: string, io: Io): void {
  const upstream = standInUpstream(SEED);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, STAND_IN_METADATA_FILE), upstream.metadataCsv);
  writeFileSync(path.join(dir, STAND_IN_LABELS_FILE), upstream.labelsCsv);
  io.out(
    `Wrote ${STAND_IN_METADATA_FILE} and ${STAND_IN_LABELS_FILE} to ${dir} (synthetic, not diagnostic).`,
  );
  io.out(`Finding column of the stand-in label file: "${STAND_IN_FINDING}".`);
}

interface SelectArgs {
  metadata: string;
  labels?: string;
  labelSource: string;
  finding: string;
  findingEn?: string;
  findingFr: string;
  views: string;
  prevalence: string;
  preparedOn?: string;
  standIn: boolean;
}

async function select(paths: Paths, args: SelectArgs, io: Io): Promise<void> {
  const { images: pool, excluded } = readNihMetadata(readFileSync(args.metadata, 'utf8'));
  let labelSource: LabelSource;
  let labels;
  if (args.labelSource === 'adjudicated') {
    labelSource = 'radiologist-adjudicated';
    labels = labelsFromAdjudicatedFile(
      readFileSync(need(args.labels, 'labels'), 'utf8'),
      args.finding,
    );
  } else if (args.labelSource === 'report-mined') {
    labelSource = 'nih-report-mined';
    labels = labelsFromReportMining(pool, args.finding);
  } else {
    throw new UsageError('--label-source is "adjudicated" or "report-mined".');
  }
  if (args.standIn) labelSource = 'synthetic-stand-in';

  const prevalence = Number(args.prevalence);
  if (!(prevalence > 0 && prevalence < 1)) throw new UsageError('--prevalence is between 0 and 1.');
  const options: SelectionOptions = {
    seed: SEED,
    size: SLICE_SIZE,
    campaignSize: CAMPAIGN_SIZE,
    prevalence,
    views: args.views.split(',').map((v) => v.trim().toUpperCase()),
  };
  const result = selectImages(pool, labels, options);

  const selection: Selection = {
    schemaVersion: 1,
    profile: PROFILE,
    standIn: args.standIn,
    seed: SEED,
    preparedOn: args.preparedOn ?? new Date().toISOString().slice(0, 10),
    rule: ruleInWords(options),
    source: {
      name: 'NIH ChestX-ray14',
      downloadPage: NIH_DOWNLOAD_PAGE,
      metadataFile: path.basename(args.metadata),
      imagesFetchedFrom: null,
      readme: null,
    },
    finding: {
      sourceName: args.finding,
      nameEn: args.findingEn ?? args.finding,
      nameFr: args.findingFr,
    },
    labelSource,
    images: result.images.map((image) => ({ ...image, upstream: null, hosted: null })),
  };
  await saveSelection(paths, selection);
  writeFileSync(paths.hiddenLabels, hiddenLabelsCsv(selection, result.labels));

  for (const [reason, count] of excluded)
    io.out(`Left out of the pool: ${count} row(s), ${reason}.`);
  io.out(`Pool: ${pool.length} image(s), ${labels.size} with a reference label.`);
  io.out(
    `Selected ${result.images.length} image(s), ${result.images.filter((i) => i.campaign).length} in the reading subset.`,
  );
  for (const quota of result.quotas) {
    io.out(
      `  ${quota.sex} ${quota.ageBand}: ${quota.positives} with the finding, ${quota.negatives} without`,
    );
  }
  io.out(`Wrote ${paths.selection}`);
  io.out(
    `Wrote ${paths.hiddenLabels} (HIDDEN reference labels: never upload or publish this file).`,
  );
  io.out('Next: fetch the files listed in selection.json, then run "fetch --pin".');
}

function standinImages(paths: Paths, dir: string, io: Io): void {
  const selection = loadSelection(paths);
  if (!selection.standIn) {
    throw new UsageError(
      'The selection is not a stand-in: placeholder images are not drawn for real data.',
    );
  }
  mkdirSync(dir, { recursive: true });
  for (const image of selection.images) {
    writeFileSync(path.join(dir, image.file), renderStandInImage(image.file));
  }
  io.out(
    `Drew ${selection.images.length} placeholder image(s) in ${dir} (synthetic, not diagnostic).`,
  );
}

interface FetchArgs {
  sourceDir: string;
  workDir: string;
  baseUrl?: string;
  fetchedFrom?: string;
  pin: boolean;
  repinHosted: boolean;
}

async function fetchCommand(paths: Paths, args: FetchArgs, io: Io): Promise<void> {
  const selection = loadSelection(paths);
  if (!selection.standIn && selection.source.readme === null) {
    io.err(
      'Reminder: the README of the source download is not recorded in selection.json yet. "generate" will refuse until it is.',
    );
  }
  const result = await prepareImages({ selection, ...args });
  await saveSelection(paths, result.selection);
  io.out(
    `Prepared ${result.selection.images.length} file(s) in ${path.join(args.workDir, DATASET_SLUG)}: ` +
      `${result.downloaded} downloaded, ${result.pinned} newly pinned, ${result.resized} resized, ` +
      `${(result.hostedBytes / 1024 / 1024).toFixed(1)} MB to host.`,
  );
  if (result.pinned > 0) io.out(`Checksums recorded in ${paths.selection}: review and commit it.`);
}

async function loadOutputs(paths: Paths) {
  const selection = loadSelection(paths);
  const labels = parseHiddenLabels(readFileSync(paths.hiddenLabels, 'utf8'), selection);
  return { selection, outputs: await buildProfileOutputs(selection, labels) };
}

async function generate(paths: Paths, workDir: string | undefined, io: Io): Promise<void> {
  const { outputs } = await loadOutputs(paths);
  for (const [relative, content] of outputs.files) {
    const target = path.join(paths.profileDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    io.out(`Wrote ${target}`);
  }
  if (workDir) {
    // The uploader reads a fixture directory: the manifest beside the files it lists.
    const fixture = path.join(workDir, DATASET_SLUG);
    mkdirSync(fixture, { recursive: true });
    writeFileSync(
      path.join(fixture, 'manifest.json'),
      outputs.files.get(`fixtures/${DATASET_SLUG}/manifest.json`) ?? '',
    );
    for (const [name, content] of outputs.bundled) writeFileSync(path.join(fixture, name), content);
    io.out(`Copied the manifest and the bundled files to ${fixture} for the upload.`);
  }
  io.out(
    `Teaching files: models A and B each make ${outputs.design.falseNegatives} missed finding(s) and ${outputs.design.falsePositives} false alarm(s); model B's are concentrated in the ${outputs.design.weakAgeBand} age band.`,
  );
}

async function check(paths: Paths, io: Io): Promise<number> {
  const { outputs } = await loadOutputs(paths);
  let stale = 0;
  for (const [relative, content] of outputs.files) {
    const target = path.join(paths.profileDir, relative);
    if (!existsSync(target) || readFileSync(target, 'utf8') !== content) {
      io.err(`Out of date: ${target}`);
      stale += 1;
    }
  }
  if (stale > 0) {
    io.err('Run "pnpm radiology-workshop generate" and commit the result.');
    return 1;
  }
  io.out(`${outputs.files.size} generated file(s) match selection.json and the hidden labels.`);
  return 0;
}

function upload(
  paths: Paths,
  args: { workDir: string; bucket: string; endpoint?: string },
  io: Io,
): number {
  const selection = loadSelection(paths);
  if (/prod/i.test(args.bucket)) {
    throw new UsageError(
      `Refusing to upload to "${args.bucket}": this profile never goes to prod.`,
    );
  }
  if (selection.standIn && !args.endpoint) {
    throw new UsageError(
      'The selection is a synthetic stand-in. It is uploaded to a local S3 endpoint only (--endpoint), never to a deployed environment.',
    );
  }
  const fixture = path.join(args.workDir, DATASET_SLUG);
  const committed = path.join(paths.profileDir, 'fixtures', DATASET_SLUG, 'manifest.json');
  if (
    !existsSync(path.join(fixture, 'manifest.json')) ||
    readFileSync(path.join(fixture, 'manifest.json'), 'utf8') !== readFileSync(committed, 'utf8')
  ) {
    throw new UsageError(
      `The manifest in ${fixture} is not the one in the profile. Run "generate --work-dir ${args.workDir}" first.`,
    );
  }
  for (const image of selection.images) {
    const file = path.join(fixture, image.file);
    if (!existsSync(file) || sha256Hex(readFileSync(file)) !== image.hosted?.sha256) {
      throw new UsageError(
        `${image.file} in ${fixture} is missing or is not the file recorded in selection.json. Run "fetch" again.`,
      );
    }
  }
  io.out(`Verified ${selection.images.length} image file(s) against selection.json. Uploading…`);
  const run = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'apps/migrate/upload-fixtures.mjs')],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        OCI_DATASETS_BUCKET: args.bucket,
        SEED_FIXTURES_DIR: args.workDir,
        SEED_FIXTURES_PROFILE: '1',
        ...(args.endpoint ? { S3_ENDPOINT: args.endpoint } : {}),
      },
    },
  );
  return run.status ?? 1;
}

// --- entry -------------------------------------------------------------------

export async function run(argv: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      'profile-dir': { type: 'string' },
      dir: { type: 'string' },
      metadata: { type: 'string' },
      labels: { type: 'string' },
      'label-source': { type: 'string' },
      finding: { type: 'string' },
      'finding-en': { type: 'string' },
      'finding-fr': { type: 'string' },
      views: { type: 'string', default: 'PA' },
      prevalence: { type: 'string', default: '0.4' },
      'prepared-on': { type: 'string' },
      'stand-in': { type: 'boolean', default: false },
      'source-dir': { type: 'string' },
      'work-dir': { type: 'string' },
      'base-url': { type: 'string' },
      'fetched-from': { type: 'string' },
      pin: { type: 'boolean', default: false },
      'repin-hosted': { type: 'boolean', default: false },
      bucket: { type: 'string' },
      endpoint: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  const [command] = positionals;
  if (values.help || command === undefined) {
    io.out(HELP);
    return command === undefined && !values.help ? 2 : 0;
  }
  const paths = pathsOf(path.resolve(values['profile-dir'] ?? PROFILE_DIR));

  try {
    switch (command) {
      case 'standin':
        standin(need(values.dir, 'dir'), io);
        return 0;
      case 'select':
        await select(
          paths,
          {
            metadata: need(values.metadata, 'metadata'),
            labels: values.labels,
            labelSource: need(values['label-source'], 'label-source'),
            finding: need(values.finding, 'finding'),
            findingEn: values['finding-en'],
            findingFr: need(values['finding-fr'], 'finding-fr'),
            views: values.views,
            prevalence: values.prevalence,
            preparedOn: values['prepared-on'],
            standIn: values['stand-in'],
          },
          io,
        );
        return 0;
      case 'standin-images':
        standinImages(paths, need(values.dir, 'dir'), io);
        return 0;
      case 'fetch':
        await fetchCommand(
          paths,
          {
            sourceDir: need(values['source-dir'], 'source-dir'),
            workDir: need(values['work-dir'], 'work-dir'),
            baseUrl: values['base-url'],
            fetchedFrom: values['fetched-from'],
            pin: values.pin,
            repinHosted: values['repin-hosted'],
          },
          io,
        );
        return 0;
      case 'generate':
        await generate(paths, values['work-dir'], io);
        return 0;
      case 'check':
        return await check(paths, io);
      case 'upload':
        return upload(
          paths,
          {
            workDir: need(values['work-dir'], 'work-dir'),
            bucket: need(values.bucket, 'bucket'),
            endpoint: values.endpoint,
          },
          io,
        );
      default:
        throw new UsageError(`Unknown command "${command}".`);
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    if (error instanceof UsageError) io.err('Run with --help for the options.');
    return error instanceof UsageError ? 2 : 1;
  }
}
