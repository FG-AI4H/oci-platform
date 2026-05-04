import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../auth/cognito-jwt.guard.js';

/**
 * `/v2/me` returns the authenticated principal's identity for the
 * supplied Cognito access token. The first piece of authenticated API
 * surface — also serves as the integration test for the JWT guard.
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller({ path: 'me', version: '2' })
@UseGuards(CognitoJwtGuard)
export class MeController {
  @Get()
  @ApiOkResponse({
    description: 'Authenticated user — sub, username, groups, scope, expiry',
  })
  me(@CurrentUser() user: CognitoAccessTokenPayload) {
    return {
      sub: user.sub,
      username: user.username,
      groups: user['cognito:groups'] ?? [],
      scope: user.scope,
      tokenUse: user.token_use,
      expiresAt: new Date(user.exp * 1000).toISOString(),
    };
  }
}
