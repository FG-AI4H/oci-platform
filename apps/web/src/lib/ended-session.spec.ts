import { describe, expect, it } from 'vitest';
import { decideForEndedSession, ENDED_SESSION_COOKIE, type IncomingRequest } from './ended-session';

const SESSION_COOKIE = '__Secure-authjs.session-token';

/** A full page load, arriving with the cookie of a session that has just ended. */
function request(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    method: 'GET',
    pathname: '/annotation/campaigns/chest-xr/annotate',
    search: '?task=7',
    cookieNames: [SESSION_COOKIE, 'oci-theme'],
    isPageLoad: true,
    hasSession: false,
    ...overrides,
  };
}

describe('decideForEndedSession', () => {
  it('sends a page load whose session just ended to sign in, with the way back', () => {
    expect(decideForEndedSession(request())).toEqual({
      redirectTo:
        '/signin?reason=expired&callbackUrl=%2Fannotation%2Fcampaigns%2Fchest-xr%2Fannotate%3Ftask%3D7',
      marker: 'clear',
    });
  });

  it.each([
    ['plain', 'authjs.session-token'],
    ['secure', '__Secure-authjs.session-token'],
    ['chunked', '__Secure-authjs.session-token.1'],
  ])('recognises the %s session cookie', (_kind, name) => {
    expect(decideForEndedSession(request({ cookieNames: [name] })).redirectTo).not.toBeNull();
  });

  it('leaves a live session alone', () => {
    expect(decideForEndedSession(request({ hasSession: true }))).toEqual({
      redirectTo: null,
      marker: 'keep',
    });
  });

  it('leaves a visitor who never signed in alone', () => {
    expect(decideForEndedSession(request({ cookieNames: ['oci-theme'] }))).toEqual({
      redirectTo: null,
      marker: 'keep',
    });
  });

  it.each<[string, Partial<IncomingRequest>]>([
    ['the router fetching or prefetching a page', { isPageLoad: false }],
    ['a script fetching a manifest', { isPageLoad: false, pathname: '/catalog/x/croissant' }],
    ['a server action', { method: 'POST', isPageLoad: false }],
    [
      'the activity report',
      { method: 'POST', isPageLoad: false, pathname: '/api/session/activity', search: '' },
    ],
    ['a route handler under /api', { pathname: '/api/catalog-search', search: '?q=xr' }],
  ])('lets %s through and remembers that the session ended', (_name, overrides) => {
    expect(decideForEndedSession(request(overrides))).toEqual({
      redirectTo: null,
      marker: 'set',
    });
  });

  it('recognises the page load that follows by the marker, the session cookie being gone', () => {
    const afterwards = request({ cookieNames: [ENDED_SESSION_COOKIE, 'oci-theme'] });
    expect(decideForEndedSession(afterwards)).toMatchObject({
      redirectTo: expect.stringContaining('/signin?reason=expired&callbackUrl='),
      marker: 'clear',
    });
  });

  it('does not redirect the sign-in page to itself, and drops the marker there', () => {
    for (const cookieNames of [[SESSION_COOKIE], [ENDED_SESSION_COOKIE]]) {
      expect(decideForEndedSession(request({ pathname: '/signin', cookieNames }))).toEqual({
        redirectTo: null,
        marker: 'clear',
      });
    }
  });

  it('drops a leftover marker once the user is signed in again', () => {
    const signedIn = request({
      hasSession: true,
      cookieNames: [SESSION_COOKIE, ENDED_SESSION_COOKIE],
    });
    expect(decideForEndedSession(signedIn)).toEqual({ redirectTo: null, marker: 'clear' });
  });

  it('never redirects off the site', () => {
    const decision = decideForEndedSession(request({ pathname: '//evil.example/x', search: '' }));
    expect(decision.redirectTo).toBe('/signin?reason=expired&callbackUrl=%2Fdashboard');
  });
});
