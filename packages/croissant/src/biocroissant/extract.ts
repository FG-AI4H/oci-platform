/**
 * Extract modality labels from a BIOCroissant manifest (#247).
 *
 * BIOCroissant 0.1 carries imaging-modality terms under
 * `bio:imagingModality` (the schema is in `./schema.ts`). Older
 * manifests may also surface a `bio:dataModality` slot — accept both
 * so non-imaging datasets (text, EHR, time-series) can declare what
 * they are without abusing the imaging field. The MLCommons authoring
 * tools emit `DefinedTerm` references with either a `name` (free text)
 * or a `termCode`; both shapes are accepted here, mirroring the DUO
 * extractor.
 *
 * The validator strips `bio:` / `cr:` prefixes; raw manifests carry
 * either form. We check both prefixed and bare keys.
 *
 * Returns a deduplicated, free-text array. The caller maps each entry
 * to a canonical key via `canonicalizeModality` in
 * `@oci/shared-types/modality-task-kinds`. Unrecognised values are
 * preserved here (the catalog list / detail render them verbatim);
 * the constraint logic on the campaign-create form ignores them and
 * falls back to "allow all task kinds + warn".
 */

interface DefinedTermRef {
  '@id'?: unknown;
  name?: unknown;
  termCode?: unknown;
}

/**
 * Keys we scan for modality entries. Order matters only insofar as
 * duplicates across keys are de-duped on output; the canonical-key
 * mapping done downstream is order-independent.
 */
const MODALITY_KEYS: readonly string[] = [
  'bio:imagingModality',
  'imagingModality',
  'bio:dataModality',
  'dataModality',
];

export function extractModalities(croissant: unknown): string[] {
  if (!croissant || typeof croissant !== 'object') return [];
  const m = croissant as Record<string, unknown>;

  const out = new Set<string>();
  for (const key of MODALITY_KEYS) {
    // eslint-disable-next-line security/detect-object-injection -- typed key allowlist
    const raw = m[key];
    if (raw === undefined || raw === null) continue;
    const arr = Array.isArray(raw) ? raw : [raw];
    for (const entry of arr) {
      const label = pickLabel(entry);
      if (label) out.add(label);
    }
  }
  return [...out];
}

function pickLabel(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const s = entry.trim();
    return s.length > 0 ? s : null;
  }
  if (entry && typeof entry === 'object') {
    const e = entry as DefinedTermRef;
    // Prefer the human-readable name (matches what authors type into the
    // wizard); fall back to termCode (RadLex CID or similar); never use
    // bare `@id` because that's a URL.
    if (typeof e.name === 'string' && e.name.trim().length > 0) return e.name.trim();
    if (typeof e.termCode === 'string' && e.termCode.trim().length > 0) {
      return e.termCode.trim();
    }
  }
  return null;
}
