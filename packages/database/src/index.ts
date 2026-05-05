// Prisma 7 client wrapped with the @prisma/adapter-pg driver.
//
// `prisma` is exported as a Proxy that LAZILY constructs the underlying
// PrismaClient on first property access. This is intentional: at module
// import time the consuming process may not yet have a usable
// `DATABASE_URL` — for example the API container reads per-field DB_*
// ECS secrets and composes its own URL inside a NestJS provider that
// runs after import. Eager construction would throw during import and
// crash the process before the provider gets a chance to register.
//
// Consumers that don't need the singleton (NestJS via DI, scripts that
// build their own client) can ignore it. Those that DO use `prisma.x`
// pay one Proxy hop per call but get the convenient pre-configured
// singleton with the @prisma/adapter-pg driver wired in.

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client/index.js';

declare global {
  var __ociPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const connectionString = resolveDatabaseUrl();
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

/**
 * Resolve the connection URL from `DATABASE_URL` or, if unset, from the
 * per-field DB_* env vars (Aurora secret injection pattern used by the
 * API + migrate task definitions). URL-encodes the password so
 * Aurora-rotated reserved characters survive.
 */
function resolveDatabaseUrl(): string {
  const direct = process.env.DATABASE_URL;
  if (direct && direct.length > 0) return direct;

  const username = process.env.DB_USERNAME;
  const password = process.env.DB_PASSWORD;
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT;
  const dbname = process.env.DB_NAME;
  if (username && password && host && port && dbname) {
    const encPassword = encodeURIComponent(password);
    return `postgresql://${username}:${encPassword}@${host}:${port}/${dbname}?schema=public&sslmode=require`;
  }

  throw new Error(
    'DATABASE_URL not set and per-field DB_* env (DB_USERNAME / DB_PASSWORD / DB_HOST / DB_PORT / DB_NAME) is incomplete.',
  );
}

function getOrCreate(): PrismaClient {
  if (globalThis.__ociPrisma) return globalThis.__ociPrisma;
  globalThis.__ociPrisma = createClient();
  return globalThis.__ociPrisma;
}

/**
 * Lazy singleton. The Proxy intercepts every property access and
 * constructs the real client on the first one, so importing this module
 * never executes `createClient()` — and never throws if env isn't set up
 * yet. The cast through `unknown` keeps the public type surface clean
 * (`prisma.dataset.findUnique(...)` works exactly as if it were a real
 * PrismaClient instance).
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getOrCreate(), prop, receiver);
  },
}) as PrismaClient;

// Re-export the runtime PrismaClient class for callers that need their
// own instance (e.g. NestJS DI scopes that want lifecycle hooks). Most
// code should use `prisma` above; PrismaClient is here as an escape hatch.
export { PrismaClient } from './generated/client/index.js';

// The `Prisma` namespace carries the typed model interfaces, helpers
// (Prisma.sql, Prisma.InputJsonValue, …), and runtime errors. Re-export
// as both type-only and runtime so consumers don't have to know the
// difference. Model types (Dataset, DatasetVersion, …) are available via
// `Prisma.Dataset`-style accessors and as named exports below.
export { Prisma } from './generated/client/index.js';

// Domain model types — convenience re-exports so callers can write
//   import type { Dataset, DatasetVersion } from '@oci/database';
// rather than reaching into the generated path. Keep this list in sync
// with prisma/schema.prisma.
export type {
  User,
  Dataset,
  DatasetVersion,
  Distribution,
  AccessRequest,
  DatasetVisibility,
  DatasetStatus,
  AccessRequestStatus,
} from './generated/client/index.js';
