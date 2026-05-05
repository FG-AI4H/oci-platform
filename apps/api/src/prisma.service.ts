import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@oci/database';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * NestJS-friendly wrapper around Prisma 7 + @prisma/adapter-pg.
 *
 * Connection string resolution, in order:
 *   1. `DATABASE_URL` if set (local dev, integration tests, scripts).
 *   2. Composed from per-field ECS secrets (`DB_USERNAME`, `DB_PASSWORD`,
 *      `DB_HOST`, `DB_PORT`, `DB_NAME`) wired by the API task definition
 *      from the Aurora secret. The password never lands in plain env;
 *      ECS secrets inject the values fresh at task launch. We compose
 *      the URL at boot so it stays out of the task definition itself.
 *
 * Composition-not-inheritance: Prisma 7's PrismaClient is a generic
 * class whose method signatures are derived at type-instantiation time;
 * `extends PrismaClient` works at runtime but TS can't surface the
 * model accessors (`prisma.dataset`, `$queryRaw`, …) through the
 * subclass without hand-rolled overloads. Holding the client as a
 * member exposes the full API verbatim.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  /**
   * The wrapped Prisma client. Repositories access it via
   * `prismaService.client.dataset.findUnique(...)`. Use raw access
   * (`client.$queryRaw`, `client.$transaction`, `client.dataset`, …)
   * directly; we don't proxy methods.
   */
  public readonly client: PrismaClient;

  constructor() {
    const connectionString = resolveDatabaseUrl();
    this.client = new PrismaClient({
      // pg-connection-string ignores `ssl: { rejectUnauthorized: false }`
      // when a connectionString is also passed: pg's
      // ConnectionParameters does `Object.assign({}, config,
      // parse(connectionString))`, so the URL-derived ssl wins. Encode
      // the no-verify intent inside the URL itself via `sslmode=no-verify`,
      // which pg-connection-string maps directly to `rejectUnauthorized:
      // false`. Acceptable in this topology — the API talks to Aurora
      // over a private VPC subnet (no public route), the SG ingress
      // restricts source to the API's own SG, and the password is
      // rotated by Secrets Manager. If we ever need chain-of-custody
      // validation, switch to bundling the RDS root CA from
      // https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
      // into the image and use `sslmode=verify-full` with `sslrootcert`.
      adapter: new PrismaPg({ connectionString }),
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}

function resolveDatabaseUrl(): string {
  const direct = process.env.DATABASE_URL;
  if (direct && direct.length > 0) return direct;

  const username = process.env.DB_USERNAME;
  const password = process.env.DB_PASSWORD;
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT;
  const dbname = process.env.DB_NAME;
  if (username && password && host && port && dbname) {
    // URL-encode the password — Aurora-managed rotated secrets can
    // include @ : / ? & = and other reserved characters.
    const encPassword = encodeURIComponent(password);
    return `postgresql://${username}:${encPassword}@${host}:${port}/${dbname}?schema=public&sslmode=no-verify`;
  }

  throw new Error(
    'DATABASE_URL not set and per-field DB_* secrets are missing — ' +
      'wire the API task definition to inject DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME from the Aurora secret.',
  );
}
