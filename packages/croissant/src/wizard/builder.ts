/**
 * Croissant manifest builder for the wizard (PR K, #90).
 *
 * Pure function: takes a structured `ManifestWizardInput` (validated
 * Zod-side by `@oci/shared-types`) and produces the JSON-LD shape
 * `validate()` from this package accepts. The wizard runs this on
 * each input change to drive the live preview, and once more at
 * submit time to produce the manifest the publish endpoint receives.
 *
 * The output is intentionally minimal — the wizard is not the place
 * to express every Croissant 1.1 capability. Hosts who need
 * RecordSets, Fields with detailed type definitions, ODRL Offers,
 * PROV-O provenance, etc. use the paste-form escape hatch. The
 * generated manifest is always a valid superset target the host can
 * copy out of the preview pane and edit by hand if needed.
 */

import type { ManifestWizardInput } from '@oci/shared-types';
import { NS } from '../namespaces/index.js';

const STANDARD_CONTEXT: Record<string, string> = {
  '@language': 'en',
  '@vocab': NS.schema,
  sc: NS.schema,
  cr: NS.cr,
  rai: NS.rai,
  prov: NS.prov,
  odrl: NS.odrl,
  dct: NS.dct,
  bio: NS.bio,
};

/**
 * Build a Croissant 1.1 (or 1.0) JSON-LD document from the wizard's
 * structured input. Always returns a JSON-serialisable object.
 *
 * Field omissions:
 *   - Optional fields with no value are omitted entirely (not nulled)
 *     so the output stays minimal and round-trips cleanly through
 *     external tools.
 *   - Empty arrays for biomedical / DUO / distribution sections are
 *     omitted.
 *   - `notes` is the publish-action's per-version note, not part of
 *     the manifest, so it isn't reflected here.
 */
export function manifestWizardInputToCroissant(
  input: ManifestWizardInput,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    '@context': STANDARD_CONTEXT,
    '@type': 'sc:Dataset',
    'dct:conformsTo': input.conformsTo,
    name: input.name,
    description: input.description,
    license: input.license,
    url: input.homepage,
    creator: input.creators.map((c) => ({
      '@type': c.type === 'Organization' ? 'sc:Organization' : 'sc:Person',
      name: c.name,
    })),
    datePublished: input.datePublished,
    'cr:version': input.version,
  };

  if (input.citeAs && input.citeAs.length > 0) out.citeAs = input.citeAs;

  // BioCroissant fields — wrap each string in `{ name }` so they render
  // alongside hand-authored manifests that use the same DefinedTerm shape.
  if (input.imagingModality.length > 0) {
    out['bio:imagingModality'] = input.imagingModality.map((name) => ({ name }));
  }
  if (input.bodyRegion.length > 0) {
    out['bio:bodyRegion'] = input.bodyRegion.map((name) => ({ name }));
  }
  if (input.diseaseCondition.length > 0) {
    out['bio:diseaseCondition'] = input.diseaseCondition.map((name) => ({ name }));
  }
  if (input.anonymizationLevel) {
    out['bio:anonymizationLevel'] = input.anonymizationLevel;
  }

  // DUO consent codes — DefinedTerm references with the OBO IRI + short
  // termCode. The validator accepts either form.
  if (input.duoTerms.length > 0) {
    out.consentCode = input.duoTerms.map((id) => ({
      '@type': 'sc:DefinedTerm',
      '@id': `http://purl.obolibrary.org/obo/${id}`,
      termCode: id,
    }));
  }

  // Distributions — flat FileObject shape. Hosts who need FileSets
  // (globs over many files) use the paste-form escape hatch.
  if (input.distributions.length > 0) {
    out.distribution = input.distributions.map((d) => ({
      '@type': 'sc:FileObject',
      '@id': d.croissantId,
      name: d.name,
      encodingFormat: d.encodingFormat,
      contentUrl: d.contentUrl,
    }));
  }

  return out;
}
