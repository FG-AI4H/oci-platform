import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/** Where the OpenAPI document is served, relative to the API origin. */
export const OPENAPI_JSON_PATH = '/docs-json';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('OCI Platform API')
    .setDescription(
      'Open Code Infrastructure — unified API for GI-AI4H (Global Initiative on AI for Health)',
    )
    .setVersion(process.env.APP_VERSION ?? '0.0.1')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

/**
 * The JSON document at `/docs-json` is published in every environment so
 * partners can discover the API by machine (#590); it is linked from
 * `/.well-known/oci-capabilities.json`. The interactive UI at `/docs` and the
 * YAML twin stay dev / int only. Worker-only routes carry
 * `@ApiExcludeEndpoint()` so they never appear in the document.
 *
 * OCI_ENV is set by the ECS task definition (api-stack.ts).
 */
export function setupOpenApi(app: INestApplication, env = process.env.OCI_ENV): void {
  const isProd = env === 'prod';
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    ui: !isProd,
    raw: isProd ? ['json'] : true,
  });
}
