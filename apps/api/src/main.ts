// Polyfill Reflect.metadata before any @nestjs/* decorator runs so
// constructor-param types are visible to Nest's DI. NestJS v11 stopped
// importing this side-effect module implicitly; without it, classes
// declared with `constructor(private foo: Foo) {}` (no @Inject) get
// their dependency resolved as `undefined`. Required for both `tsc`
// builds and `tsx`-based local dev.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module.js';
import { SERVER_BODY_LIMIT_BYTES } from './common/http/body-limits.js';
import { configureRequestBodyLimits } from './common/http/configure-body-limits.js';
import { setupOpenApi } from './openapi.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      trustProxy: true,
      // Default 100 truncates S3 multipart UploadIds (~124 chars,
      // longer for some configurations) and 404s the part-URL route.
      // 512 leaves headroom for federated remote IDs without
      // inviting URL abuse.
      maxParamLength: 512,
      // Request body limit (#741): Fastify's own default (1 MiB), written
      // down. The routes that take more (predictions, manifest publish)
      // are listed in common/http/body-limits.ts and get theirs below.
      bodyLimit: SERVER_BODY_LIMIT_BYTES,
    }),
  );

  // Per-route body limits and the 413 problem response. Before init, so
  // the hook sees the routes as they are registered.
  const bodyLimits = configureRequestBodyLimits(app);

  await app.register(helmet, { contentSecurityPolicy: false });

  // CORS: needed for the multipart upload path (PR I, #87) — the
  // browser hits `/v2/catalog/datasets/:slug/uploads*` directly to
  // mint presigned URLs, then PUTs each part to S3 without going
  // through the web origin. In production both halves sit behind the
  // same ALB at oci.ai4h.net so this is a no-op (same-origin); in
  // local dev / int the web origin is configured explicitly.
  // OCI_WEB_ORIGIN is comma-separated; defaults to localhost:3001 for
  // local-dev convenience.
  const webOrigins = (process.env.OCI_WEB_ORIGIN ?? 'http://localhost:3001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: webOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    credentials: false,
    maxAge: 600,
  });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  setupOpenApi(app);

  // Registers the routes. A body-limit entry that matched no route stops
  // the start here rather than leaving that route at the default.
  await app.init();
  bodyLimits.assertAllApplied();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`OCI API listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
