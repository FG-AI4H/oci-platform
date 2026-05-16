import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  GrantGroupRequestSchema,
  PlatformGroupSchema,
  type GrantGroupRequest,
  type PlatformGroup,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { Roles, RolesGuard } from '../../auth/roles.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { IdentityAdminService } from './identity-admin.service.js';

/**
 * `/v2/admin/users` — Cognito user + group management (#241).
 *
 * Admin-only. Every mutation writes an audit row via the service.
 * Rate-limited (10 mutations / minute / actor) to prevent fat-finger
 * group flapping.
 *
 * Visa-backed role assignment lands later (ADR-0006 Decision 2); this
 * controller stays put — the underlying service swaps its
 * implementation when that migration happens.
 */
@ApiTags('admin')
@Controller({ path: 'admin/users', version: '2' })
@UseGuards(CognitoJwtGuard, RolesGuard)
@Roles('admin')
export class IdentityAdminController {
  constructor(@Inject(IdentityAdminService) private readonly admin: IdentityAdminService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List Cognito users (admin only)' })
  @ApiOkResponse({ description: 'Page of user summaries with group membership.' })
  list(
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit = 25,
    @Query('search') search?: string,
  ) {
    return this.admin.listUsers({
      cursor: cursor ?? null,
      limit: Math.min(60, Math.max(1, limit)),
      search: search && search.length > 0 ? search : null,
    });
  }

  @Get(':username')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single Cognito user with recent audit events' })
  @ApiOkResponse({ description: 'User detail including last 20 group-change events.' })
  detail(@Param('username') username: string) {
    return this.admin.getUser(username);
  }

  @Post(':username/groups')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Grant a group membership (admin only)' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  grant(
    @Param('username') username: string,
    @Body(new ZodPipe(GrantGroupRequestSchema)) body: GrantGroupRequest,
    @CurrentUser() actor: CognitoAccessTokenPayload,
  ) {
    return this.admin.grant(username, body.group, actor);
  }

  @Delete(':username/groups/:group')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a group membership (admin only)' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  revoke(
    @Param('username') username: string,
    @Param('group', new ZodPipe(PlatformGroupSchema)) group: PlatformGroup,
    @CurrentUser() actor: CognitoAccessTokenPayload,
  ) {
    return this.admin.revoke(username, group, actor);
  }
}
