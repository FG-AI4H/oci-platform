# ADR-0027: A web session lasts while it is in use, up to a fixed limit

- **Status:** proposed
- **Date:** 2026-11-20
- **Deciders:** Marc Lecoultre
- **Tags:** `area:platform` | `area:security` | `phase:B`

## Context

A web session ended one hour after sign-in, whatever the user was doing. The Cognito access token
lasts 60 minutes and the web app never renewed it: the next call to the API was refused, the user
was sent to sign in, and the form in front of them was lost
([#643](https://github.com/FG-AI4H/oci-platform/issues/643)). On 19 November 2026 this interrupted a
live demonstration twice. Hands-on sessions run for hours, and the December 2026 radiology workshop
is two full days of them.

The requirement is that a session ends because nobody is using it, not because an hour has passed.

Three facts shape the answer.

**Cognito puts a fixed end on every session.** A refresh token is valid for a set time from
sign-in, and using it does not extend it. AWS states this for rotated tokens too: "Rotation reissues
a refresh token within the _same_ fixed validity window. It doesn't extend the window. […] To keep a
user signed in past that window, they must reauthenticate."
([Refresh tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html)).
So "stays signed in while active" can only be true up to the refresh-token validity. That value was
30 days on every environment, set when nothing used it.

**Cognito has no idle timeout.** If sessions are to end after inactivity, the web app has to do it.

**The access token was readable by the browser.** The session callback copied it onto the session
object, and Auth.js serves that object at `GET /api/auth/session`. The dataset upload page also
passed it to a client component as a prop. A refresh token must not follow the same path, and the
access token should not have been there.

## Decision

**The web app renews the access token for as long as the user is active, ends the session after a
period without activity, and keeps every token on the server.**

1. **Renewal.** The refresh token is kept in the session cookie, which is encrypted with
   `AUTH_SECRET` and `HttpOnly`. The session callback exchanges it at the pool's token endpoint when
   the access token has five minutes left, and again when the API answers 401 to a token that had
   not expired. A proxy (`apps/web/src/proxy.ts`) runs the callback on every request, because a page
   that is rendering cannot write the renewed cookie back. Only the pool refusing the refresh token
   ends a session; a pool that does not answer ends none.
2. **Idle limit.** The session records the time of the last request from the user's browser. When
   the next one arrives later than the environment's idle limit, the session ends and the user
   signs in again, returning to the page they asked for. A page that is open reports use (pointer,
   keyboard, scroll, touch) at most every five minutes, so reading an image or filling a long form
   counts as activity. There is no timer: a page nobody touches sends nothing.
3. **Fixed limit.** The refresh-token validity is the longest a session lasts, per environment.
4. **No token in the browser.** The session object carries who the caller is and their groups, and
   no token. Server code reads the access token through one function, `sessionAccessToken()` in
   `apps/web/src/auth.ts`. Client components that called the API with a bearer token now call
   server actions.
5. **Groups follow the token.** They are read from the access token each time the session is read,
   so a role granted during a session takes effect at the next renewal, within the hour.
6. **Ending a session revokes its refresh token.** On sign-out, and when a session ends for
   inactivity, the web app revokes the refresh token at the pool (`/oauth2/revoke`). A copy of the
   session cookie taken earlier can then renew nothing; it works until the access token inside it
   expires, at most 60 minutes, because the API checks access tokens by signature and expiry only.

| Environment | Idle limit | Fixed limit | Access token |
| ----------- | ---------- | ----------- | ------------ |
| dev         | 2 hours    | 12 hours    | 60 minutes   |
| int         | 30 minutes | 12 hours    | 60 minutes   |
| prod        | 30 minutes | 12 hours    | 60 minutes   |

The values live in `infra/cdk/lib/environments.ts` (`session.idleTimeout`, `session.maxLifetime`).
The `dev` values serve hands-on sessions: twelve hours is a working day, two hours a long break.
The `int` and `prod` values are a starting point, not yet decided: 30 minutes and 12 hours is what
NIST SP 800-63B revision 3 required for a session authenticated with two factors (AAL2), which is
how `admin`, `regulator` and `supervisor` sign in on `prod`. Revision 4, which supersedes it,
recommends no more than one hour of inactivity and 24 hours in all.

### Requests in parallel

One page view reads the session several times, and a browser sends several requests at once, all
with the same cookie. Near expiry each of them wants to renew. If the pool rotated refresh tokens,
the second exchange of the same token would be refused and that request would sign the user out.

The web client does **not** rotate refresh tokens today (no `refreshTokenRotationGracePeriod` in
`identity-stack.ts`), so a refresh token can be exchanged any number of times and this cannot
happen. The web app is built so that it would not happen with rotation either: each web task runs
one exchange per refresh token and gives its outcome to every request that presents the same
refresh token during the following minute.

Rotation is left off. AWS recommends it; turning it on is a separate decision, and needs a grace
period on the client (Cognito allows up to 60 seconds) for requests that reach different web tasks.
The web app already renews through the token endpoint, which works with rotation on or off; the
`REFRESH_TOKEN_AUTH` flow, which rotation disables, is not used. The gain is small for a
confidential client whose refresh token never leaves an encrypted, `HttpOnly` cookie and lasts
twelve hours.

## Consequences

### Positive

- A user who keeps working is not interrupted by the access token's expiry.
- An unattended session ends. Before, a session ended after an hour by accident, and nothing ended
  it by design.
- No bearer token is delivered to the browser: not in the session endpoint, not in page data, not
  as a component prop.
- The longest session is 12 hours, down from the 30 days the refresh token allowed.

### Negative

- **The fixed limit is a hard stop.** Twelve hours after sign-in the session ends in the middle of
  whatever the user is doing, and what they typed in the form on screen is lost. Raising the limit
  moves the moment; it does not remove it. Warning the user shortly before is not built.
- **Signing in again may ask for nothing.** The Cognito sign-in page keeps its own session for one
  hour. A user whose app session ended for inactivity within an hour of signing in is signed in
  again without a password. The idle limit protects an unattended browser only once that hour has
  passed.
- A session cookie that carries a refresh token is larger than a browser accepts in one cookie.
  Auth.js splits it in two, and every request carries about 5 kB of cookies (measured with test
  tokens of 2,048 and about 900 characters; the pool's own may be larger).
- The session cookie is written on every request.
- Activity is recorded per request, so anything that makes the browser send requests by itself
  would keep a session alive. Nothing in the app does this today; a polling page would.
- The renewal bookkeeping is per web task. With two tasks, two requests can each renew once. That
  is harmless without rotation.

### Neutral

- Sessions that exist when this is deployed hold no refresh token. They end when their access token
  expires, within the hour, and the user signs in once.
- The id token is no longer kept: nothing read it.
- `OCI_SESSION_IDLE_SECONDS` is a new variable on the web task. A deployed environment without it
  applies 30 minutes; local development applies no limit.

## Alternatives considered

- **Raise the access-token lifetime** (Cognito allows up to one day). Rejected: the API accepts an
  access token until it expires, so a long one cannot be withdrawn, and sessions would still end at
  a fixed time.
- **Keep the session in a database** (Auth.js database sessions). It would make the idle limit and
  sign-out-everywhere straightforward, at the cost of a table, a query on every request and an
  adapter. Not needed for what is asked; the question can be reopened if sessions need to be listed
  or revoked.
- **A timer in the page that keeps the session alive.** Rejected: it would keep an unattended
  browser signed in, which is what the idle limit exists to prevent.
- **A generous idle limit and no reporting from the page.** Simpler, but the limit would have to
  cover the longest time anyone reads one image, on every environment.
- **(Chosen)** Renew on the server while requests arrive, end after inactivity, count use of an open
  page as activity, keep tokens on the server.

## References

- [#643](https://github.com/FG-AI4H/oci-platform/issues/643), part of
  [#640](https://github.com/FG-AI4H/oci-platform/issues/640)
- Amazon Cognito developer guide,
  [Refresh tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html)
- NIST SP 800-63B, [revision 3](https://pages.nist.gov/800-63-3/sp800-63b.html) §4.2.3 and
  [revision 4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [`docs/security.md`](../security.md)
