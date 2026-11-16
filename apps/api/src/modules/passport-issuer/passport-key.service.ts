import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import { GetPublicKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap } from '@nestjs/common';
import type { PublicJwk } from '@oci/shared-types';
import { calculateJwkThumbprint, exportJWK } from 'jose';
import { PrismaService } from '../../prisma.service.js';

/** The slice of the KMS client this service calls; injectable for tests. */
export interface KmsPublicKeyPort {
  send(command: GetPublicKeyCommand): Promise<{ PublicKey?: Uint8Array; KeySpec?: string }>;
}

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

/** Injection token for the KMS port; absent in Nest wiring, so the service builds its own client. */
export const KMS_PUBLIC_KEY_PORT = Symbol('KMS_PUBLIC_KEY_PORT');

@Injectable()
export class PassportKeyService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PassportKeyService.name);
  private readonly kmsKeyArn: string | null;
  private readonly kms: KmsPublicKeyPort | null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(KMS_PUBLIC_KEY_PORT) kms?: KmsPublicKeyPort,
  ) {
    this.kmsKeyArn = process.env.OCI_PASSPORT_ISSUER_KMS_KEY_ARN || null;
    this.kms = kms ?? (this.kmsKeyArn ? new KMSClient({}) : null);
  }

  /**
   * Seed the KMS-backed row at boot (#620), so `/.well-known/jwks.json`
   * publishes the key before the first visa is issued. A failure here is
   * logged, not thrown: the API still serves everything else, and the next
   * `ensureActiveKey()` call retries.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.kmsKeyArn) return;
    try {
      const key = await this.ensureActiveKey();
      this.logger.log(`Passport signing key ready (kid=${key.kid})`);
    } catch (err) {
      this.logger.error(
        `Passport signing key not ready at boot: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Returns the current ACTIVE key. When none exists:
   *   - with `OCI_PASSPORT_ISSUER_KMS_KEY_ARN` set (deployed environments),
   *     seeds a row from the KMS key's public half (#620);
   *   - otherwise, outside production, generates an ephemeral local keypair;
   *   - otherwise throws.
   */
  async ensureActiveKey(): Promise<SigningKeyMaterial> {
    const existing = await this.prisma.client.passportSigningKey.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return rowToMaterial(existing as unknown as SigningKeyRow);

    if (this.kmsKeyArn) return this.seedKmsKey(this.kmsKeyArn);

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'No ACTIVE Passport signing key configured. Set OCI_PASSPORT_ISSUER_KMS_KEY_ARN to an RSA_2048 SIGN_VERIFY KMS key.',
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

  /**
   * Insert the ACTIVE row for a KMS key: public JWK from `GetPublicKey`,
   * `kid` = its RFC 7638 thumbprint. The thumbprint makes the insert
   * idempotent: two API tasks booting together compute the same `kid`, and
   * the loser of the race reads the winner's row instead of adding a second
   * ACTIVE key.
   */
  private async seedKmsKey(arn: string): Promise<SigningKeyMaterial> {
    if (!this.kms) throw new Error('KMS client not available');
    const out = await this.kms.send(new GetPublicKeyCommand({ KeyId: arn }));
    if (!out.PublicKey) throw new Error(`KMS GetPublicKey returned no key for ${arn}`);
    if (out.KeySpec && !out.KeySpec.startsWith('RSA_')) {
      // signWithKms signs with RSASSA_PKCS1_V1_5_SHA_256, so the key must be RSA.
      throw new Error(`Passport signing key must be RSA, got ${out.KeySpec}`);
    }
    const publicKey = createPublicKey({
      key: Buffer.from(out.PublicKey),
      format: 'der',
      type: 'spki',
    });
    const alg = 'RS256';
    const kid = await calculateJwkThumbprint(await exportJWK(publicKey));
    const publicJwk = await jwkFromKeyObject(publicKey, kid, alg);

    try {
      const row = await this.prisma.client.passportSigningKey.create({
        data: { kid, alg, kmsKeyArn: arn, publicJwk: publicJwk as never, status: 'ACTIVE' },
      });
      this.logger.log(`Seeded KMS-backed Passport signing key (kid=${kid})`);
      return rowToMaterial(row as unknown as SigningKeyRow);
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      const row = await this.prisma.client.passportSigningKey.findUnique({ where: { kid } });
      if (!row) throw err;
      return rowToMaterial(row as unknown as SigningKeyRow);
    }
  }

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
