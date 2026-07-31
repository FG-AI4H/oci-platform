import { Controller, Get, Module, Query, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { BulkDownloadManifestFlagSchema } from './bulk-download-query.js';

/**
 * Pins the accepted shapes of `?manifest=` on the bulk-download route.
 *
 * Context: on `dev`, the original string-only `z.enum(['true','false'])`
 * rejected EVERY value — `?manifest=true` and `?manifest=false` both 400'd
 * with "expected one of true|false" — while omitting the parameter worked.
 * That pattern is what you get when something coerces the query string to a
 * real boolean before this schema runs (`main.ts` registers a global
 * `ValidationPipe({ transform: true })` and the handler declares
 * `manifest: boolean`, so Nest's `transformPrimitive` is the prime suspect).
 *
 * Honest limitation: this test does NOT reproduce that failure. Mounting the
 * same schema, ZodPipe, declared `boolean` param, global ValidationPipe and
 * URI versioning locally still passes with the old string-only schema, so the
 * mechanism is inferred from the production symptom, not proven here. What
 * this test does guarantee is that both wire shapes (string literal and real
 * boolean) and the absent case are accepted, and that a nonsense value is
 * still a loud 400 — so the endpoint cannot regress to accepting only one
 * shape. The deployed behaviour is the real verification.
 */
@Controller()
class ManifestFlagProbeController {
  @Get('probe')
  probe(@Query('manifest', new ZodPipe(BulkDownloadManifestFlagSchema)) manifest: boolean): {
    manifest: boolean;
    type: string;
  } {
    return { manifest, type: typeof manifest };
  }
}

@Module({ controllers: [ManifestFlagProbeController] })
class ProbeModule {}

describe('bulk download — ?manifest= binding under the global ValidationPipe', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // Mirrors main.ts — the whole point of this test.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (query: string) => app.inject({ method: 'GET', url: `/probe${query}` });

  it.each([
    ['?manifest=true', true],
    ['?manifest=false', false],
    ['', false],
  ])('binds %s to %s', async (query, expected) => {
    const res = await get(query);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ manifest: expected, type: 'boolean' });
  });

  it('still rejects a nonsense value loudly rather than defaulting to false', async () => {
    const res = await get('?manifest=maybe');

    expect(res.statusCode).toBe(400);
  });

  // The shape the deployed app appears to hand the pipe (see the file
  // header). Asserted directly on the schema because the local HTTP stack
  // does not perform this coercion — without this case, the fix for the
  // production 400 would have no test at all.
  it.each([
    [true, true],
    [false, false],
  ])('accepts an already-coerced boolean %s', (input, expected) => {
    const parsed = BulkDownloadManifestFlagSchema.safeParse(input);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toBe(expected);
  });

  it('accepts the string literals directly too', () => {
    expect(BulkDownloadManifestFlagSchema.parse('true')).toBe(true);
    expect(BulkDownloadManifestFlagSchema.parse('false')).toBe(false);
    expect(BulkDownloadManifestFlagSchema.parse(undefined)).toBe(false);
  });
});
