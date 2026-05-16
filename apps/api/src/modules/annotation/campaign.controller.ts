import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CampaignSlugSchema,
  CreateCampaignRequestSchema,
  type CampaignSlug,
  type CreateCampaignRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { AnnotationRoles, AnnotationRolesGuard } from './roles.guard.js';
import { CampaignService } from './campaign.service.js';

/**
 * `/v2/annotation/campaigns` — Phase B.A.1 scaffold (ADR-0006 + 0007 +
 * 0008 + 0009 + 0010 + 0011 + 0012).
 *
 * Auth model:
 *   - GET endpoints: any authenticated user. Visibility filtering by
 *     campaign-membership (annotator / reviewer / supervisor / manager)
 *     lands when role-Visa scope is wired into the queue endpoints in
 *     sub-epic #215. Until then a flat read.
 *   - POST: requires `campaign-manager` (or `admin`). Visa-backed
 *     `AnnotationRole` check replaces the Cognito-group check once
 *     ADR-0003's Visa issuer is wired (sub-epic #234 covers the
 *     pre-campaign-join agreement; #126/#127 already shipped the Visa
 *     infrastructure).
 */
@ApiTags('annotation')
@Controller({ path: 'annotation/campaigns', version: '2' })
export class CampaignController {
  constructor(@Inject(CampaignService) private readonly campaigns: CampaignService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List recent annotation campaigns' })
  @ApiOkResponse({ description: 'Page of campaign summaries.' })
  @UseGuards(CognitoJwtGuard)
  list() {
    return this.campaigns.list();
  }

  @Get(':slug')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a campaign detail by slug' })
  @ApiOkResponse({ description: 'Full campaign detail including tool-integration summary.' })
  @UseGuards(CognitoJwtGuard)
  detail(@Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug) {
    return this.campaigns.detail(slug);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a draft annotation campaign (campaign-manager only)' })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager')
  create(
    @Body(new ZodPipe(CreateCampaignRequestSchema)) body: CreateCampaignRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.campaigns.create(body, user);
  }
}
