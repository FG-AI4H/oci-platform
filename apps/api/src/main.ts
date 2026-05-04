import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: true }),
  );

  await app.register(helmet, { contentSecurityPolicy: false });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Swagger UI at /docs is exposed in dev / int only — not prod.
  // OCI_ENV is set by the ECS task definition (api-stack.ts).
  if (process.env.OCI_ENV !== 'prod') {
    const config = new DocumentBuilder()
      .setTitle('OCI Platform API')
      .setDescription(
        'Open Code Infrastructure — unified API for GI-AI4H (Global Initiative on AI for Health)',
      )
      .setVersion('0.0.1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`OCI API listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
