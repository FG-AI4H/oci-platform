// Prisma 7 configuration — owns the connection URL for Migrate / Studio.
// Application-time PrismaClient gets its connection from the @prisma/adapter-pg
// instance instead (see src/index.ts).

import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasourceUrl: process.env.DATABASE_URL,
});
