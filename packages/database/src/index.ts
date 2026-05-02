import { PrismaClient } from '@prisma/client';

declare global {
  var __ociPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__ociPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__ociPrisma = prisma;
}

export type { Prisma } from '@prisma/client';
