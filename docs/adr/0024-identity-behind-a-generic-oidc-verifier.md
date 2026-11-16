# ADR-0024: Identity goes through a generic OIDC verifier; Cognito becomes one configuration

- **Status:** accepted (2026-10-27)
- **Date:** 2026-10-22
- **Deciders:** Marc Lecoultre
- **Tags:** `area:platform` | `package:DP` | `security`

Implements the decision part of [#589](https://github.com/FG-AI4H/oci-platform/issues/589) under the Sandbox compatibility epic [#585](https://github.com/FG-AI4H/oci-platform/issues/585).

## Context

At the 2026-10-05 AI for Good Lab meeting, ITU asked for the Sandbox pilot to be hostable at ITU, because AWS is not reachable from some member states ([#551](https://github.com/FG-AI4H/oci-platform/issues/551)). Most of OCI's AWS use already sits behind a switch: S3 (`S3_ENDPOINT`, MinIO locally), SQS (`SQS_ENDPOINT`), SES (behind the SMTP bridge, ADR-0005), and Postgres (Prisma). **Identity doesn't:**

- `packages/auth` and `apps/api/src/auth/cognito-jwt.guard.ts` verify tokens with `CognitoJwtVerifier` against one user pool. The only alternative is the `OCI_ENV=local` stub.
- Roles are read straight from the Cognito-specific `cognito:groups` claim in **12 files** across `apps/api/src` (the roles guard, catalog, annotation and others), not through one accessor.
- User ids: **32 call sites** use `cognitoSubAsUuid`, which passes a UUID `sub` through unchanged and otherwise hashes it to a UUIDv5 under a single fixed namespace. The issuer isn't part of that hash, so the same `sub` from two different providers would map to the same OCI user.
- Admin user management (`apps/api/src/modules/identity-admin/cognito-admin.client.ts`) calls the Cognito admin API: list users, add and remove groups.
- The web app uses the NextAuth Cognito provider (`apps/web/src/auth.ts`).

`aws-jwt-verify`, the library this repo already pins (`^5.1.1`), ships a generic `JwtVerifier` for any OIDC issuer alongside `CognitoJwtVerifier`. Moving off Cognito-specific verification needs no new dependency.

## Decision

**The platform verifies identity against any standards-compliant OIDC issuer set by configuration. Cognito is the default configuration and doesn't change on AWS.** Each deployment trusts exactly one issuer; federating several identity providers into one instance is out of scope here.

1. **Verification:** one guard, configured by `OIDC_ISSUER`, `OIDC_AUDIENCE` (the client id) and `OIDC_JWKS_URI` (defaults to discovery). Cognito uses `CognitoJwtVerifier` (it keeps the `token_use` check); any other issuer uses `JwtVerifier`. Both enforce issuer, audience, expiry, and an algorithm allowlist (RS256 and ES256 only, never `none`).

2. **One principal shape:** the guard sets `req.user` to `{ sub, issuer, roles: string[], email? }`. All role checks read `roles` through one accessor. The 12 direct reads of `cognito:groups` move to it in the same change, and a lint rule forbids new ones.

3. **Role mapping:** `OIDC_ROLES_CLAIM` is a dotted path into the token (default `cognito:groups`; Keycloak's is `realm_access.roles`). An optional `OIDC_ROLE_MAP` renames provider roles to OCI roles. OCI's role names (`host`, `admin`, `campaign-manager`, …) stay the contract; the provider adapts to them.

4. **User ids stay stable:** a UUID `sub` from the Cognito configuration passes through unchanged, so every existing row keeps its owner. Any other `sub`, or any `sub` from a non-Cognito issuer, becomes `uuidv5(issuer + "|" + sub)` under the existing namespace. The issuer is now in the input, so two providers can't collide. `cognitoSubAsUuid` is renamed `principalUuid` and takes the principal.

5. **Admin user management goes behind a provider interface:** list users, get user, add role, remove role. The Cognito adapter is the existing code. A deployment with no adapter shows user management as unavailable with a clear message, and roles are then managed in the provider's own console. A Keycloak adapter can follow; it isn't required by this ADR.

6. **Web:** NextAuth's generic OIDC provider, configured from the same issuer and client settings, with the Cognito provider kept as the default. The local Credentials stub is unchanged.

7. **Second reference provider:** Keycloak in `infra/local/docker-compose.yml`, with a realm export that seeds OCI's roles. Once Playwright runs in CI ([#565](https://github.com/FG-AI4H/oci-platform/issues/565)), a nightly job runs the end-to-end suite against it, so the generic path can't silently break.

**Not decided here:** portability of KMS signing (receipts, Passport keys, model packages) and of the CDK infrastructure. Both are noted on #551 as the remaining AWS-bound pieces, and get their own decision if the ITU hosting goes ahead.

## Consequences

### Positive

- An ITU-hosted or national instance can use its own identity provider (Keycloak, an ITU or ministry IdP) without forking OCI.
- Role checks go through one accessor instead of 12 direct claim reads, so they are easier to audit.
- Issuer-scoped user ids remove a latent collision before a second provider ever exists.

### Negative

- A touch-everything refactor (12 role reads, 32 id call sites) on security-critical code. It needs thorough tests for both configurations and a careful review.
- Two configurations to keep working. Without the nightly Keycloak run, the non-default one would rot.
- On a non-Cognito instance, OCI's own user-management screens are unavailable until someone writes an adapter for that provider.

### Neutral

- No behaviour change on AWS: same verifier, same claims, same user ids.
- MFA policy for privileged roles (security baseline) becomes the configured provider's responsibility, and the deployment's checklist must say so.

## Alternatives considered

- **Replace Cognito with self-hosted Keycloak everywhere.** Rejected: OCI would take on running an identity provider in every environment and lose managed MFA, for no gain on AWS.
- **Keep Cognito and federate the ITU IdP into it.** Rejected: it still needs AWS reachable at login, which is the very constraint ITU raised.
- **A second guard per provider.** Rejected: duplicated security code paths, and every role check would need to know both claim shapes.
- **Switch to `jose`.** Not needed: `aws-jwt-verify` already covers generic OIDC, and changing a pinned security dependency would need its own justification.
- **(Chosen):** one verifier and principal, Cognito as the default configuration, issuer-scoped ids, admin behind an adapter.

## References

- [#589](https://github.com/FG-AI4H/oci-platform/issues/589) · [#585](https://github.com/FG-AI4H/oci-platform/issues/585) · [#551](https://github.com/FG-AI4H/oci-platform/issues/551) · [#565](https://github.com/FG-AI4H/oci-platform/issues/565)
- OpenID Connect Core 1.0 and Discovery 1.0 · RFC 7519 (JWT) · RFC 8725 (JWT best current practices)
- `aws-jwt-verify` `JwtVerifier` (generic OIDC) and `CognitoJwtVerifier`
- [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) · [ADR-0005](./0005-smtp-to-ses-bridge-for-docuseal.md) · `docs/security.md`
