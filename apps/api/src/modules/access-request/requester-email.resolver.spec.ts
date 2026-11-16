import { describe, expect, it, vi } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type { CognitoAdminClient } from '../identity-admin/cognito-admin.client.js';
import { RequesterEmailResolver } from './requester-email.resolver.js';

/** A deployed Cognito access token: UUID sub, a username, no e-mail claim (#656). */
function deployedToken(username = 'f3a1c2d4-user'): CognitoAccessTokenPayload {
  return {
    sub: '6f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11',
    username,
    token_use: 'access',
  } as unknown as CognitoAccessTokenPayload;
}

function resolverWith(getVerifiedEmail: ReturnType<typeof vi.fn>) {
  return new RequesterEmailResolver({ getVerifiedEmail } as unknown as CognitoAdminClient);
}

describe('RequesterEmailResolver (#656)', () => {
  it('uses the e-mail in the token when there is one, without calling Cognito', async () => {
    const lookup = vi.fn();
    const out = await resolverWith(lookup).resolve({
      sub: 'researcher@uni.example',
    } as unknown as CognitoAccessTokenPayload);

    expect(out).toBe('researcher@uni.example');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('looks up the verified e-mail by username for a deployed access token', async () => {
    const lookup = vi.fn().mockResolvedValue('researcher@uni.example');

    expect(await resolverWith(lookup).resolve(deployedToken('user-1'))).toBe(
      'researcher@uni.example',
    );
    expect(lookup).toHaveBeenCalledWith('user-1');
  });

  it('returns null when the user pool has no verified e-mail', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    expect(await resolverWith(lookup).resolve(deployedToken())).toBeNull();
  });

  it('reuses a lookup for the same user instead of calling Cognito on every request', async () => {
    const lookup = vi.fn().mockResolvedValue('researcher@uni.example');
    const resolver = resolverWith(lookup);

    await resolver.resolve(deployedToken('user-1'));
    await resolver.resolve(deployedToken('user-1'));

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('scores as unknown when the lookup fails, and retries on the next request', async () => {
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(new Error('throttled'))
      .mockResolvedValueOnce('researcher@uni.example');
    const resolver = resolverWith(lookup);

    expect(await resolver.resolve(deployedToken('user-1'))).toBeNull();
    expect(await resolver.resolve(deployedToken('user-1'))).toBe('researcher@uni.example');
  });

  it('returns null without a lookup when the token has neither e-mail nor username', async () => {
    const lookup = vi.fn();
    const out = await resolverWith(lookup).resolve({
      sub: '6f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11',
    } as unknown as CognitoAccessTokenPayload);

    expect(out).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });
});
