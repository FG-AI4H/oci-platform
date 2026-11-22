import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { SESSION_E2E } from './fixtures/session-e2e';
import { startStandInPool, type StandInPool } from './fixtures/stand-in-pool';

/**
 * A web session that outlives its access token (#643).
 *
 * Run with its own config:
 *
 *   pnpm --filter @oci/web exec playwright test -c playwright.session.config.ts
 *
 * The app runs in its deployed mode against a stand-in pool and API
 * (`fixtures/stand-in-pool.ts`) whose access tokens live ten seconds.
 * Every wait below is a real wait for a real token to expire, and the
 * stand-in API answers 401 to an expired token, so a form that saves
 * after the wait proves the session was renewed. Nothing in the app is
 * mocked.
 *
 * Not covered here: the real Cognito pool and the real API. That is a
 * check on `dev`.
 */

let pool: StandInPool;

async function signIn(page: Page, returnTo = '/settings'): Promise<void> {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(returnTo)}`);
  await page.getByRole('button', { name: 'Continue with Cognito' }).click();
  await expect(page).toHaveURL(`${SESSION_E2E.appOrigin}${returnTo}`);
}

/** Wait until the newest access token is a full second past its expiry. */
async function waitPastExpiry(page: Page): Promise<void> {
  const remaining = pool.latestAccessTokenExpiryMs() - Date.now() + 1_000;
  if (remaining > 0) await page.waitForTimeout(remaining);
  expect(Date.now()).toBeGreaterThan(pool.latestAccessTokenExpiryMs());
}

/** Every address the page's main frame visits on the sign-in page, from now on. */
function signInPageVisits(page: Page): string[] {
  const visits: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && new URL(frame.url()).pathname === '/signin') {
      visits.push(frame.url());
    }
  });
  return visits;
}

/** Writes the stand-in API has accepted so far. */
function acceptedWrites(): number {
  return pool.apiCalls.filter((call) => call.method === 'PUT' && call.outcome === 'accepted')
    .length;
}

/**
 * Submit the preferences form and wait until the write has reached the
 * API. The address and the "saved" notice cannot tell: after a first
 * save they already say so.
 */
async function saveTheme(page: Page, theme: 'Dark' | 'Light'): Promise<void> {
  const writesBefore = acceptedWrites();
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/settings',
  );
  await page.getByRole('button', { name: /save preferences/i }).click();
  await submitted;
  await expect.poll(acceptedWrites).toBe(writesBefore + 1);
  await expect(page).toHaveURL(/\/settings\?saved=1$/);
  await expect(page.getByRole('status')).toContainText(/preferences saved/i);
  await expect(page.getByRole('radio', { name: new RegExp(`^${theme}$`) })).toBeChecked();
}

async function sessionCookies(context: BrowserContext) {
  const cookies = await context.cookies(SESSION_E2E.appOrigin);
  return cookies.filter((cookie) => cookie.name.includes('authjs.session-token'));
}

test.beforeAll(async ({ browser }) => {
  pool = await startStandInPool({
    port: SESSION_E2E.poolPort,
    clientId: SESSION_E2E.clientId,
    clientSecret: SESSION_E2E.clientSecret,
    appOrigin: SESSION_E2E.appOrigin,
    accessTokenSeconds: SESSION_E2E.accessTokenSeconds,
  });

  // The dev server compiles each route on its first request, which can
  // take longer than a token lives. Walk the path once so the tests
  // measure the session, not the compiler.
  const context = await browser.newContext({ baseURL: SESSION_E2E.appOrigin });
  const page = await context.newPage();
  await signIn(page);
  await page.getByRole('radio', { name: /^Light$/ }).check();
  await page.getByRole('button', { name: /save preferences/i }).click();
  await expect(page).toHaveURL(/\/settings\?saved=1$/);
  await page.goto('/dashboard');
  await page.goto('/');
  await context.close();
});

test.afterAll(async () => {
  await pool.close();
});

test.beforeEach(() => {
  pool.rotateRefreshTokens = true;
  pool.setGroups(['participant']);
});

test('a form submitted after the access token expired is saved, and the sign-in page is never shown', async ({
  page,
}) => {
  await signIn(page);
  const signInVisits = signInPageVisits(page);
  const before = { ...pool.counts };

  // Start filling the form in, then leave it until the token is dead.
  await page.getByRole('radio', { name: /^Dark$/ }).check();
  await waitPastExpiry(page);
  const callsBeforeSubmit = pool.apiCalls.length;

  await saveTheme(page, 'Dark');

  expect(signInVisits).toEqual([]);
  expect(pool.counts.refreshGrants).toBeGreaterThan(before.refreshGrants);
  // No refresh token was presented twice: the pool rotates with no
  // grace period here, so a second use would have been refused.
  expect(pool.counts.refusedRefreshGrants).toBe(before.refusedRefreshGrants);
  // The write reached the API with a live token, and the dead one was
  // never offered: it was renewed before the call, not after a 401.
  const calls = pool.apiCalls.slice(callsBeforeSubmit);
  expect(calls).toContainEqual({ method: 'PUT', path: '/v2/preferences/me', outcome: 'accepted' });
  expect(calls.filter((call) => call.outcome !== 'accepted')).toEqual([]);
});

test('requests in parallel with an expired token share one renewal, and nobody is signed out', async ({
  page,
}) => {
  await signIn(page);
  const signInVisits = signInPageVisits(page);
  await waitPastExpiry(page);
  const before = { ...pool.counts };

  // Eight requests leave with the same, expired, session cookie.
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => page.request.get('/settings', { maxRedirects: 0 })),
  );

  // A request that lost its session would be redirected to /signin.
  expect(responses.map((response) => response.status())).toEqual(Array(8).fill(200));
  expect(pool.counts.refreshGrants).toBeGreaterThan(before.refreshGrants);
  expect(pool.counts.refusedRefreshGrants).toBe(before.refusedRefreshGrants);
  test.info().annotations.push({
    type: 'renewals for 8 parallel requests',
    description: String(pool.counts.refreshGrants - before.refreshGrants),
  });

  // The cookie the browser kept is good for the next renewal too.
  await waitPastExpiry(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect(signInVisits).toEqual([]);
  expect(pool.counts.refusedRefreshGrants).toBe(before.refusedRefreshGrants);
});

test('a role granted during the session takes effect at the next renewal', async ({ page }) => {
  await signIn(page);
  const signInVisits = signInPageVisits(page);
  const inbox = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', {
    name: 'Inbox',
  });
  await expect(inbox).toHaveCount(0);

  pool.setGroups(['participant', 'host']);
  await waitPastExpiry(page);
  await page.reload();

  await expect(inbox).toBeVisible();
  expect(signInVisits).toEqual([]);
});

test('a token the API refuses before it expires is renewed once and the request sent again', async ({
  page,
}) => {
  await signIn(page);
  const signInVisits = signInPageVisits(page);
  await page.getByRole('radio', { name: /^Dark$/ }).check();

  pool.refuseAccessTokensIssuedSoFar();
  const callsBeforeSubmit = pool.apiCalls.length;
  await saveTheme(page, 'Dark');

  const writes = pool.apiCalls
    .slice(callsBeforeSubmit)
    .filter((call) => call.method === 'PUT')
    .map((call) => call.outcome);
  expect(writes).toEqual(['refused', 'accepted']);
  expect(signInVisits).toEqual([]);
});

test('a pool that does not rotate refresh tokens, as configured today, renews again and again', async ({
  page,
}) => {
  pool.rotateRefreshTokens = false;
  await signIn(page);
  const signInVisits = signInPageVisits(page);
  const before = { ...pool.counts };

  await page.getByRole('radio', { name: /^Dark$/ }).check();
  await waitPastExpiry(page);
  await saveTheme(page, 'Dark');

  await page.getByRole('radio', { name: /^Light$/ }).check();
  await waitPastExpiry(page);
  await saveTheme(page, 'Light');

  expect(pool.counts.refreshGrants - before.refreshGrants).toBeGreaterThanOrEqual(2);
  expect(pool.counts.refusedRefreshGrants).toBe(before.refusedRefreshGrants);
  expect(signInVisits).toEqual([]);
});

test('an active session outlives several access tokens and the idle limit, and is never sent to sign in', async ({
  page,
}) => {
  await signIn(page);
  const signInVisits = signInPageVisits(page);
  const before = { ...pool.counts };
  const startedAt = Date.now();

  // Work for longer than the idle limit, and through more than three
  // access-token lifetimes, never pausing for more than six seconds.
  const workFor = (SESSION_E2E.idleSeconds + 10) * 1000;
  let saves = 0;
  while (Date.now() - startedAt < workFor) {
    await page.waitForTimeout(6_000);
    const theme = saves % 2 === 0 ? 'Dark' : 'Light';
    await page.getByRole('radio', { name: new RegExp(`^${theme}$`) }).check();
    await saveTheme(page, theme);
    saves += 1;
  }

  expect(Date.now() - startedAt).toBeGreaterThan(3 * SESSION_E2E.accessTokenSeconds * 1000);
  expect(pool.counts.refreshGrants - before.refreshGrants).toBeGreaterThanOrEqual(3);
  expect(pool.counts.refusedRefreshGrants).toBe(before.refusedRefreshGrants);
  expect(signInVisits).toEqual([]);
});

test('a session left idle past the limit is ended: the next page asks to sign in and returns there', async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.goto('/dashboard');
  await page.goto('/settings');

  // Let the page finish loading: a production build prefetches the
  // links in view. Then leave it open and touch nothing. From here on
  // nothing may be sent on the user's behalf: a page that kept itself
  // alive on a timer would defeat the limit.
  await page.waitForTimeout(5_000);
  const requestsWhileIdle: string[] = [];
  const record = (request: { url(): string }) => requestsWhileIdle.push(request.url());
  page.on('request', record);
  await page.waitForTimeout((SESSION_E2E.idleSeconds + 2) * 1000);
  page.off('request', record);
  expect(requestsWhileIdle).toEqual([]);
  const revokedBefore = pool.counts.revokedRefreshTokens;

  await page.goto('/dashboard');

  await expect(page).toHaveURL(
    `${SESSION_E2E.appOrigin}/signin?reason=expired&callbackUrl=%2Fdashboard`,
  );
  await expect(page.getByRole('status')).toContainText('Your session has expired');
  expect(await sessionCookies(context)).toEqual([]);
  // Its refresh token is revoked at the pool as well.
  expect(pool.counts.revokedRefreshTokens).toBe(revokedBefore + 1);

  await page.getByRole('button', { name: 'Continue with Cognito' }).click();
  await expect(page).toHaveURL(`${SESSION_E2E.appOrigin}/dashboard`);
});

test('an open page that nobody touches sends nothing for six and a half minutes', async ({
  page,
}) => {
  // The idle limit means something only if a page left open stays
  // silent. Six and a half minutes is past the five minutes after which
  // the router treats what it prefetched as stale. Slow, so opt-in.
  test.skip(!process.env.SESSION_E2E_LONG, 'slow: set SESSION_E2E_LONG=1 to run it');
  test.setTimeout(8 * 60_000);

  await signIn(page);
  await page.goto('/dashboard');
  await page.goto('/settings');
  await page.waitForTimeout(5_000);

  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.waitForTimeout(390_000);
  expect(requests).toEqual([]);
});

test('using the page without leaving it keeps the session alive past the idle limit', async ({
  page,
}) => {
  await signIn(page);
  const signInVisits = signInPageVisits(page);
  await page.getByRole('radio', { name: /^Dark$/ }).check();

  // Twice, come close to the limit and then do what a reader does:
  // move the pointer over the page. No navigation, no submission.
  const nearTheLimit = (SESSION_E2E.idleSeconds - 7) * 1000;
  for (let round = 0; round < 2; round++) {
    await page.waitForTimeout(nearTheLimit);
    const reported = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/session/activity',
    );
    await page.mouse.move(300 + round * 40, 300);
    await page.mouse.move(340 + round * 40, 320);
    expect((await reported).status()).toBe(204);
  }

  // Well past the limit since sign-in, yet never idle for as long as it.
  await page.waitForTimeout(nearTheLimit);
  await saveTheme(page, 'Dark');
  expect(signInVisits).toEqual([]);
});

test('when the refresh token is no longer accepted, the user signs in again and comes back to the same page', async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.getByRole('radio', { name: /^Dark$/ }).check();

  // As after twelve hours: the pool no longer honours the refresh token.
  pool.revokeRefreshTokens();
  await waitPastExpiry(page);
  await page.getByRole('button', { name: /save preferences/i }).click();

  await expect(page).toHaveURL(
    `${SESSION_E2E.appOrigin}/signin?reason=expired&callbackUrl=%2Fsettings`,
  );
  await expect(page.getByRole('status')).toContainText('Your session has expired');
  expect(await sessionCookies(context)).toEqual([]);

  await page.getByRole('button', { name: 'Continue with Cognito' }).click();
  await expect(page).toHaveURL(`${SESSION_E2E.appOrigin}/settings`);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('signing out ends the session, and is not mistaken for one that expired', async ({
  page,
  context,
}) => {
  pool.rotateRefreshTokens = false;
  await signIn(page);
  await waitPastExpiry(page);
  const revokedBefore = pool.counts.revokedRefreshTokens;

  // The request that signs out also carries a token due for renewal.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(`${SESSION_E2E.appOrigin}/`);
  expect(await sessionCookies(context)).toEqual([]);
  // The refresh token is revoked at the pool, so a copy of the old
  // cookie cannot renew the session.
  expect(pool.counts.revokedRefreshTokens).toBe(revokedBefore + 1);

  await page.goto('/settings');
  await expect(page).toHaveURL(`${SESSION_E2E.appOrigin}/signin?callbackUrl=%2Fsettings`);
  await expect(page.getByText('Your session has expired')).toHaveCount(0);
});

test('no token reaches the browser', async ({ page, context }) => {
  // Keep every response body the app sends to this browser.
  const bodies: Promise<string>[] = [];
  page.on('response', (response) => {
    if (!response.url().startsWith(SESSION_E2E.appOrigin)) return;
    bodies.push(response.text().catch(() => ''));
  });

  // Sign in, renew at least once, save a form, and visit the pages a
  // signed-in user lands on, so first and renewed tokens are both in play.
  await signIn(page);
  await page.getByRole('radio', { name: /^Dark$/ }).check();
  await waitPastExpiry(page);
  await saveTheme(page, 'Dark');
  await page.goto('/dashboard');
  await page.goto('/');
  await page.goto('/settings');

  // What a script on the page can ask the auth routes for: who is
  // signed in and their groups, and nothing that is or looks like a token.
  const session = await page.evaluate(async () => {
    const response = await fetch('/api/auth/session');
    return { status: response.status, text: await response.text() };
  });
  expect(session.status).toBe(200);
  const body = JSON.parse(session.text) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['expires', 'groups', 'subject', 'user']);
  expect(Object.keys(body.user as object).sort()).toEqual(['email', 'id']);
  // (`user.id` is an id the auth library assigns at sign-in; `subject`
  // is the pool's `sub`, which is what the API knows the caller by.)
  expect(body).toMatchObject({
    user: { email: pool.user.email },
    subject: pool.user.sub,
    groups: ['participant'],
  });
  // No key named for a token, no JWT (`eyJ…` is base64url for `{"`),
  // and no string long enough to be a token of any kind.
  expect(session.text).not.toMatch(/token/i);
  expect(session.text).not.toContain('eyJ');
  expect(session.text).not.toMatch(/[A-Za-z0-9_-]{80,}/);

  const scriptVisible = await page.evaluate(() => ({
    cookie: document.cookie,
    localStorage: JSON.stringify({ ...localStorage }),
    sessionStorage: JSON.stringify({ ...sessionStorage }),
    html: document.documentElement.outerHTML,
  }));
  const cookies = await context.cookies();

  const haystacks: Record<string, string> = {
    'response bodies': (await Promise.all(bodies)).join('\n'),
    '/api/auth/session': session.text,
    'document.cookie': scriptVisible.cookie,
    localStorage: scriptVisible.localStorage,
    sessionStorage: scriptVisible.sessionStorage,
    'rendered HTML': scriptVisible.html,
    'cookie values': cookies.map((cookie) => cookie.value).join('\n'),
  };

  // Every token the pool issued, whole, and each JWT's three parts on
  // their own (a decoded payload re-encoded would still match its part).
  const tokens = pool.issuedTokens();
  expect(tokens.length).toBeGreaterThanOrEqual(6);
  const needles = tokens.flatMap((token) => {
    const parts = token.split('.');
    return parts.length === 3 ? [token, ...parts.slice(1)] : [token];
  });
  expect(haystacks['response bodies']?.length).toBeGreaterThan(10_000);
  for (const [where, haystack] of Object.entries(haystacks)) {
    const found = needles.filter((needle) => haystack.includes(needle));
    expect(found, `token material found in ${where}`).toEqual([]);
  }

  // The tokens exist only inside the session cookie: encrypted, and
  // out of reach of scripts.
  const stored = await sessionCookies(context);
  expect(stored.length).toBeGreaterThan(0);
  for (const cookie of stored) {
    expect(cookie.httpOnly, `${cookie.name} HttpOnly`).toBe(true);
    expect(cookie.sameSite, `${cookie.name} SameSite`).toBe('Lax');
    // Browsers drop a cookie whose name and value exceed 4096 bytes.
    expect(cookie.name.length + cookie.value.length).toBeLessThanOrEqual(4096);
  }
  expect(scriptVisible.cookie).not.toContain('session-token');

  const sizes = stored.map((cookie) => `${cookie.name}=${cookie.value.length}`);
  const cookieHeaderBytes = cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ').length;
  // Node rejects a request whose headers exceed 16 KiB in total.
  expect(cookieHeaderBytes).toBeLessThan(8 * 1024);
  test.info().annotations.push({
    type: 'session cookie',
    description: `${sizes.join(', ')}; whole Cookie header ${cookieHeaderBytes} bytes`,
  });
});
