import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { CampaignAnnotationsController } from './campaign-annotations.controller.js';
import { AnnotationRolesGuard } from './roles.guard.js';

type Handler = 'agreement' | 'exportCsv' | 'exportJson';
const HANDLERS: Handler[] = ['agreement', 'exportCsv', 'exportJson'];
const EXPORTS: Handler[] = ['exportCsv', 'exportJson'];
const method = (name: Handler) =>
  Object.getOwnPropertyDescriptor(CampaignAnnotationsController.prototype, name)?.value as object;

function ctx(handler: Handler, groups: string[] | undefined): ExecutionContext {
  const user = groups === undefined ? {} : { 'cognito:groups': groups };
  return {
    getHandler: () => method(handler),
    getClass: () => CampaignAnnotationsController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('CampaignAnnotationsController role rules (#648)', () => {
  const guard = new AnnotationRolesGuard();
  const allowed = (handler: Handler, groups: string[] | undefined) => {
    try {
      return guard.canActivate(ctx(handler, groups));
    } catch (err) {
      if (err instanceof ForbiddenException) return false;
      throw err;
    }
  };

  it.each(HANDLERS)('%s: authenticates before checking roles', (handler) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, method(handler)) as unknown[];
    expect(guards).toEqual([CognitoJwtGuard, AnnotationRolesGuard]);
  });

  it.each(HANDLERS)('%s: a campaign manager, a task supervisor and an admin may', (handler) => {
    expect(allowed(handler, ['campaign-manager'])).toBe(true);
    expect(allowed(handler, ['task-supervisor'])).toBe(true);
    expect(allowed(handler, ['admin'])).toBe(true);
  });

  it.each(EXPORTS)('%s: a task supervisor may export (decision of 2026-11-25)', (handler) => {
    expect(allowed(handler, ['task-supervisor'])).toBe(true);
    expect(allowed(handler, ['task-supervisor', 'annotator'])).toBe(true);
  });

  it.each(HANDLERS)('%s: readers, arbiters, experts and outsiders may not', (handler) => {
    for (const groups of [
      ['annotator'],
      ['arbitration-annotator'],
      ['expert-reviewer'],
      ['reviewer'],
      ['host'],
      ['regulator'],
      [],
    ]) {
      expect(allowed(handler, groups)).toBe(false);
    }
    expect(allowed(handler, undefined)).toBe(false);
  });
});
