import { generateKeyPair, SignJWT, exportJWK, type JWK } from 'jose';
import { describe, expect, it } from 'vitest';
import { PassportVerifier } from './passport-verifier.js';

const ISSUER = 'https://login.elixir-czech.org/oidc/';
const JWKS_URI = 'https://login.elixir-czech.org/oidc/jwks.json';

interface KeyMaterial {
  privateKey: CryptoKey;
  publicJwk: JWK & { kid: string };
}

async function makeKey(): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  return {
    privateKey,
    publicJwk: { ...jwk, kid: 'test-kid', alg: 'RS256' } as JWK & { kid: string },
  };
}

async function makeVisaJwt(opts: {
  privateKey: CryptoKey;
  iss: string;
  sub?: string;
  jti?: string;
  expSecondsFromNow?: number;
  visa?: {
    type: string;
    asserted: number;
    value: string;
    source: string;
  };
  omitVisa?: boolean;
}): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + (opts.expSecondsFromNow ?? 3600);
  const visa = opts.visa ?? {
    type: 'ResearcherStatus',
    asserted: Math.floor(Date.now() / 1000) - 60,
    value: 'https://doi.org/10.1038/s41586-020-2649-2',
    source: 'https://elixir-europe.org',
  };
  const payload: Record<string, unknown> = {
    iss: opts.iss,
    sub: opts.sub ?? 'https://orcid.org/0000-0001-2345-6789',
    iat: Math.floor(Date.now() / 1000),
    jti: opts.jti ?? 'visa-1',
  };
  if (!opts.omitVisa) payload['ga4gh_visa_v1'] = visa;

  return await new SignJWT(payload as never)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' })
    .setExpirationTime(exp)
    .sign(opts.privateKey);
}

/**
 * Stub JWKS resolver — returns the configured public key directly so
 * the verifier doesn't hit the network. The shape mirrors what
 * `createRemoteJWKSet` returns: a function `(protectedHeader, token)`
 * → CryptoKey/JWK.
 */
function stubResolver(jwk: JWK & { kid: string }) {
  return {
    forJwksUri() {
      // jose v6 uses an async key getter; return a function that
      // resolves the JWK regardless of header (single-key test fixture).
      return (async () => {
        const { importJWK } = await import('jose');
        return await importJWK(jwk, 'RS256');
      }) as never;
    },
  };
}

describe('PassportVerifier', () => {
  describe('decodeUnverified', () => {
    it('returns iss + payload for a well-formed JWT', async () => {
      const km = await makeKey();
      const jwt = await makeVisaJwt({ privateKey: km.privateKey, iss: ISSUER });
      const decoded = PassportVerifier.decodeUnverified(jwt);
      expect(decoded?.iss).toBe(ISSUER);
    });

    it('returns null for a malformed JWT (≠ 3 segments)', () => {
      expect(PassportVerifier.decodeUnverified('not.a-jwt')).toBeNull();
    });

    it('returns null when iss is missing', async () => {
      const km = await makeKey();
      const jwt = await new SignJWT({ sub: 'x' } as never)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
        .setExpirationTime('1h')
        .sign(km.privateKey);
      expect(PassportVerifier.decodeUnverified(jwt)).toBeNull();
    });
  });

  describe('verify', () => {
    it('returns the parsed visa for a valid JWT', async () => {
      const km = await makeKey();
      const verifier = new PassportVerifier(stubResolver(km.publicJwk));
      const jwt = await makeVisaJwt({ privateKey: km.privateKey, iss: ISSUER, jti: 'abc' });
      const result = await verifier.verify(jwt, { issuer: ISSUER, jwksUri: JWKS_URI });
      expect(result).not.toBeNull();
      expect(result?.iss).toBe(ISSUER);
      expect(result?.visaType).toBe('ResearcherStatus');
      expect(result?.jti).toBe('abc');
      expect(result?.visa.value).toContain('doi.org');
      expect(result?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns null when the JWT is signed by the wrong key', async () => {
      const km1 = await makeKey();
      const km2 = await makeKey();
      const verifier = new PassportVerifier(stubResolver(km1.publicJwk));
      const jwt = await makeVisaJwt({ privateKey: km2.privateKey, iss: ISSUER });
      const result = await verifier.verify(jwt, { issuer: ISSUER, jwksUri: JWKS_URI });
      expect(result).toBeNull();
    });

    it('returns null when the issuer claim does not match', async () => {
      const km = await makeKey();
      const verifier = new PassportVerifier(stubResolver(km.publicJwk));
      const jwt = await makeVisaJwt({
        privateKey: km.privateKey,
        iss: 'https://attacker.example/oidc/',
      });
      const result = await verifier.verify(jwt, { issuer: ISSUER, jwksUri: JWKS_URI });
      expect(result).toBeNull();
    });

    it('returns null when the JWT has expired', async () => {
      const km = await makeKey();
      const verifier = new PassportVerifier(stubResolver(km.publicJwk));
      const jwt = await makeVisaJwt({
        privateKey: km.privateKey,
        iss: ISSUER,
        expSecondsFromNow: -60,
      });
      const result = await verifier.verify(jwt, { issuer: ISSUER, jwksUri: JWKS_URI });
      expect(result).toBeNull();
    });

    it('returns null when the ga4gh_visa_v1 claim is missing', async () => {
      const km = await makeKey();
      const verifier = new PassportVerifier(stubResolver(km.publicJwk));
      const jwt = await makeVisaJwt({ privateKey: km.privateKey, iss: ISSUER, omitVisa: true });
      const result = await verifier.verify(jwt, { issuer: ISSUER, jwksUri: JWKS_URI });
      expect(result).toBeNull();
    });
  });
});
