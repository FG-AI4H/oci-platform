import { validate } from '@oci/croissant';
import {
  BUNDLED_FILE_DESCRIPTIONS,
  buildManifest,
  describeTextFile,
  hostedImages,
  metadataCsv,
  type HostedFile,
  type Json,
} from './manifest.js';
import {
  CAMPAIGN_SLUG,
  DATASET_SLUG,
  EVALUATION_TASK_SLUG,
  METADATA_FILE,
  PROFILE,
  SEED,
  TEACHING_FILES,
} from './profile.js';
import { buildSeedSql } from './seed-sql.js';
import { formatJson, type Selection } from './selection-file.js';
import { buildTeachingFiles, type TeachingFiles } from './teaching-files.js';

/**
 * Everything the profile ships that is not an input (#644): the manifest, the
 * public metadata file, the three teaching files and the seed SQL, generated
 * from the selection and the hidden labels. Pure: the same inputs give the
 * same bytes, which is what lets a test pin the committed files to them.
 */

export interface ProfileOutputs {
  /** File content by path relative to the profile directory. */
  files: Map<string, string>;
  /** The small files the migrate task uploads, by name. */
  bundled: Map<string, string>;
  manifest: Json;
  design: TeachingFiles['design'];
}

export class GenerateError extends Error {}

export async function buildProfileOutputs(
  selection: Selection,
  labels: ReadonlyMap<string, 0 | 1>,
): Promise<ProfileOutputs> {
  if (!selection.standIn && selection.source.readme === null) {
    throw new GenerateError(
      'The README shipped in the source download has not been recorded. Read it, then copy its text, its file name and the date into "source.readme" of selection.json. Real data is not prepared before that.',
    );
  }

  const teaching = buildTeachingFiles(selection, labels, SEED);
  const bundled = new Map<string, string>([
    [METADATA_FILE, metadataCsv(selection)],
    [TEACHING_FILES[0], teaching.modelA],
    [TEACHING_FILES[1], teaching.modelB],
    [TEACHING_FILES[2], teaching.modelC],
  ]);
  const bundledFiles: HostedFile[] = [...bundled].map(([name, content]) =>
    describeTextFile(name, content, BUNDLED_FILE_DESCRIPTIONS.get(name) ?? name),
  );

  const manifest = buildManifest(selection, bundledFiles);
  const report = validate(manifest, { accessTier: 'OPEN' });
  if (report.issues.length > 0) {
    throw new GenerateError(
      `The generated manifest does not validate:\n${JSON.stringify(report.issues, null, 2)}`,
    );
  }

  const fixture = `fixtures/${DATASET_SLUG}`;
  const files = new Map<string, string>([
    [`${fixture}/manifest.json`, await formatJson(manifest)],
    ...[...bundled].map(([name, content]): [string, string] => [`${fixture}/${name}`, content]),
    // What the one-off reset of the migrate task is allowed to touch: participants'
    // work on these objects, addressed by slug, and nothing else.
    [
      'reset.json',
      await formatJson({
        profile: PROFILE,
        evaluationTaskSlugs: [EVALUATION_TASK_SLUG],
        campaignSlugs: [CAMPAIGN_SLUG],
      }),
    ],
    [
      'seed.sql',
      buildSeedSql({
        selection,
        labels,
        manifest,
        files: [...bundledFiles, ...hostedImages(selection)],
      }),
    ],
  ]);
  return { files, bundled, manifest, design: teaching.design };
}
