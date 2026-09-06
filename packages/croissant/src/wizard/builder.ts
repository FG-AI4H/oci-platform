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
 * RecordSet-level provenance, etc. use the paste-form escape hatch.
 * Dataset-level provenance (`bio-prov` v0.1: PROV-O attribution,
 * generating activity, derivation, plus the health qualifiers) is
 * authorable through the wizard's Provenance step since #496 — see
 * `buildProvenance`. The generated manifest is always a valid
 * superset target the host can copy out of the preview pane and edit
 * by hand if needed.
 */

import type { ManifestWizardInput, ManifestWizardProvenance } from '@oci/shared-types';
import { NS } from '../namespaces/index.js';
import { PROVENANCE_PROFILE_VERSION } from '../provenance/schema.js';

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

  // Provenance (bio-prov v0.1, #496) — the profile marker plus whichever
  // blocks the host filled. Emitted whenever the step was visited, even
  // with nothing filled: the marker is what makes the validator report
  // the tier's obligations, which is the feedback the host needs.
  if (input.provenance) {
    Object.assign(out, buildProvenance(input.provenance, input.anonymizationLevel));
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

// ---------------------------------------------------------------------------
// bio-prov v0.1 — dataset-level provenance (spec sections 2, 4 and 5)
// ---------------------------------------------------------------------------

const blank = (v: string | undefined): boolean => v === undefined || v.trim().length === 0;
const text = (v: string): string => v.trim();

/** Copy the non-blank string fields of `source` into a fresh object, in order. */
function pickText<T extends object, K extends keyof T & string>(
  source: T,
  keys: ReadonlyArray<K>,
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of keys) {
    // Keys come from the fixed field lists below, never from input.
    // eslint-disable-next-line security/detect-object-injection
    const v: unknown = source[k];
    // eslint-disable-next-line security/detect-object-injection
    if (typeof v === 'string' && !blank(v)) out[k] = text(v);
  }
  return out;
}

/**
 * Map the wizard's provenance input to the prefixed JSON-LD properties of
 * the `bio-prov` profile. Blank fields are omitted, so a partially filled
 * block is emitted with what the host gave and the validator names the
 * missing piece (`provenance.invalid.H5.approvalNumber`) rather than the
 * whole block going missing silently.
 *
 * `resultingLevel` of the de-identification activity is always the
 * wizard's anonymisation level (spec H4: the two MUST be equal); the step
 * shows it read-only for that reason.
 */
export function buildProvenance(
  p: ManifestWizardProvenance,
  anonymizationLevel: ManifestWizardInput['anonymizationLevel'],
): Record<string, unknown> {
  const out: Record<string, unknown> = { 'bio:provenanceProfile': PROVENANCE_PROFILE_VERSION };

  // P1 — source organisation.
  const orgName = text(p.sourceOrganization.name);
  const organization: Record<string, unknown> | null =
    orgName.length > 0
      ? {
          '@type': 'prov:Organization',
          ...(blank(p.sourceOrganization.id) ? {} : { '@id': text(p.sourceOrganization.id) }),
          name: orgName,
        }
      : null;
  if (organization) out['prov:wasAttributedTo'] = [organization];

  // P3 — upstream entity, when derived.
  const derivedFrom = blank(p.derivedFrom) ? null : text(p.derivedFrom);
  if (derivedFrom) out['prov:wasDerivedFrom'] = { '@type': 'prov:Entity', '@id': derivedFrom };

  // P2 / P4 — the generating activity and its agent. A blank agent falls
  // back to the source organisation (the spec's own example); a software
  // agent acts on behalf of it.
  const c = p.collection;
  if (!blank(c.name) || !blank(c.startedAt) || !blank(c.endedAt) || !blank(c.agentName)) {
    const activity: Record<string, unknown> = {
      '@type': 'prov:Activity',
      '@id': derivedFrom ? '#derivation' : '#collection',
    };
    if (!blank(c.name)) activity.name = text(c.name);
    if (!blank(c.startedAt)) activity['prov:startedAtTime'] = text(c.startedAt);
    if (!blank(c.endedAt)) activity['prov:endedAtTime'] = text(c.endedAt);
    if (!blank(c.agentName)) {
      activity['prov:wasAssociatedWith'] = c.agentIsSoftware
        ? {
            '@type': 'prov:SoftwareAgent',
            name: text(c.agentName),
            ...(organization ? { 'prov:actedOnBehalfOf': organization } : {}),
          }
        : { '@type': 'prov:Organization', name: text(c.agentName) };
    } else if (organization) {
      activity['prov:wasAssociatedWith'] = organization;
    }
    if (derivedFrom) activity['prov:used'] = derivedFrom;
    out['prov:wasGeneratedBy'] = activity;
  }

  // H1 — sites. A site with no name is a blank row and is dropped.
  const sites = p.sites
    .filter((s) => !blank(s.name))
    .map((s) => ({
      name: text(s.name),
      ...(blank(s.country) ? {} : { country: text(s.country) }),
    }));
  if (sites.length > 0) out['bio:sourceSite'] = sites;

  // H2 — the human timeframe.
  if (!blank(p.collectionTimeframe))
    out['rai:dataCollectionTimeframe'] = text(p.collectionTimeframe);

  // H3 — device class and/or equipment.
  if (!blank(p.deviceClass)) {
    out['bio:deviceClass'] = { '@type': 'sc:DefinedTerm', name: text(p.deviceClass) };
  }
  const equipment = pickText(p.equipment, ['manufacturer', 'model', 'softwareVersion']);
  if (Object.keys(equipment).length > 0) out['bio:dataAcquisitionEquipment'] = equipment;

  // H4 — de-identification activity. Keyed on the method: without one
  // there is no act to describe.
  if (p.deidentification.method !== '') {
    const deid: Record<string, unknown> = {
      '@type': 'prov:Activity',
      method: p.deidentification.method,
    };
    if (anonymizationLevel) deid.resultingLevel = anonymizationLevel;
    if (!blank(p.deidentification.endedAt)) {
      deid['prov:endedAtTime'] = text(p.deidentification.endedAt);
    }
    if (!blank(p.deidentification.toolName)) {
      deid['prov:wasAssociatedWith'] = {
        '@type': 'prov:SoftwareAgent',
        name: text(p.deidentification.toolName),
      };
    }
    out['bio:deidentification'] = deid;
  }

  // H5 — ethics approval.
  const ethics = pickText(p.ethics, [
    'approvingBody',
    'approvalNumber',
    'approvalDate',
    'approvalScope',
  ]);
  if (Object.keys(ethics).length > 0) out['bio:irbApproval'] = ethics;

  // H6 — label-production protocol.
  const lp = p.labelProtocol;
  const protocol: Record<string, unknown> = pickText(lp, [
    'version',
    'labelScale',
    'graderQualification',
    'adjudication',
  ]);
  if (lp.gradersPerItem !== undefined) protocol.gradersPerItem = lp.gradersPerItem;
  if (!blank(lp.interRaterAgreement.metric) || lp.interRaterAgreement.value !== undefined) {
    protocol.interRaterAgreement = {
      ...(blank(lp.interRaterAgreement.metric)
        ? {}
        : { metric: text(lp.interRaterAgreement.metric) }),
      ...(lp.interRaterAgreement.value === undefined
        ? {}
        : { value: lp.interRaterAgreement.value }),
    };
  }
  if (lp.perRaterLabelsRetained !== undefined) {
    protocol.perRaterLabelsRetained = lp.perRaterLabelsRetained;
  }
  if (Object.keys(protocol).length > 0) out['bio:labelProtocol'] = protocol;

  return out;
}
