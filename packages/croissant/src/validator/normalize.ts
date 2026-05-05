import { KNOWN_PREFIXES } from '../namespaces/index.js';

/**
 * Recursively strip recognised JSON-LD prefixes from object keys so the
 * Zod schemas can reason about a single canonical shape. Both `sc:name`
 * and bare `name` (the latter requires `@vocab: schema.org` in `@context`)
 * collapse to `name` after this pass.
 *
 * If a key appears in BOTH prefixed and bare form (rare but legal), the
 * prefixed value wins — it's the more explicit JSON-LD form.
 *
 * Skipped keys: `@context`, `@type`, `@id`, `@graph`, `@value` — JSON-LD
 * keywords that don't follow the prefix pattern and are consumed verbatim
 * by the validator's conformance + class checks.
 *
 * NOTE: this is a deliberate shortcut. A proper JSON-LD library (jsonld.js)
 * would expand against the document's actual `@context`, handling custom
 * aliases. We don't ship that today because every Croissant manifest in
 * the wild uses the standard prefix vocabulary and the cost of a JSON-LD
 * processor on the upload path is high. If a real-world manifest breaks
 * normalization, switch to `jsonld.expand()` here.
 */
const JSON_LD_KEYWORDS = new Set(['@context', '@type', '@id', '@graph', '@value', '@list', '@set']);

export function normalize(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(normalize);
  if (input == null || typeof input !== 'object') return input;

  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // Two-pass: bare keys first, prefixed second (so prefixed wins on collision).
  // Keys come from `Object.keys(obj)` (enumerable own properties only — no
  // prototype chain), so the dynamic accesses below are safe; the
  // security/detect-object-injection lint trips on the syntax pattern but
  // not on the actual access shape. Suppressing per-statement keeps the
  // signal-to-noise ratio sane on any other dynamic-access in the package.
  const bareKeys: string[] = [];
  const prefixedKeys: string[] = [];
  for (const k of Object.keys(obj)) {
    if (JSON_LD_KEYWORDS.has(k)) {
      // eslint-disable-next-line security/detect-object-injection
      out[k] = normalize(obj[k]);
      continue;
    }
    if (hasKnownPrefix(k)) prefixedKeys.push(k);
    else bareKeys.push(k);
  }

  // eslint-disable-next-line security/detect-object-injection
  for (const k of bareKeys) out[k] = normalize(obj[k]);
  // eslint-disable-next-line security/detect-object-injection
  for (const k of prefixedKeys) out[stripPrefix(k)] = normalize(obj[k]);

  return out;
}

function hasKnownPrefix(key: string): boolean {
  for (const p of KNOWN_PREFIXES) {
    if (key.startsWith(p)) return true;
  }
  return false;
}

function stripPrefix(key: string): string {
  for (const p of KNOWN_PREFIXES) {
    if (key.startsWith(p)) return key.slice(p.length);
  }
  return key;
}
