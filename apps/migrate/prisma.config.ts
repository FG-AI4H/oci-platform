// Prisma 7 config — Migrate is required to obtain the connection URL from
// here (the schema's datasource block intentionally has no `url` field; the
// running API uses @prisma/adapter-pg at application runtime instead). This
// config sits at /app/prisma.config.ts inside the migrate container; the
// entrypoint exports DATABASE_URL before invoking `prisma migrate deploy`.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasourceUrl: process.env.DATABASE_URL,
});
