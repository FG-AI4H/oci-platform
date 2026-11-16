import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@oci/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { getContainerRuntimeClient } from 'testcontainers';

/**
 * Shared bootstrap for `*.int.spec.ts` files that need a real Postgres
 * with every migration applied (Testcontainers).
 *
 * Needs a Docker daemon. CI (`CI=true`) always has one, so a missing
 * daemon there is an error; a laptop without Docker gets `false` from
 * `dockerAvailable()` and the spec skips rather than failing `pnpm test`.
 */

const DATABASE_PKG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/database',
);

export async function dockerAvailable(specName: string): Promise<boolean> {
  const available = await getContainerRuntimeClient().then(
    () => true,
    () => false,
  );
  if (!available && process.env.CI) {
    throw new Error(`${specName}: no Docker daemon reachable in CI`);
  }
  return available;
}

export interface MigratedPostgres {
  prisma: PrismaClient;
  stop: () => Promise<void>;
}

/** Start Postgres, run `prisma migrate deploy` against it, return a client. */
export async function startMigratedPostgres(): Promise<MigratedPostgres> {
  // Same major as infra/local/docker-compose.yml and Aurora.
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:17-alpine',
  ).start();
  const url = container.getConnectionUri();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: DATABASE_PKG,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return {
    prisma,
    stop: async () => {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}
