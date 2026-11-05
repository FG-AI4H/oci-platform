import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OpenAPIObject } from '@nestjs/swagger';
import { OciCapabilitiesDocumentSchema } from '@oci/shared-types';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module.js';
import { buildOpenApiDocument } from '../../openapi.js';
import { CapabilitiesService } from './capabilities.service.js';

describe('CapabilitiesService (#590)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('serves a document that satisfies the shared schema', () => {
    const doc = new CapabilitiesService().document();
    expect(OciCapabilitiesDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('builds links from OCI_API_URL and reads the jurisdiction', () => {
    vi.stubEnv('OCI_API_URL', 'https://oci.ai4h.net/');
    vi.stubEnv('OCI_JURISDICTION', 'CH');
    const doc = new CapabilitiesService().document();
    expect(doc.platform.baseUrl).toBe('https://oci.ai4h.net');
    expect(doc.platform.jurisdiction).toBe('CH');
    expect(doc.links.openapi).toBe('https://oci.ai4h.net/docs-json');
    expect(doc.links.croissantCatalog).toBe(
      'https://oci.ai4h.net/v2/catalog/.well-known/croissant-catalog.json',
    );
  });

  it('reports a null jurisdiction when OCI_JURISDICTION is unset or blank', () => {
    vi.stubEnv('OCI_JURISDICTION', '  ');
    expect(new CapabilitiesService().document().platform.jurisdiction).toBeNull();
  });

  it('keeps Operate empty with the out-of-scope note', () => {
    const { operate } = new CapabilitiesService().document().capabilities;
    expect(operate.capabilities).toEqual([]);
    expect(operate.note).toMatch(/out of scope/i);
  });

  it('uses each capability id once', () => {
    const ids = Object.values(new CapabilitiesService().document().capabilities).flatMap((g) =>
      g.capabilities.map((c) => c.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * Builds the real OpenAPI document from `AppModule` and checks the
 * capability list against it. `preview: true` registers every controller's
 * routes without instantiating providers, so no database, Redis or AWS is
 * needed. Versioning mirrors `main.ts`; without it the paths lose `/v2`.
 */
describe('capability paths against the OpenAPI document (#590)', () => {
  let app: NestFastifyApplication;
  let openapi: OpenAPIObject;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      preview: true,
      logger: false,
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
    openapi = buildOpenApiDocument(app);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  const entries = Object.values(new CapabilitiesService().document().capabilities).flatMap(
    (g) => g.capabilities,
  );

  it.each(entries.map((e) => [e.id, e] as const))('%s matches a real route', (_id, entry) => {
    const operation = openapi.paths[entry.path]?.[entry.method.toLowerCase() as 'get'];
    expect(operation, `${entry.method} ${entry.path}`).toBeDefined();
  });

  it('publishes the capability document itself', () => {
    expect(openapi.paths['/.well-known/oci-capabilities.json']?.get).toBeDefined();
  });

  it('leaves the worker-only result callback out', () => {
    expect(openapi.paths['/v2/submissions/{id}/result']).toBeUndefined();
  });
});
