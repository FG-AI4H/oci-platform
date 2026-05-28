import { Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CampaignSlugSchema,
  MetadataVisibilityPreviewRequestSchema,
  MetadataVisibilityResolveRequestSchema,
  type CampaignSlug,
  type MetadataVisibilityPreviewRequest,
  type MetadataVisibilityResolveRequest,
} from '@oci/shared-types';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { AnnotationRoles, AnnotationRolesGuard } from './roles.guard.js';
import { MetadataVisibilityService } from './metadata-visibility.service.js';

/**
 * `/v2/annotation/campaigns/:slug/metadata-visibility` — metadata
 * exposure + blinding engine (ADR-0010 Decisions 1 + 2 + 4).
 *
 * Both routes are campaign-manager-only: they expose what annotators
 * *will* see, which is itself sensitive (it reveals which fields the
 * blinding policy treats as priming risks). The real annotator handoff
 * (#214) applies the same `MetadataVisibilityService.compose` filter
 * server-side and persists the resulting `metadataExposureProfile`.
 */
@ApiTags('annotation')
@Controller({ path: 'annotation/campaigns/:slug/metadata-visibility', version: '2' })
export class MetadataVisibilityController {
  constructor(
    @Inject(MetadataVisibilityService) private readonly visibility: MetadataVisibilityService,
  ) {}

  @Post('preview')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Preview the server-side-filtered handoff bundle for a sample at a gate',
    description:
      'Applies the four-bucket visibility policy (manager override → Croissant tag → OCI default) for the given gate and returns the metadata bundle the annotator would receive plus the exposure profile. `never`/`hidden` fields never appear.',
  })
  @ApiOkResponse({ description: 'Filtered metadata bundle + exposure profile.' })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager')
  preview(
    @Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug,
    @Body(new ZodPipe(MetadataVisibilityPreviewRequestSchema))
    body: MetadataVisibilityPreviewRequest,
  ) {
    return this.visibility.previewForCampaign(
      slug,
      body.sampleMetadata,
      body.gateState,
      body.croissantTags,
    );
  }

  @Post('resolve')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Resolve buckets for a set of field names (campaign-create checklist)',
    description:
      'For each field, returns the resolved bucket, the winning source (manager / Croissant / OCI default / fallback-hidden), and whether it is visible at the requested gate. Backs the visibility checklist in the campaign-create UI (#222).',
  })
  @ApiOkResponse({ description: 'Per-field resolved visibility.' })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager')
  resolve(
    @Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug,
    @Body(new ZodPipe(MetadataVisibilityResolveRequestSchema))
    body: MetadataVisibilityResolveRequest,
  ) {
    return this.visibility.resolvedFields(slug, body.fields, body.gateState, body.croissantTags);
  }
}
