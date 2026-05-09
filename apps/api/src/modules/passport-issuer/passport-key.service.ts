import { generateKeyPairSync, createPrivateKey, type KeyObject } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PublicJwk } from '@oci/shared-types';
import { exportJWK } from 'jose';
import { PrismaService } from '../../prisma.service.js';

/**
 * Passport signing-key registry (#127).
 *
 * One ACTIVE key at any time; rotation moves the previous to RETIRED
 * (still in JWKS so unexpired visas verify) and stamps a new ACTIVE.
 * Operators rotate by inserting a new row + flipping status; today
 * the only entry-point is `ensureActiveKey()` which seeds a row on
 * first boot when none exists.
 *
 * Two key materialisations:
 *   - **KMS**: `OCI_PASSPORT_ISSUER_KMS_KEY_ARN` — production path.
 *     The signing happens via `KMS:Sign` (RSASSA_PKCS1_V1_5_SHA_256).
 *     Public-JWK is fetched once via `KMS:GetPublicKey` and cached
 *     on the row.
 *   - **Local**: an ephemeral RSA-2048 keypair generated on first
 *     boot. The private key PEM is stored on the row. Refused when
 *     `NODE_ENV=production`.
 *
 * Rotation policy (per security baseline): annual or on suspected
 * compromise. Out of scope for this PR — the row schema supports it
 * and a rotation runbook can drive `INSERT … status='ACTIVE'` +
 * `UPDATE old_row SET status='RETIRED', retired_at=now()`.
 */

export interface SigningKeyMaterial {
  kid: string;
  alg: string;
  /** When KMS-backed, the ARN; signing goes through `KMS:Sign`. */
  kmsKeyArn: string | null;
  /** When local, the PEM-encoded private key. */
  privateKeyPem: string | null;
  publicJwk: PublicJwk;
}

@Injectable()
export class PassportKeyService {
  private readonly logger = new Logger(PassportKeyService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Returns the current ACTIVE key, seeding a local keypair on first
   * boot when none exists. Production deployments should provision
   * the KMS key out-of-band and seed the row via deploy script; the
   * local-dev seeding is a convenience that's refused in prod.
   */
  async ensureActiveKey(): Promise<SigningKeyMaterial> {
    const existing = await this.prisma.client.passportSigningKey.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return rowToMaterial(existing as unknown as SigningKeyRow);

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'No ACTIVE Passport signing key configured. Provision via KMS and seed `passport_signing_keys` before boot.',
      );
    }

    this.logger.warn(
      'No ACTIVE Passport signing key found — generating an ephemeral local RSA keypair (DEV ONLY).',
    );
    const seeded = await this.seedLocalKey();
    return seeded;
  }

  /** Returns all ACTIVE + RETIRED-not-archived keys for the JWKS endpoint. */
  async listPublishedKeys(): Promise<PublicJwk[]> {
    const rows = await this.prisma.client.passportSigningKey.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => (r as unknown as SigningKeyRow).publicJwk);
  }

  /** Lookup by kid — used at sign time to verify the row hasn't been retired mid-flight. */
  async findKey(kid: string): Promise<SigningKeyMaterial | null> {
    const row = await this.prisma.client.passportSigningKey.findUnique({
      where: { kid },
    });
    return row ? rowToMaterial(row as unknown as SigningKeyRow) : null;
  }

  // --- internals --------------------------------------------------------

  private async seedLocalKey(): Promise<SigningKeyMaterial> {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = `oci-local-${Date.now()}`;
    const alg = 'RS256';
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicJwk = await jwkFromKeyObject(publicKey, kid, alg);

    const row = await this.prisma.client.passportSigningKey.create({
      data: {
        kid,
        alg,
        privateKeyPem,
        publicJwk: publicJwk as never,
        status: 'ACTIVE',
      },
    });
    return rowToMaterial(row as unknown as SigningKeyRow);
  }
}

interface SigningKeyRow {
  kid: string;
  alg: string;
  kmsKeyArn: string | null;
  privateKeyPem: string | null;
  publicJwk: PublicJwk;
  status: string;
}

function rowToMaterial(row: SigningKeyRow): SigningKeyMaterial {
  return {
    kid: row.kid,
    alg: row.alg,
    kmsKeyArn: row.kmsKeyArn,
    privateKeyPem: row.privateKeyPem,
    publicJwk: row.publicJwk,
  };
}

async function jwkFromKeyObject(key: KeyObject, kid: string, alg: string): Promise<PublicJwk> {
  const raw = await exportJWK(key);
  return { ...raw, kid, alg, use: 'sig' } as PublicJwk;
}

// Tagged so callers needing a private-key handle have a typed import surface.
export function loadPrivateKeyFromPem(pem: string): KeyObject {
  return createPrivateKey({ key: pem, format: 'pem' });
}
