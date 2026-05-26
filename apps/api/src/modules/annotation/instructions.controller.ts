import { Body, Controller, Get, Inject, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CampaignSlugSchema,
  PublishInstructionsRequestSchema,
  type CampaignSlug,
  type PublishInstructionsRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { AnnotationRoles, AnnotationRolesGuard } from './roles.guard.js';
import { InstructionsService } from './instructions.service.js';

/**
 * `/v2/annotation/campaigns/:slug/instructions` — Per-campaign
 * annotation instructions (#230).
 *
 * Auth model:
 *   - GET: any authenticated user. Annotators read the current
 *     instructions on each `pull-next`; managers read the history.
 *   - PUT: campaign-manager only. Content-hash-keyed; idempotent.
 */
@ApiTags('annotation')
@Controller({ path: 'annotation/campaigns/:slug/instructions', version: '2' })
export class InstructionsController {
  constructor(@Inject(InstructionsService) private readonly instructions: InstructionsService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fetch the current instructions and version history for a campaign' })
  @ApiOkResponse({ description: 'Current published instructions + last 20 historic versions.' })
  @UseGuards(CognitoJwtGuard)
  fetch(@Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug) {
    return this.instructions.fetch(slug);
  }

  @Put()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Publish (or re-publish) instructions for a campaign (campaign-manager only)',
    description:
      'Content-hash-keyed. Posting the same markdown body twice returns the same row with created=false. The campaign pointer advances on every successful call.',
  })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager')
  publish(
    @Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug,
    @Body(new ZodPipe(PublishInstructionsRequestSchema)) body: PublishInstructionsRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.instructions.publish(slug, body, user);
  }
}
