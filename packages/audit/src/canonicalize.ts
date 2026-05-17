/**
 * RFC 8785 — JSON Canonicalization Scheme (JCS).
 *
 * The canonical form is the input that goes into `sha256(payload)` for
 * the `payloadHash` column. Regulators verifying an exported audit
 * bundle offline must be able to recompute this hash without running
 * the platform — RFC 8785 is the IETF-standard way to make that
 * reproducible across languages.
 *
 * Rules in scope:
 *   - Object keys serialized in lexicographic order of their UTF-16
 *     code units (i.e. JavaScript's default string sort).
 *   - Strings use the JSON escape set per ECMA-262 §24.5.2.2.
 *   - Numbers are emitted via the ES2017 `Number.prototype.toString`
 *     algorithm via JSON.stringify, which RFC 8785 explicitly aligns to.
 *   - `null`, `true`, `false`, arrays, and nested objects recurse.
 *
 * Not supported (will throw):
 *   - non-finite numbers (NaN, +/-Inf)
 *   - bigint
 *   - functions / symbols / undefined values inside an object
 *
 * The implementation is dependency-free so the package stays leaf in
 * the dependency graph (it's imported by every domain module).
 */

export function canonicalize(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalize: non-finite number is not allowed (${value})`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') {
    throw new TypeError('canonicalize: bigint is not allowed in JSON payloads');
  }
  if (Array.isArray(value)) {
    return '[' + value.map(serialize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const parts: string[] = [];
    for (const [k, v] of entries) {
      if (v === undefined) continue; // JSON.stringify drops undefined; JCS follows
      parts.push(JSON.stringify(k) + ':' + serialize(v));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError(`canonicalize: unsupported value of type ${typeof value}`);
}
