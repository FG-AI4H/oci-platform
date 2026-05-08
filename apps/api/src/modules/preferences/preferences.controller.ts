import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  UpdateUserPreferencesRequestSchema,
  type UpdateUserPreferencesRequest,
  type UserPreferences,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { PreferencesService } from './preferences.service.js';

/**
 * `/v2/preferences/me` — per-user UI preferences (dark mode, locale,
 * density). Auth is required: we don't expose unauthenticated reads
 * because there's no anonymous-user concept on the platform.
 *
 * The endpoint is keyed `/me` rather than `/preferences/:userId` so
 * there's no ambiguity about whose row is being mutated; admins read
 * their own row only. There's intentionally no public list endpoint.
 */
@ApiTags('preferences')
@ApiBearerAuth()
@Controller({ path: 'preferences', version: '2' })
@UseGuards(CognitoJwtGuard)
export class PreferencesController {
  constructor(@Inject(PreferencesService) private readonly preferences: PreferencesService) {}

  @Get('me')
  @ApiOperation({ summary: "Caller's UI preferences (defaults if unset)" })
  @ApiOkResponse({ description: 'Current preferences for the authenticated user.' })
  findMine(@CurrentUser() user: CognitoAccessTokenPayload): Promise<UserPreferences> {
    return this.preferences.findMine(user);
  }

  @Put('me')
  @ApiOperation({ summary: 'Update the caller’s preferences (partial)' })
  @ApiOkResponse({ description: 'The updated preferences row.' })
  updateMine(
    @Body(new ZodPipe(UpdateUserPreferencesRequestSchema)) body: UpdateUserPreferencesRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<UserPreferences> {
    return this.preferences.updateMine(user, body);
  }
}
