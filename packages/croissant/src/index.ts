/**
 * @oci/croissant — Croissant 1.1 / RAI / BIOCroissant validator.
 *
 * Layered design:
 *   - croissant10/   base 1.0 schema (MLCommons, March 2024). Locked.
 *   - croissant11/   1.1 deltas (Feb 2026): PROV-O, DUO, ODRL, vocab framework.
 *   - rai/           Croissant Responsible AI extension (20 properties).
 *   - biocroissant/  OCI Platform v0.1 health extension (DRAFT — see ADR-0002).
 *   - validator/     normalize + dispatch + JSON-Pointer error reporting.
 *
 * Single entry point:
 *
 *   import { validate } from '@oci/croissant';
 *   const result = validate(jsonLdManifest);
 *   if (!result.ok) {
 *     // result.issues has stable codes + JSON Pointer paths
 *   }
 *
 * The validator accepts both prefixed (`sc:name`, `cr:RecordSet`,
 * `bio:imagingModality`) and bare key forms — see validator/normalize.ts
 * for the prefix list it strips. JSON-LD `@context` expansion against
 * arbitrary user-defined aliases is OUT OF SCOPE for v0.1 (we don't ship
 * jsonld.js); ~all real-world Croissant manifests use the standard
 * prefix vocabulary so this is fine in practice. If a manifest with a
 * custom `@context` ever needs to round-trip, swap normalize() for
 * jsonld.expand() at this boundary.
 */

export { validate } from './validator/index.js';
export type {
  ValidationResult,
  ValidationIssue,
  ValidationLevel,
  Conformance,
} from './validator/index.js';

export { Croissant10Schema, type Croissant10 } from './croissant10/schema.js';
export { Croissant11DeltasSchema, type Croissant11Deltas } from './croissant11/schema.js';
export { RaiExtensionSchema, RAI_PROPERTIES, type RaiExtension } from './rai/schema.js';
export {
  BioCroissantSchema,
  BIOCROISSANT_PROPERTIES,
  type BioCroissant,
} from './biocroissant/schema.js';

export { NS, CONFORMS_TO } from './namespaces/index.js';

export {
  DUO_REGISTRY,
  lookupDuoTerm,
  isKnownDuoTerm,
  normaliseDuoId,
  type DuoTerm,
  type DuoCategory,
} from './duo/registry.js';
export { extractDuoTerms } from './duo/extract.js';
export { extractModalities } from './biocroissant/extract.js';
export { manifestWizardInputToCroissant } from './wizard/builder.js';
