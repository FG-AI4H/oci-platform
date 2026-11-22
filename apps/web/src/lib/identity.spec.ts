import type { Session } from 'next-auth';
import { describe, expect, it } from 'vitest';
import { isHostOfDataset, subToUuid, viewerUuid } from './identity';
import { groupsFromAccessToken, subjectFromAccessToken } from './token-claims';

/** A Cognito-shaped access token: header.payload.signature, payload base64url. */
function cognitoToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', kid: 'k' })}.${b64(payload)}.sig`;
}

/** A real pool subject: version nibble 7, variant nibble 5 — not an RFC 9562 UUID. */
const COGNITO_SUB = 'e3b418e2-f0a1-70fd-524a-8a6c453745c2';

/** The session of a caller holding this access token, as `auth.ts` describes them. */
function session(accessToken: string, user: Record<string, unknown> = {}): Session {
  return {
    groups: groupsFromAccessToken(accessToken),
    subject: subjectFromAccessToken(accessToken) ?? undefined,
    user,
    expires: '2099-01-01T00:00:00.000Z',
  } as unknown as Session;
}

describe('viewer identity', () => {
  it('reads the subject from a Cognito access token, as the API does, even without session.user.id', () => {
    const s = session(cognitoToken({ sub: COGNITO_SUB, 'cognito:groups': ['host'] }), {
      email: 'holder@oci-demo.invalid',
    });
    expect(viewerUuid(s)).toBe(COGNITO_SUB);
    expect(isHostOfDataset(s, COGNITO_SUB)).toBe(true);
    expect(isHostOfDataset(s, COGNITO_SUB.toUpperCase())).toBe(true);
  });

  it('is not the host without the host group, or for another dataset', () => {
    const noGroup = session(cognitoToken({ sub: COGNITO_SUB, 'cognito:groups': [] }));
    expect(isHostOfDataset(noGroup, COGNITO_SUB)).toBe(false);
    const host = session(cognitoToken({ sub: COGNITO_SUB, 'cognito:groups': ['host'] }));
    expect(isHostOfDataset(host, '00000000-0000-4000-8000-000000000401')).toBe(false);
  });

  it('derives the local-dev subject the same way as the API (v5 UUID of a non-UUID user)', () => {
    const s = session('dev:draft-host:host');
    expect(viewerUuid(s)).toBe(subToUuid('draft-host'));
    expect(isHostOfDataset(s, subToUuid('draft-host'))).toBe(true);
  });

  it('falls back to session.user.id when there is no usable access token', () => {
    const s = session('', { id: COGNITO_SUB });
    expect(viewerUuid(s)).toBe(COGNITO_SUB);
    expect(viewerUuid(null)).toBeNull();
  });
});
