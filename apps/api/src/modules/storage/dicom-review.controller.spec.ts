import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { DicomReviewController } from './dicom-review.controller.js';

/**
 * Who may review held DICOM files (ADR-0026): platform operators, which
 * until a separate role exists means the `admin` group. One route here
 * returns header values that may identify a patient, so the rule is
 * pinned by a test: it is the real guard, run against the real
 * controller's own metadata, for each route.
 */
const ROUTES = ['listHeld', 'findings', 'decide'] as const;

function contextFor(route: (typeof ROUTES)[number], groups: string[] | null): ExecutionContext {
  const handler = Reflect.get(DicomReviewController.prototype, route) as () => unknown;
  return {
    getHandler: () => handler,
    getClass: () => DicomReviewController,
    switchToHttp: () => ({
      getRequest: () => (groups === null ? {} : { user: { sub: 's', 'cognito:groups': groups } }),
    }),
  } as unknown as ExecutionContext;
}

describe('DicomReviewController — operators only', () => {
  it('verifies the token first, then the role, on the whole controller', () => {
    // The key `@UseGuards` writes its list under.
    const guards = Reflect.getMetadata('__guards__', DicomReviewController) as unknown[];
    expect(guards).toEqual([CognitoJwtGuard, RolesGuard]);
  });

  it.each(ROUTES)('%s: admits an admin', (route) => {
    expect(new RolesGuard().canActivate(contextFor(route, ['admin']))).toBe(true);
    expect(new RolesGuard().canActivate(contextFor(route, ['host', 'admin']))).toBe(true);
  });

  it.each(ROUTES)('%s: refuses everyone else, the dataset host included', (route) => {
    for (const groups of [
      ['host'],
      ['participant'],
      ['regulator'],
      ['supervisor'],
      ['campaign-manager', 'annotator'],
      [],
      null,
    ]) {
      expect(
        () => new RolesGuard().canActivate(contextFor(route, groups)),
        JSON.stringify(groups),
      ).toThrow(ForbiddenException);
    }
  });
});
