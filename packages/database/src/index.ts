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

export type { Prisma } from './generated/client/index.js';
