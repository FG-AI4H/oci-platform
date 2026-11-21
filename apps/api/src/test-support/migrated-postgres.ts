import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  /** Connection string, for tools a spec runs as a child process (the seed, the migrate scripts). */
  url: string;
  stop: () => Promise<void>;
}

/**
 * Replay a SQL file the way `apps/migrate/entrypoint.sh` does: the bucket
 * setting first, then the file, through `prisma db execute`. Throws with the
 * database's message when the script fails.
 */
export function replaySeedFile(url: string, sql: string, bucket = 'oci-datasets-test'): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'oci-seed-'));
  const script = path.join(dir, 'seed.sql');
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed name in a directory mkdtemp just created
    writeFileSync(script, `SET app.datasets_bucket = '${bucket}';\n${sql}`);
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'execute', '--file', script], {
      cwd: DATABASE_PKG,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    url,
    stop: async () => {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}
