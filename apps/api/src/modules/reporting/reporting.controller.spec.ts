import { type ExecutionContext, UnauthorizedException, VersioningType } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { ReportingController } from './reporting.controller.js';
import { ReportingService } from './reporting.service.js';

/**
 * Who may read the activity report (#828), over HTTP with the real role
 * guard. Only the token check is stubbed: `x-test-groups` stands in for a
 * verified token's groups, and no header at all for no token.
 */
const stubJwt = {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: unknown;
    }>();
    const groups = req.headers['x-test-groups'];
    if (groups === undefined) throw new UnauthorizedException();
    req.user = { sub: 'someone', 'cognito:groups': groups.split(',').filter(Boolean) };
    return true;
  },
};

const reporting = { activity: vi.fn() };

describe('/v2/reports/activity (#828)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ReportingController],
      providers: [RolesGuard, { provide: ReportingService, useValue: reporting }],
    })
      .overrideGuard(CognitoJwtGuard)
      .useValue(stubJwt)
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    reporting.activity.mockResolvedValue({ v: 1, month: '2026-11' });
  });

  const get = (query: string, groups?: string) =>
    app.inject({
      method: 'GET',
      url: `/v2/reports/activity${query}`,
      headers: groups === undefined ? {} : { 'x-test-groups': groups },
    });

  it.each(['admin', 'regulator', 'supervisor', 'participant,admin'])(
    'serves the report to %s',
    async (groups) => {
      const res = await get('?month=2026-11', groups);

      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(reporting.activity).toHaveBeenCalledWith('2026-11');
    },
  );

  it.each(['participant', 'host', 'evaluation-reviewer', 'campaign-manager', ''])(
    'refuses "%s"',
    async (groups) => {
      const res = await get('', groups);

      expect(res.statusCode).toBe(403);
      expect(reporting.activity).not.toHaveBeenCalled();
    },
  );

  it('refuses a caller with no token', async () => {
    expect((await get('')).statusCode).toBe(401);
    expect(reporting.activity).not.toHaveBeenCalled();
  });

  it('without a month, leaves the choice of the month to the service', async () => {
    await get('', 'admin');

    expect(reporting.activity).toHaveBeenCalledWith(undefined);
  });

  it.each(['?month=2026-13', '?month=november', '?month=2026-11-01'])(
    'refuses %s',
    async (query) => {
      expect((await get(query, 'admin')).statusCode).toBe(400);
      expect(reporting.activity).not.toHaveBeenCalled();
    },
  );
});
