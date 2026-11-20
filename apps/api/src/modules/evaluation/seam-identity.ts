import { createHash } from 'node:crypto';

/**
 * Derive the stable `submittedBy` uuid for an external (EvalAI) entrant.
 *
 * WP6's quota is keyed on `submittedBy`, so this function decides what the
 * published "3 per week / 10 per task" cap actually binds. It binds the string
 * the seam sends — `participant_team:<pk>` — which is the team, matching the
 * unit EvalAI enforces its own quotas on. Per-user would let a three-member
 * team take thirty scored submissions.
 *
 * A SEPARATE namespace from `cognitoSubAsUuid`: an EvalAI identifier and a
 * dev-stub Cognito sub must never collide into one participant, however
 * unlikely the string clash. Changing this namespace re-keys every existing
 * quota, so it needs a migration story — do not touch it casually.
 */
const EXTERNAL_PARTICIPANT_NAMESPACE = 'b7e2d9f4-1a6c-5e8b-8d3f-2b9c7a4e1f60';

export function externalParticipantAsUuid(externalParticipantId: string): string {
  return uuidV5(externalParticipantId, EXTERNAL_PARTICIPANT_NAMESPACE);
}

/** RFC 4122 §4.3 name-based UUID (v5, SHA-1) — same inline impl as cognito-sub. */
function uuidV5(name: string, namespace: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  const b6 = bytes.at(6) ?? 0;
  const b8 = bytes.at(8) ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x50; // version 5
  bytes[8] = (b8 & 0x3f) | 0x80; // RFC 4122 variant
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
