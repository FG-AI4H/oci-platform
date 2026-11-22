import { createHash } from 'node:crypto';
import { canonicalize } from './canonicalize.js';

/**
 * sha256 of the RFC 8785 canonical JSON of `payload`. Emitted as
 * lower-case hex to match the `encode(digest(...), 'hex')` form the
 * Postgres trigger uses for `record_hash`.
 */
export function payloadHash(payload: Record<string, unknown>): string {
  return canonicalSha256(payload);
}

/**
 * The same rule for any JSON value, for a reader that gets a stored
 * payload back as `unknown`. The writer only ever hashes objects; a
 * stored payload that is not one still gets a hash, which then cannot
 * match, so a verifier reports it instead of throwing.
 */
export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
