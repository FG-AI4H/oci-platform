import { createHash } from 'node:crypto';

/**
 * Map a Cognito `sub` to a stable UUID we can store in `uuid` columns.
 *
 * Real Cognito subs are already RFC 4122 v4 UUIDs and round-trip
 * unchanged. The local-dev auth stub (see [cognito-jwt.guard.ts](./
 * cognito-jwt.guard.ts)) stamps `sub` with the raw user value typed
 * into the sign-in form (e.g. `cm`, `bob`, an email), which fails the
 * `uuid` column constraint at insert time. Derive a deterministic v5
 * UUID from the sub in that case so dev runs stay typesafe without
 * leaking dev-specific values into prod code paths.
 *
 * The namespace UUID is arbitrary but fixed — DO NOT change it without
 * a migration story; existing rows referencing the v5-derived id would
 * orphan if the derivation drifts.
 */
const SUB_NAMESPACE_UUID = 'a4f1c8b2-7d3e-5b9c-9f0a-3c8d4e5f6a7b';

export function cognitoSubAsUuid(sub: string): string {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(sub)) {
    return sub.toLowerCase();
  }
  return uuidV5(sub, SUB_NAMESPACE_UUID);
}

/**
 * RFC 4122 §4.3 name-based UUID (v5, SHA-1). Tiny inline impl so we
 * don't pull in the `uuid` package just for this one call.
 *
 * Steps:
 *   1. Concatenate the namespace bytes (16) and the name bytes.
 *   2. SHA-1 the concatenation.
 *   3. Take the first 16 bytes; set the version (5) and variant
 *      (RFC 4122) bits per the spec.
 *   4. Format as 8-4-4-4-12 hex.
 */
function uuidV5(name: string, namespace: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(Buffer.from(name, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  // RFC 4122 v5: set bits 12–15 of time_hi_and_version to 0101.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  // Variant: set bits 6–7 of clock_seq_hi_and_reserved to 10.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
