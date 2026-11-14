import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CognitoAdminClient } from './cognito-admin.client.js';

function clientReturning(send: ReturnType<typeof vi.fn>): CognitoAdminClient {
  const c = new CognitoAdminClient();
  Object.defineProperty(c, 'client', { value: { send } });
  return c;
}

function attrs(email: string, verified: string) {
  return {
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: verified },
    ],
  };
}

describe('CognitoAdminClient.getVerifiedEmail (#656)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.OCI_ENV = 'dev';
    process.env.COGNITO_USER_POOL_ID = 'eu-central-1_TEST';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('returns the e-mail when Cognito marks it verified', async () => {
    const send = vi.fn().mockResolvedValue(attrs('researcher@uni.example', 'true'));
    expect(await clientReturning(send).getVerifiedEmail('user-1')).toBe('researcher@uni.example');
  });

  it('returns null for an unverified e-mail, so nobody can claim a domain by typing it', async () => {
    const send = vi.fn().mockResolvedValue(attrs('dean@uni.example', 'false'));
    expect(await clientReturning(send).getVerifiedEmail('user-1')).toBeNull();
  });

  it('returns null for an unknown user', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('no user'), { name: 'UserNotFoundException' }));
    expect(await clientReturning(send).getVerifiedEmail('ghost')).toBeNull();
  });

  it('lets other errors through so the caller can decide', async () => {
    const send = vi.fn().mockRejectedValue(new Error('throttled'));
    await expect(clientReturning(send).getVerifiedEmail('user-1')).rejects.toThrow('throttled');
  });
});
