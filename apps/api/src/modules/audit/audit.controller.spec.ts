import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { AuditController } from './audit.controller.js';

type Handler = 'list' | 'verify' | 'exportCsv' | 'exportJson';
const HANDLERS: Handler[] = ['list', 'verify', 'exportCsv', 'exportJson'];

function ctx(handler: Handler, groups: string[] | undefined): ExecutionContext {
  const user = groups === undefined ? {} : { 'cognito:groups': groups };
  return {
    getHandler: () => AuditController.prototype[handler],
    getClass: () => AuditController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AuditController role rules (#653)', () => {
  const guard = new RolesGuard();

  it('authenticates before checking roles, on every route', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AuditController) as unknown[];
    expect(guards).toEqual([CognitoJwtGuard, RolesGuard]);
  });

  it.each(HANDLERS)('%s: admin and regulator pass', (handler) => {
    expect(guard.canActivate(ctx(handler, ['admin']))).toBe(true);
    expect(guard.canActivate(ctx(handler, ['regulator']))).toBe(true);
  });

  it.each(HANDLERS)('%s: every other group is refused', (handler) => {
    for (const groups of [[], ['host'], ['supervisor'], ['participant', 'evaluation-reviewer']]) {
      expect(() => guard.canActivate(ctx(handler, groups))).toThrow(ForbiddenException);
    }
    expect(() => guard.canActivate(ctx(handler, undefined))).toThrow(ForbiddenException);
  });
});
