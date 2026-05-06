import type { DatasetDetail } from '@oci/shared-types';

/**
 * Builds a minimal `schema.org/Dataset` JSON-LD block suitable for
 * embedding in `<script type="application/ld+json">` on the catalog
 * detail page so Google Dataset Search can index us.
 *
 * Why a derived block (rather than emitting the full Croissant
 * manifest verbatim):
 *   - Google's parser ignores unknown namespaces (`bio:`, `cr:`, `dct:`)
 *     but the manifest can be 100KB+ with `recordSet[]` and field
 *     descriptors that bloat the HTML and slow up first byte.
 *   - We need `@id`, `url`, and `mainEntityOfPage` to point at the
 *     canonical web URL — overwriting whatever the host put in the
 *     manifest, which is typically a hosting URL or DOI.
 *   - The full Croissant manifest is still discoverable: we add it as
 *     a `distribution[]` entry with `encodingFormat:
 *     application/ld+json`. Google's "Dataset" rich result links to
 *     it; harvesters can fetch it directly.
 *
 * The helper is defensive about the manifest's shape: Croissant 1.1
 * uses bare keys (`name`, `description`, `license`) thanks to its
 * default `@context` mapping `sc:` → `https://schema.org/`, but older
 * authoring tools sometimes emit the prefixed form. Both are read.
 *
 * The output validates against Google's Dataset structured-data tester
 * (https://search.google.com/test/rich-results) and the Schema Markup
 * Validator (https://validator.schema.org/).
 */
type ScKey = 'license' | 'keywords' | 'url' | 'citeAs' | 'sameAs';
type BioKey = 'imagingModality' | 'bodyRegion' | 'diseaseCondition';

export function datasetJsonLd(detail: DatasetDetail, baseUrl: string): Record<string, unknown> {
  const m = (detail.croissant ?? {}) as Record<string, unknown>;
  // Both `key` and `sc:key` / `bio:key` are compile-time literals — the
  // helpers below only accept the union types so eslint's
  // object-injection rule is satisfied without disable comments.
  const sc = (key: ScKey): unknown => Reflect.get(m, key) ?? Reflect.get(m, `sc:${key}`);
  const bio = (key: BioKey): unknown =>
    Reflect.get(m, `bio:${key}`) ?? Reflect.get(m, key);

  const pageUrl = `${baseUrl}/catalog/${detail.slug}`;
  const manifestUrl = `${pageUrl}/croissant`;

  const license = stringifyLicense(sc('license'));
  const keywords = normalizeStringArray(sc('keywords'));
  const homepage = typeof sc('url') === 'string' ? (sc('url') as string) : null;
  const citation = typeof sc('citeAs') === 'string' ? (sc('citeAs') as string) : null;
  const sameAs = normalizeStringArray(sc('sameAs'));
  const version = detail.latestVersion ?? null;

  // Map BIOCroissant medical metadata onto Schema.org `keywords` so
  // Google can match on modality / body region / disease names. Keeping
  // them as free-text in `keywords` is the lowest-friction route to
  // discoverability — Google does not understand `bio:imagingModality`
  // but it indexes keyword strings.
  const bioKeywords = [
    ...extractTermNames(bio('imagingModality')),
    ...extractTermNames(bio('bodyRegion')),
    ...extractTermNames(bio('diseaseCondition')),
  ];

  // De-dupe; preserve original order so manifest authors keep agency.
  const allKeywords = Array.from(new Set([...keywords, ...bioKeywords]));

  // Manifest-declared distributions become `distribution[]`. The full
  // Croissant manifest itself is appended last, so harvesters always
  // find a deterministic JSON-LD entry-point.
  const distributions: Array<Record<string, unknown>> = detail.distributions
    .filter((d) => !d.requiresAccess && d.contentUrl) // public-resolvable only
    .map((d) => ({
      '@type': 'DataDownload',
      name: d.croissantId,
      contentUrl: d.contentUrl,
      encodingFormat: d.contentType,
      ...(d.contentSizeBytes !== null ? { contentSize: String(d.contentSizeBytes) } : {}),
      ...(d.contentHash ? { sha256: d.contentHash } : {}),
    }));

  distributions.push({
    '@type': 'DataDownload',
    name: 'Croissant manifest',
    contentUrl: manifestUrl,
    encodingFormat: 'application/ld+json',
    description: `Croissant ${detail.conformanceVersion ?? ''} JSON-LD manifest`,
  });

  const out: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'Dataset',
    '@id': pageUrl,
    url: pageUrl,
    mainEntityOfPage: pageUrl,
    name: detail.name,
    description: detail.description ?? detail.name,
    identifier: detail.slug,
    isAccessibleForFree: detail.distributions.every((d) => !d.requiresAccess),
    distribution: distributions,
  };

  if (license) out.license = license;
  if (allKeywords.length > 0) out.keywords = allKeywords;
  if (homepage && homepage !== pageUrl) out.sameAs = sameAs.length > 0 ? sameAs : [homepage];
  else if (sameAs.length > 0) out.sameAs = sameAs;
  if (citation) out.citation = citation;
  if (version) out.version = version;

  return out;
}

function normalizeStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object' && 'name' in v) {
        return String((v as { name?: unknown }).name ?? '');
      }
      return '';
    })
    .filter((s): s is string => s.length > 0);
}

function extractTermNames(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return arr
    .map((v) => {
      if (v && typeof v === 'object') {
        const obj = v as { name?: unknown; termCode?: unknown };
        if (typeof obj.name === 'string') return obj.name;
        if (typeof obj.termCode === 'string') return obj.termCode;
      }
      return '';
    })
    .filter((s): s is string => s.length > 0);
}

function stringifyLicense(license: unknown): string | null {
  if (!license) return null;
  if (typeof license === 'string') return license;
  if (Array.isArray(license)) {
    const first = license.find((l) => typeof l === 'string');
    if (typeof first === 'string') return first;
    const named = license.find(
      (l): l is { name?: string; url?: string } =>
        Boolean(l) && typeof l === 'object' && ('name' in l || 'url' in l),
    );
    return named ? (named.url ?? named.name ?? null) : null;
  }
  if (typeof license === 'object' && license !== null) {
    const o = license as { name?: string; url?: string };
    return o.url ?? o.name ?? null;
  }
  return null;
}
