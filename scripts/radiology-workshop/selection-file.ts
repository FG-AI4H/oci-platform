import { format } from 'prettier';
import { z } from 'zod';
import { parseCsvRecords, toCsv } from './csv.js';
import { AGE_BANDS, PROFILE, SEXES } from './profile.js';
import { LABEL_SOURCES } from './upstream.js';

/**
 * The pinned selection: the ONE input that turns the profile from synthetic
 * stand-in into real data (#644). It names the images, where each was
 * fetched from and what it hashed to, the two public subgroup fields and the
 * reading subset. Everything else in the profile (manifest, metadata file,
 * teaching files, seed SQL) is generated from it and from the hidden labels.
 *
 * THE REFERENCE LABELS ARE NOT IN THIS FILE, and the type below has no field
 * for one. The manifest and the public metadata file are built from a
 * `Selection` alone, so they cannot carry a label even by mistake. The labels
 * live in `reference-labels.hidden.csv` beside it, which only the seed SQL
 * and the teaching-file generator read.
 */

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const SelectionImageSchema = z
  .object({
    /** Item identifier: the upstream file name without its extension. */
    imageId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
    /** Upstream file name. */
    file: z.string().regex(/^[A-Za-z0-9_-]{1,120}\.png$/),
    sex: z.enum(SEXES),
    ageBand: z.enum(AGE_BANDS),
    /** In the reading subset of the annotation campaign. */
    campaign: z.boolean(),
    /** The file as fetched from upstream. `null` until it has been fetched once. */
    upstream: z.object({ sha256, bytes: z.number().int().positive() }).strict().nullable(),
    /** The file as hosted, after any resize. `null` until it has been prepared. */
    hosted: z
      .object({
        sha256,
        bytes: z.number().int().positive(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type SelectionImage = z.infer<typeof SelectionImageSchema>;

export const SelectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z.literal(PROFILE),
    /**
     * True for the synthetic stand-in. A stand-in is never seeded on a
     * deployed environment and never uploaded to one.
     */
    standIn: z.boolean(),
    seed: z.number().int(),
    /** Day the selection was made. Dates the slice in the manifest; fixed so regeneration is stable. */
    preparedOn: isoDate,
    /** The rule the images were chosen by, in words. */
    rule: z.string().min(1),
    source: z
      .object({
        name: z.string().min(1),
        /** The page the source publishes the files on. */
        downloadPage: z.url(),
        /** Metadata file the selection was drawn from. */
        metadataFile: z.string().min(1),
        /** Address the image files were fetched from. `null` until fetched. */
        imagesFetchedFrom: z.string().min(1).nullable(),
        /**
         * The README shipped in the download, read by a person and copied
         * here with the date. `null` until that has been done: the generator
         * then writes a marked placeholder, and refuses to prepare real data.
         */
        readme: z
          .object({ file: z.string().min(1), recordedOn: isoDate, text: z.string().min(1) })
          .strict()
          .nullable(),
      })
      .strict(),
    finding: z
      .object({
        /** Column or label name in the label source. */
        sourceName: z.string().min(1),
        nameEn: z.string().min(1),
        nameFr: z.string().min(1),
      })
      .strict(),
    labelSource: z.enum(LABEL_SOURCES),
    images: z.array(SelectionImageSchema).min(1),
  })
  .strict()
  .superRefine((selection, ctx) => {
    const ids = new Set(selection.images.map((i) => i.imageId));
    if (ids.size !== selection.images.length) {
      ctx.addIssue({ code: 'custom', message: 'an imageId appears more than once' });
    }
    for (const image of selection.images) {
      if (image.file !== `${image.imageId}.png`) {
        ctx.addIssue({ code: 'custom', message: `file of ${image.imageId} is not <imageId>.png` });
      }
    }
  });
export type Selection = z.infer<typeof SelectionSchema>;

export function parseSelection(json: string): Selection {
  return SelectionSchema.parse(JSON.parse(json));
}

/** Prettier-formatted, so the file passes the repository's format check as written. */
export async function formatJson(value: unknown): Promise<string> {
  return format(JSON.stringify(value), { parser: 'json', printWidth: 100 });
}

export const HIDDEN_LABELS_HEADER = ['image_id', 'finding_present'] as const;

/** `image_id,finding_present` with 0 or 1, in the order of the selection. */
export function hiddenLabelsCsv(selection: Selection, labels: ReadonlyMap<string, 0 | 1>): string {
  return toCsv([
    [...HIDDEN_LABELS_HEADER],
    ...selection.images.map((image) => {
      const label = labels.get(image.imageId);
      if (label === undefined) throw new Error(`no reference label for ${image.imageId}`);
      return [image.imageId, String(label)];
    }),
  ]);
}

/** Read the hidden labels and check they cover the selection exactly. */
export function parseHiddenLabels(csvText: string, selection: Selection): Map<string, 0 | 1> {
  const labels = new Map<string, 0 | 1>();
  for (const record of parseCsvRecords(csvText, HIDDEN_LABELS_HEADER, 'Hidden label file')) {
    const id = record.get('image_id') ?? '';
    const value = record.get('finding_present');
    if (value !== '0' && value !== '1') {
      // The identifier is named; the value is not, since messages end up in logs.
      throw new Error(`Hidden label file: the label of ${id} is neither 0 nor 1.`);
    }
    labels.set(id, value === '1' ? 1 : 0);
  }
  const ids = new Set(selection.images.map((i) => i.imageId));
  const missing = [...ids].filter((id) => !labels.has(id));
  const extra = [...labels.keys()].filter((id) => !ids.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Hidden label file does not match the selection: ${missing.length} image(s) without a label, ${extra.length} label(s) for images not selected.`,
    );
  }
  return labels;
}
