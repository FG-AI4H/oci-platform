import { NextResponse } from 'next/server';
import { auth } from './auth';
import {
  decideForEndedSession,
  ENDED_SESSION_COOKIE,
  ENDED_SESSION_COOKIE_SECONDS,
} from './lib/ended-session';

/**
 * Keeps the session cookie current (#643, ADR-0027).
 *
 * The session callback renews the access token and records the user's
 * activity, but a server component cannot write the result back:
 * cookies are read-only while a page renders. This proxy runs the same
 * callback before every page, server action and route handler, where
 * the response can still carry `Set-Cookie`. Without it a renewed token
 * would be thrown away at the end of each request, and nothing would
 * count as activity.
 *
 * It gates nothing. Each page and action keeps its own check of who the
 * caller is, and a request without a session passes through untouched.
 * The one thing it adds: when the session a browser had has just ended,
 * the next page it loads is the sign-in page, with the way back,
 * instead of a page rendered as if the visitor had never signed in.
 */
export const proxy = auth((request) => {
  const decision = decideForEndedSession({
    method: request.method,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    cookieNames: request.cookies.getAll().map((cookie) => cookie.name),
    isPageLoad: request.headers.get('sec-fetch-dest') === 'document',
    hasSession: request.auth !== null,
  });

  // `request.nextUrl` carries the public origin here: the auth wrapper
  // rewrites it from `AUTH_URL`, which the web task sets, so the
  // redirect does not point at the container's own address.
  const response =
    decision.redirectTo === null
      ? NextResponse.next()
      : NextResponse.redirect(new URL(decision.redirectTo, request.nextUrl));

  if (decision.marker === 'set') {
    response.cookies.set(ENDED_SESSION_COOKIE, '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure:
        request.nextUrl.protocol === 'https:' ||
        request.headers.get('x-forwarded-proto') === 'https',
      path: '/',
      maxAge: ENDED_SESSION_COOKIE_SECONDS,
    });
  } else if (decision.marker === 'clear') {
    response.cookies.delete(ENDED_SESSION_COOKIE);
  }
  return response;
});

export const config = {
  matcher: [
    // Everything except the auth routes (they manage the cookie
    // themselves), build assets and the icon files.
    '/((?!api/auth/|_next/static/|_next/image/|icon\\.svg$|apple-icon\\.svg$|robots\\.txt$|sitemap\\.xml$).*)',
  ],
};
