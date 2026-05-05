/**
 * IRI namespace prefixes used across the Croissant ecosystem.
 *
 * Both the JSON-LD `@context` (when present) and any literal IRI fields
 * (`@type`, `dct:conformsTo`, `prov:Activity`, ...) draw from these.
 * The validator's normalization layer recognises these prefixes and
 * accepts both `prefix:Foo` and bare `Foo` forms in input documents.
 */
export const NS = {
  schema: 'https://schema.org/',
  cr: 'http://mlcommons.org/croissant/',
  rai: 'http://mlcommons.org/croissant/RAI/',
  prov: 'http://www.w3.org/ns/prov#',
  odrl: 'http://www.w3.org/ns/odrl/2/',
  duo: 'http://purl.obolibrary.org/obo/',
  dct: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  /**
   * BIOCroissant v0.1 — provisional. The GI-AI4H WG-Data hasn't published
   * a permanent IRI yet; this URL is owned by the OCI Platform and will
   * 301-redirect to the WG-Data canonical IRI once assigned.
   */
  bio: 'https://oci.ai4h.net/biocroissant/v0.1#',
} as const;

/**
 * Conformance target IRIs (`dct:conformsTo` values) we recognise. The
 * validator switches schemas on these.
 */
export const CONFORMS_TO = {
  croissant10: 'http://mlcommons.org/croissant/1.0',
  croissant11: 'http://mlcommons.org/croissant/1.1',
} as const;

/** Known JSON-LD prefixes the normalizer strips when canonicalising keys. */
export const KNOWN_PREFIXES = [
  'sc:',
  'cr:',
  'rai:',
  'prov:',
  'odrl:',
  'dct:',
  'foaf:',
  'duo:',
  'bio:',
] as const;
