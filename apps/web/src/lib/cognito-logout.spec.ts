import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cognitoLogoutUrl, resetCognitoLogoutCache } from './cognito-logout';

const ISSUER = 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_TEST';
const CLIENT_ID = 'abc123';
const RETURN_TO = 'https://dev.oci.ai4h.net/';

function fetchReturning(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('cognitoLogoutUrl', () => {
  beforeEach(() => resetCognitoLogoutCache());

  it('builds the hosted-UI logout URL from the discovery document', async () => {
    const fetchImpl = fetchReturning({
      end_session_endpoint: 'https://oci-dev.auth.eu-central-1.amazoncognito.com/logout',
    });
    const url = await cognitoLogoutUrl(
      { issuer: ISSUER, clientId: CLIENT_ID, returnTo: RETURN_TO },
      fetchImpl,
    );
    expect(url).toBe(
      'https://oci-dev.auth.eu-central-1.amazoncognito.com/logout' +
        '?client_id=abc123&logout_uri=https%3A%2F%2Fdev.oci.ai4h.net%2F',
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      `${ISSUER}/.well-known/openid-configuration`,
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('is null without an issuer or client id (local dev), without fetching', async () => {
    const fetchImpl = fetchReturning({});
    expect(
      await cognitoLogoutUrl(
        { issuer: undefined, clientId: CLIENT_ID, returnTo: RETURN_TO },
        fetchImpl,
      ),
    ).toBeNull();
    expect(
      await cognitoLogoutUrl(
        { issuer: ISSUER, clientId: undefined, returnTo: RETURN_TO },
        fetchImpl,
      ),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is null when discovery fails or carries no https end_session_endpoint', async () => {
    const failing = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(
      await cognitoLogoutUrl({ issuer: ISSUER, clientId: CLIENT_ID, returnTo: RETURN_TO }, failing),
    ).toBeNull();

    resetCognitoLogoutCache();
    const notOk = fetchReturning({ end_session_endpoint: 'https://x/logout' }, false);
    expect(
      await cognitoLogoutUrl({ issuer: ISSUER, clientId: CLIENT_ID, returnTo: RETURN_TO }, notOk),
    ).toBeNull();

    resetCognitoLogoutCache();
    const http = fetchReturning({ end_session_endpoint: 'http://x/logout' });
    expect(
      await cognitoLogoutUrl({ issuer: ISSUER, clientId: CLIENT_ID, returnTo: RETURN_TO }, http),
    ).toBeNull();
  });

  it('caches a successful discovery and retries after a failed one', async () => {
    const okFetch = fetchReturning({ end_session_endpoint: 'https://x/logout' });
    await cognitoLogoutUrl({ issuer: ISSUER, clientId: CLIENT_ID, returnTo: RETURN_TO }, okFetch);
    await cognitoLogoutUrl({ issuer: ISSUER, clientId: CLIENT_ID, returnTo: RETURN_TO }, okFetch);
    expect(okFetch).toHaveBeenCalledTimes(1);

    resetCognitoLogoutCache();
    const failing = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    await cognitoLogoutUrl({ issuer: ISSUER, clientId: CLIENT_ID, returnTo: RETURN_TO }, failing);
    const url = await cognitoLogoutUrl(
      { issuer: ISSUER, clientId: CLIENT_ID, returnTo: RETURN_TO },
      okFetch,
    );
    expect(url).toContain('https://x/logout?');
  });
});
