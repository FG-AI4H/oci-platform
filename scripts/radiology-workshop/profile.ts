import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Names and fixed parameters of the `radiology-workshop` seed profile (#644):
 * the content for the December 2026 radiology workshop. Everything a deploy
 * or an operator addresses by name is declared here, once.
 *
 * The profile is a second seed file and fixture set beside the demo seed. It
 * is replayed by the migrate task only on environments that list it in
 * `OCI_SEED_PROFILES` (see `infra/cdk/lib/environments.ts`), never on prod.
 */

export const PROFILE = 'radiology-workshop';

/** Catalogue slug of the hosted chest X-ray slice. */
export const DATASET_SLUG = 'nih-chestxray14-workshop';
export const DATASET_VERSION = '1.0.0';
/** Evaluation task: one binary finding over every image of the slice. */
export const EVALUATION_TASK_SLUG = 'nih-chestxray14-finding';
/** Annotation campaign over the reading subset. */
export const CAMPAIGN_SLUG = 'nih-chestxray14-reading';
export const MODEL_A_SLUG = 'workshop-cxr-model-a';
export const MODEL_B_SLUG = 'workshop-cxr-model-b';

/** Images in the slice, and in the reading subset the campaign uses. */
export const SLICE_SIZE = 200;
export const CAMPAIGN_SIZE = 60;
/** Readers per image at gate 1 (ADR-0009 default). */
export const READERS_PER_IMAGE = 3;
/**
 * Abandonment timeout of the workshop campaign. One hour, so an image left
 * open by a reader who walked away returns to the queue within the session,
 * and that reader stops counting towards the fairness cap after two (#669).
 */
export const TASK_TIMEOUT_HOURS = 1;

/** Hosted images are at most this many pixels on their longest side. */
export const MAX_SIDE_PX = 1024;

/**
 * Seed of every pseudo-random choice (selection, reading subset, teaching
 * files). Changing it changes all of them; keep it for a byte-identical
 * regeneration.
 */
export const SEED = 20261217;

export const SEXES = ['F', 'M'] as const;
export type Sex = (typeof SEXES)[number];

/** Age is published as a band, never as a number of years. */
export const AGE_BANDS = ['18-39', '40-59', '60+'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Band of an age in whole years; `null` outside the adult range the slice covers. */
export function ageBandOf(years: number): AgeBand | null {
  if (!Number.isInteger(years) || years < 18 || years > 100) return null;
  if (years < 40) return '18-39';
  if (years < 60) return '40-59';
  return '60+';
}

/** The subgroup model B is built to fail in. */
export const MODEL_B_WEAK_AGE_BAND: AgeBand = '60+';

/** Stand-in created-by id of the SQL seed (the dev-stub user of `demo.sql`). */
export const SEED_USER_ID = '00000000-0000-4000-8000-000000000099';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../..');
/** Committed profile: selection, hidden labels, generated seed and fixtures. */
export const PROFILE_DIR = path.join(REPO_ROOT, 'packages/database/seed/profiles', PROFILE);
export const FIXTURE_DIR = path.join(PROFILE_DIR, 'fixtures', DATASET_SLUG);
export const SELECTION_FILE = path.join(PROFILE_DIR, 'selection.json');
export const HIDDEN_LABELS_FILE = path.join(PROFILE_DIR, 'reference-labels.hidden.csv');
export const SEED_SQL_FILE = path.join(PROFILE_DIR, 'seed.sql');

/** Small files bundled in the repository and uploaded by the migrate task. */
export const METADATA_FILE = 'metadata.csv';
export const TEACHING_FILES = ['model-a.csv', 'model-b.csv', 'model-c.csv'] as const;

const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // RFC 4122 URL namespace

/**
 * Deterministic UUIDv5, the scheme `idrid-grading-demo/generate.mjs` uses, so
 * a regenerated seed addresses the rows it wrote before.
 */
export function uuid5(name: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(UUID_NAMESPACE.replaceAll('-', ''), 'hex'))
    .update(name)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6); // version 5
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8); // RFC 4122 variant
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
