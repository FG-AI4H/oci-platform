/**
 * Extract DUO permission term ids from a Croissant 1.1 manifest's
 * `consentCode` field (PR J.1, #93).
 *
 * Croissant 1.1 carries DUO terms as `DefinedTerm` references — see
 * `Croissant11DeltasSchema.consentCode`. Each entry is one of:
 *
 *   { "@id": "http://purl.obolibrary.org/obo/DUO_0000042" }
 *   { "termCode": "DUO_0000042" }
 *   { "@id": "http://purl.obolibrary.org/obo/DUO_0000042",
 *     "termCode": "DUO_0000042", "name": "..." }
 *
 * We accept any of those shapes and normalise to the OBO short id
 * (`DUO_0000042`). Unrecognised ids (not in the registry) are
 * silently skipped — adding a new term to the registry is a code
 * change; manifests pointing at unfamiliar terms are not invalid.
 *
 * Returns a deduplicated, registry-known subset.
 */

import { isKnownDuoTerm, normaliseDuoId } from './registry.js';

interface DefinedTermRef {
  '@id'?: unknown;
  termCode?: unknown;
}

export function extractDuoTerms(croissant: unknown): string[] {
  if (!croissant || typeof croissant !== 'object') return [];
  const m = croissant as Record<string, unknown>;
  // The validator strips `cr:` prefixes but a raw manifest may carry
  // either form; check both.
  const raw = m.consentCode ?? m['cr:consentCode'];
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];

  const ids = new Set<string>();
  for (const entry of arr) {
    const candidate = pickId(entry);
    if (!candidate) continue;
    const normalised = normaliseDuoId(candidate);
    if (isKnownDuoTerm(normalised)) ids.add(normalised);
  }
  return [...ids];
}

function pickId(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const e = entry as DefinedTermRef;
    if (typeof e['@id'] === 'string') return e['@id'];
    if (typeof e.termCode === 'string') return e.termCode;
  }
  return null;
}
