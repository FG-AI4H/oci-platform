import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateJwkThumbprint, exportJWK } from 'jose';
import type { PrismaService } from '../../prisma.service.js';
import { PassportKeyService, type KmsPublicKeyPort } from './passport-key.service.js';

const ARN = 'arn:aws:kms:eu-central-1:000000000000:key/11111111-2222-3333-4444-555555555555';

interface Row {
  kid: string;
  alg: string;
  kmsKeyArn: string | null;
  privateKeyPem: string | null;
  publicJwk: Record<string, unknown>;
  status: string;
}

function prismaWith(rows: Row[]) {
  const table = {
    findFirst: vi.fn(async () => rows.find((r) => r.status === 'ACTIVE') ?? null),
    findUnique: vi.fn(
      async ({ where }: { where: { kid: string } }) =>
        rows.find((r) => r.kid === where.kid) ?? null,
    ),
    create: vi.fn(async ({ data }: { data: Row }) => {
      if (rows.some((r) => r.kid === data.kid)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row: Row = {
        ...data,
        privateKeyPem: data.privateKeyPem ?? null,
        kmsKeyArn: data.kmsKeyArn ?? null,
      };
      rows.push(row);
      return row;
    }),
  };
  return { prisma: { client: { passportSigningKey: table } } as unknown as PrismaService, table };
}

function rsaKms() {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ format: 'der', type: 'spki' });
  const kms: KmsPublicKeyPort = {
    send: vi.fn(async () => ({ PublicKey: new Uint8Array(der), KeySpec: 'RSA_2048' })),
  };
  return { kms, publicKey };
}

describe('PassportKeyService — KMS-backed key (#620)', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.OCI_PASSPORT_ISSUER_KMS_KEY_ARN = ARN;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('seeds the ACTIVE row from the KMS public key, with the JWK thumbprint as kid', async () => {
    const rows: Row[] = [];
    const { prisma } = prismaWith(rows);
    const { kms, publicKey } = rsaKms();
    const svc = new PassportKeyService(prisma, kms);

    const key = await svc.ensureActiveKey();

    const expectedKid = await calculateJwkThumbprint(await exportJWK(publicKey));
    expect(key).toMatchObject({
      kid: expectedKid,
      alg: 'RS256',
      kmsKeyArn: ARN,
      privateKeyPem: null,
    });
    expect(key.publicJwk).toMatchObject({ kty: 'RSA', kid: expectedKid, alg: 'RS256', use: 'sig' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.privateKeyPem).toBeNull();
  });

  it('publishes the key at boot, before any visa is issued', async () => {
    const rows: Row[] = [];
    const { prisma } = prismaWith(rows);
    const { kms } = rsaKms();
    const svc = new PassportKeyService(prisma, kms);

    await svc.onApplicationBootstrap();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('ACTIVE');
  });

  it('reuses an existing ACTIVE row and never calls KMS', async () => {
    const existing: Row = {
      kid: 'existing',
      alg: 'RS256',
      kmsKeyArn: ARN,
      privateKeyPem: null,
      publicJwk: { kty: 'RSA', kid: 'existing' },
      status: 'ACTIVE',
    };
    const { prisma, table } = prismaWith([existing]);
    const { kms } = rsaKms();
    const svc = new PassportKeyService(prisma, kms);

    expect((await svc.ensureActiveKey()).kid).toBe('existing');
    expect(kms.send).not.toHaveBeenCalled();
    expect(table.create).not.toHaveBeenCalled();
  });

  it('returns the row another task inserted first instead of adding a second ACTIVE key', async () => {
    const rows: Row[] = [];
    const { prisma, table } = prismaWith(rows);
    const { kms } = rsaKms();
    const svc = new PassportKeyService(prisma, kms);
    const first = await svc.ensureActiveKey();
    // Simulate the race: this task read "no ACTIVE row" before the other one inserted.
    table.findFirst.mockResolvedValueOnce(null);

    const second = await svc.ensureActiveKey();

    expect(second.kid).toBe(first.kid);
    expect(rows).toHaveLength(1);
  });

  it('refuses a non-RSA key, because visas are signed with RSASSA_PKCS1_V1_5_SHA_256', async () => {
    const { prisma } = prismaWith([]);
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const kms: KmsPublicKeyPort = {
      send: vi.fn(async () => ({
        PublicKey: new Uint8Array(publicKey.export({ format: 'der', type: 'spki' })),
        KeySpec: 'ECC_NIST_P256',
      })),
    };
    const svc = new PassportKeyService(prisma, kms);

    await expect(svc.ensureActiveKey()).rejects.toThrow(/must be RSA/);
  });

  it('logs instead of crashing the boot when KMS is unreachable', async () => {
    const { prisma } = prismaWith([]);
    const kms: KmsPublicKeyPort = { send: vi.fn(async () => Promise.reject(new Error('timeout'))) };
    const svc = new PassportKeyService(prisma, kms);

    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('still refuses to generate a local key in production when no KMS key is configured', async () => {
    delete process.env.OCI_PASSPORT_ISSUER_KMS_KEY_ARN;
    const { prisma } = prismaWith([]);
    const svc = new PassportKeyService(prisma);

    await expect(svc.ensureActiveKey()).rejects.toThrow(/OCI_PASSPORT_ISSUER_KMS_KEY_ARN/);
  });
});
