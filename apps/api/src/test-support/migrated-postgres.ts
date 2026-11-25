import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * `prisma migrate deploy` against `url`. With `before`, only the
 * migrations whose folder name sorts before it are applied, so a spec can
 * write rows the way an older schema wrote them and then deploy the rest
 * (again with this function, without `before`) exactly as a release does.
 */
export function deployMigrations(url: string, opts: { before?: string } = {}): void {
  const { before } = opts;
  if (before === undefined) {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: DATABASE_PKG,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
    return;
  }
  const source = path.join(DATABASE_PKG, 'prisma', 'migrations');
  const names = readdirSync(source).filter((n) => /^\d{14}_/.test(n) && n < before);
  if (names.length === 0) throw new Error(`deployMigrations: no migration before ${before}`);
  const dir = mkdtempSync(path.join(tmpdir(), 'oci-migrations-'));
  try {
    const migrations = path.join(dir, 'migrations');
    for (const name of names) {
      cpSync(path.join(source, name), path.join(migrations, name), { recursive: true });
    }
    cpSync(path.join(source, 'migration_lock.toml'), path.join(migrations, 'migration_lock.toml'));
    // A config with no imports, so that it loads from outside the package.
    const config = path.join(dir, 'prisma.config.mjs');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed name in a directory mkdtemp just created
    writeFileSync(
      config,
      `export default ${JSON.stringify({
        schema: path.join(DATABASE_PKG, 'prisma', 'schema.prisma'),
        migrations: { path: migrations },
        datasource: { url },
      })};\n`,
    );
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--config', config], {
      cwd: DATABASE_PKG,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Start an empty Postgres, the major the deployed cluster runs. */
export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  // Same major as the Aurora cluster: infra/cdk/lib/data-stack.ts declares
  // AuroraPostgresEngineVersion.VER_16_4 (#742). Change both together.
  // infra/local/docker-compose.yml still runs 17 for local development.
  return new PostgreSqlContainer('postgres:16-alpine').start();
}

/** Start Postgres, run `prisma migrate deploy` against it, return a client. */
export async function startMigratedPostgres(): Promise<MigratedPostgres> {
  const container = await startPostgres();
  const url = container.getConnectionUri();
  deployMigrations(url);
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
