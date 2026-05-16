import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { Roles, RolesGuard } from '../../auth/roles.guard.js';
import { PlatformSettingsService } from './platform-settings.service.js';

/**
 * `/v2/admin/settings` — admin-only platform-settings CRUD.
 * `/v2/platform-settings/banner` — public banner read (anonymous-safe).
 *
 * Two controllers in one file because they share the same service and
 * the public endpoint is small enough that splitting feels ceremonial.
 */
@ApiTags('admin')
@Controller({ path: 'admin/settings', version: '2' })
@UseGuards(CognitoJwtGuard, RolesGuard)
@Roles('admin')
export class AdminSettingsController {
  constructor(
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Read current platform settings (admin only)' })
  @ApiOkResponse({ description: 'Current settings + last-updated metadata.' })
  get() {
    return this.settings.get();
  }

  @Put()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace platform settings (admin only)' })
  @ApiOkResponse({ description: 'Updated settings + last-updated metadata.' })
  replace(@Body() body: unknown, @CurrentUser() actor: CognitoAccessTokenPayload) {
    return this.settings.replace(body, actor);
  }
}

@ApiTags('platform-settings')
@Controller({ path: 'platform-settings', version: '2' })
export class PublicSettingsController {
  constructor(
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  @Get('banner')
  @ApiOperation({ summary: 'Public maintenance banner (null when no active banner)' })
  @ApiOkResponse({ description: 'The current banner if within its visible window.' })
  banner() {
    return this.settings.publicBanner();
  }
}
