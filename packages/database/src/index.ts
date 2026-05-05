// Prisma 7 client wrapped with the @prisma/adapter-pg driver.
// Application code imports `prisma` from this module — never instantiates
// PrismaClient directly. Connection URL comes from DATABASE_URL at runtime.

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client/index.js';

declare global {
  var __ociPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required at runtime');
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

export const prisma: PrismaClient =
  globalThis.__ociPrisma ?? (globalThis.__ociPrisma = createClient());

if (process.env.NODE_ENV === 'production') {
  // Reset the dev-only cache pattern in prod (no global re-use).
  globalThis.__ociPrisma = undefined;
}

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
