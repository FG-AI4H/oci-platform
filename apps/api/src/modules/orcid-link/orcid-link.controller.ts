import { Body, Controller, Delete, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  OrcidCallbackRequestSchema,
  type OrcidAuthorizeResponse,
  type OrcidCallbackRequest,
  type OrcidLinkSummary,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { OrcidLinkService } from './orcid-link.service.js';

/**
 * `/v2/identity/orcid/*` (#125) — OAuth dance + admin endpoints.
 * Auth required: anonymous OAuth links would have no caller to bind to.
 */
@ApiTags('orcid')
@ApiBearerAuth()
@Controller({ path: 'identity/orcid', version: '2' })
@UseGuards(CognitoJwtGuard)
export class OrcidLinkController {
  constructor(@Inject(OrcidLinkService) private readonly service: OrcidLinkService) {}

  @Get('authorize')
  @ApiOperation({ summary: 'Build the ORCID authorize URL (start the OAuth dance)' })
  @ApiOkResponse({ description: 'authorizeUrl + opaque state to validate on callback.' })
  authorize(@CurrentUser() user: CognitoAccessTokenPayload): Promise<OrcidAuthorizeResponse> {
    return this.service.startAuthorize(user);
  }

  @Post('callback')
  @HttpCode(201)
  @ApiOperation({ summary: 'Complete the ORCID OAuth dance (exchange code, persist link)' })
  @ApiCreatedResponse({ description: 'Persisted ORCID link summary.' })
  callback(
    @Body(new ZodPipe(OrcidCallbackRequestSchema)) body: OrcidCallbackRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<OrcidLinkSummary> {
    return this.service.completeCallback(body, user);
  }
}

/**
 * `/v2/me/orcid` — caller's own link (or null) and unlink action.
 * Mounted under `/me` so admins can't reach into other users' links
 * here; an admin-side endpoint can land later if regulator-audit
 * requires it.
 */
@ApiTags('orcid')
@ApiBearerAuth()
@Controller({ path: 'me/orcid', version: '2' })
@UseGuards(CognitoJwtGuard)
export class MyOrcidLinkController {
  constructor(@Inject(OrcidLinkService) private readonly service: OrcidLinkService) {}

  @Get()
  @ApiOperation({ summary: "Caller's linked ORCID iD (or null)" })
  @ApiOkResponse({ description: 'OrcidLinkSummary or null when not linked.' })
  async getMyLink(
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<{ link: OrcidLinkSummary | null }> {
    const link = await this.service.getMyLink(user);
    return { link };
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the caller’s ORCID link (no-op when absent)' })
  @ApiNoContentResponse({ description: 'Link removed (or did not exist).' })
  async unlink(@CurrentUser() user: CognitoAccessTokenPayload): Promise<void> {
    await this.service.unlink(user);
  }
}
