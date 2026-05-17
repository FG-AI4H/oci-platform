import { createHash } from 'node:crypto';
import { canonicalize } from './canonicalize.js';

/**
 * sha256 of the RFC 8785 canonical JSON of `payload`. Emitted as
 * lower-case hex to match the `encode(digest(...), 'hex')` form the
 * Postgres trigger uses for `record_hash`.
 */
export function payloadHash(payload: Record<string, unknown>): string {
  const canonical = canonicalize(payload);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
