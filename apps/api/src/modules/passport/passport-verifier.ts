import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyResult } from 'jose';

/**
 * GA4GH Passport Visa verifier (#126).
 *
 * Verifies a Visa JWT against the issuer's JWKS:
 *   1. Decode without verifying → read `iss` claim.
 *   2. Look up the trusted-issuer registry for that `iss`. Reject when
 *      missing, revoked, or `jwks_uri` mismatch.
 *   3. Verify signature against issuer's JWKS, plus standard JWT
 *      claim checks (`exp`, `nbf`, optional `iss`).
 *   4. Decode the `ga4gh_visa_v1` claim.
 *
 * JWKS lookup uses `jose.createRemoteJWKSet`, which transparently
 * caches keys in-process per remote URL with a 30s cool-down between
 * fetches and a 10-minute key cache. That's the GA4GH spec behaviour
 * — issuers rotate signing keys; we don't want a stale cache to break
 * verification past rotation.
 *
 * Fail-open at the trust layer (treat unverified as absent — the
 * caller's score simply doesn't lift), fail-closed at the authz layer
 * (no Visa = no access). This module returns `null` on every reject
 * path and logs the reason; the service maps that to a 400 with a
 * generic message — verification details don't leak to clients.
 */

export interface VerifiedVisa {
  iss: string;
  jti: string;
  visaType: string;
  /** Decoded `ga4gh_visa_v1` claim. */
  visa: GA4GHVisaV1Claim;
  /** ISO-8601 timestamps. */
  assertedAt: Date;
  expiresAt: Date;
}

/**
 * Shape of the `ga4gh_visa_v1` JWT claim per the spec. The `value`
 * + `source` fields are issuer-defined free-form strings — the spec
 * permits URLs, scopes, or opaque identifiers. We don't normalise.
 */
export interface GA4GHVisaV1Claim {
  type: string;
  asserted: number;
  value: string;
  source: string;
  by?: string;
}

interface JwksResolver {
  /** Returns a verifier callable bound to a JWKS at the given URI. */
  forJwksUri(jwksUri: string): ReturnType<typeof createRemoteJWKSet>;
}

/**
 * Default JWKS resolver — wraps `jose.createRemoteJWKSet` with a
 * per-URI cache so we don't re-create the resolver (and its in-memory
 * key cache) on every call.
 */
class DefaultJwksResolver implements JwksResolver {
  private readonly cache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  forJwksUri(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
    let resolver = this.cache.get(jwksUri);
    if (!resolver) {
      resolver = createRemoteJWKSet(new URL(jwksUri), {
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000,
      });
      this.cache.set(jwksUri, resolver);
    }
    return resolver;
  }
}

export interface TrustedIssuerLookup {
  issuer: string;
  jwksUri: string;
}

@Injectable()
export class PassportVerifier {
  private readonly logger = new Logger(PassportVerifier.name);
  // Field initializer — NestJS DI calls a zero-arg constructor. The
  // previous shape took JwksResolver as a constructor param with a
  // default value; NestJS read the type metadata and tried to inject
  // a (non-existent) JwksResolver provider, blowing up at boot.
  // Tests override this field via `setJwksResolver`.
  private jwks: JwksResolver = new DefaultJwksResolver();

  /**
   * Test-only seam: replace the default JWKS resolver with a stub
   * before calling `verify`. Production code never calls this.
   */
  setJwksResolver(resolver: JwksResolver): void {
    this.jwks = resolver;
  }

  /**
   * Decode the JWT header + payload without verifying. Used to read
   * the `iss` claim so we can pick the right JWKS. Returns `null` for
   * malformed JWTs (≠ 3 segments, undecodable JSON).
   */
  static decodeUnverified(jwt: string): { iss: string; payload: JWTPayload } | null {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    try {
      const payloadJson = Buffer.from(parts[1] ?? '', 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson) as JWTPayload;
      const iss = typeof payload.iss === 'string' ? payload.iss : null;
      if (!iss) return null;
      return { iss, payload };
    } catch {
      return null;
    }
  }

  /**
   * Verify a Visa JWT against the supplied trusted-issuer entry.
   * Returns the parsed Visa on success, or `null` on any failure
   * (signature, expiry, missing `ga4gh_visa_v1` claim).
   *
   * Caller is responsible for checking the issuer is in the trust
   * list *before* calling this; this method assumes the entry came
   * from the trusted-issuer registry.
   */
  async verify(jwt: string, trusted: TrustedIssuerLookup): Promise<VerifiedVisa | null> {
    const resolver = this.jwks.forJwksUri(trusted.jwksUri);
    let result: JWTVerifyResult;
    try {
      result = await jwtVerify(jwt, resolver, {
        issuer: trusted.issuer,
      });
    } catch (err) {
      this.logger.warn(
        `Passport JWT verification failed (iss=${trusted.issuer}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
    return parseVisaPayload(result.payload, trusted.issuer, this.logger);
  }
}

function parseVisaPayload(payload: JWTPayload, iss: string, logger: Logger): VerifiedVisa | null {
  // `ga4gh_visa_v1` is the spec-defined claim carrying the visa body.
  const claim = (payload as Record<string, unknown>)['ga4gh_visa_v1'];
  if (!isVisaClaim(claim)) {
    logger.warn(`Passport JWT missing ga4gh_visa_v1 claim (iss=${iss})`);
    return null;
  }
  if (typeof payload.exp !== 'number') {
    logger.warn(`Passport JWT missing exp (iss=${iss})`);
    return null;
  }
  // `iat` from JWT is the standard timestamp; the visa's `asserted`
  // is duplicated in the inner claim for spec compliance. Prefer the
  // inner one when present (issuers may set them apart).
  const assertedSeconds = claim.asserted ?? payload.iat ?? 0;
  const jti =
    typeof payload.jti === 'string'
      ? payload.jti
      : // Fallback: synthesise a stable jti from the sub + visa type +
        // assertion time so re-ingest of the same Visa is idempotent.
        `${typeof payload.sub === 'string' ? payload.sub : 'anon'}:${claim.type}:${assertedSeconds}`;
  return {
    iss,
    jti,
    visaType: claim.type,
    visa: claim,
    assertedAt: new Date(assertedSeconds * 1000),
    expiresAt: new Date(payload.exp * 1000),
  };
}

function isVisaClaim(value: unknown): value is GA4GHVisaV1Claim {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.type === 'string' &&
    typeof c.value === 'string' &&
    typeof c.source === 'string' &&
    (typeof c.asserted === 'number' || typeof c.asserted === 'undefined') &&
    (typeof c.by === 'string' || typeof c.by === 'undefined')
  );
}
