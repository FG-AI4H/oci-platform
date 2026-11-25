import { Controller, Get, Inject, Param, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CampaignSlugSchema, type CampaignAgreement, type CampaignSlug } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type { FastifyReply } from 'fastify';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { AnnotationRoles, AnnotationRolesGuard } from './roles.guard.js';
import {
  CampaignAnnotationsService,
  type AnnotationExportFormat,
} from './campaign-annotations.service.js';

/**
 * A campaign's reader agreement and its annotation export (#648).
 *
 *   GET /v2/annotation/campaigns/:slug/agreement         managers, supervisors
 *   GET /v2/annotation/campaigns/:slug/annotations.csv   managers, supervisors
 *   GET /v2/annotation/campaigns/:slug/annotations.json  managers, supervisors
 *
 * The same group rule as the rest of the module: `campaign-manager`
 * and `task-supervisor`, `admin` overriding (supervisors may export,
 * decision of 2026-11-25 on #648). Every export is written to the
 * audit trail.
 */
@ApiTags('annotation')
@Controller({ path: 'annotation/campaigns', version: '2' })
export class CampaignAnnotationsController {
  constructor(
    @Inject(CampaignAnnotationsService) private readonly service: CampaignAnnotationsService,
  ) {}

  @Get(':slug/agreement')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Agreement between the campaign's readers (managers, supervisors)",
    description:
      "Fleiss' kappa with a 95% percentile-bootstrap interval, overall percent agreement, pairwise Cohen's kappa under pseudonymous reader ids, and answer counts per reader. Computed on request from the submitted independent readings only. Below 10 tasks, counts only.",
  })
  @ApiOkResponse({ description: 'CampaignAgreement.' })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager', 'task-supervisor')
  agreement(
    @Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug,
  ): Promise<CampaignAgreement> {
    return this.service.agreement(slug);
  }

  @Get(':slug/annotations.csv')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Export the campaign's annotations as CSV (managers, supervisors; the export is audited)",
  })
  @ApiOkResponse({ description: 'text/csv, UTF-8 with a byte-order mark.' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager', 'task-supervisor')
  exportCsv(
    @Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug,
    @CurrentUser() user: CognitoAccessTokenPayload,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return this.send(slug, 'csv', user, reply);
  }

  @Get(':slug/annotations.json')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Export the campaign's annotations as JSON (managers, supervisors; the export is audited)",
  })
  @ApiOkResponse({ description: 'oci-annotation-export/v1.' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager', 'task-supervisor')
  exportJson(
    @Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug,
    @CurrentUser() user: CognitoAccessTokenPayload,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return this.send(slug, 'json', user, reply);
  }

  private async send(
    slug: CampaignSlug,
    format: AnnotationExportFormat,
    user: CognitoAccessTokenPayload,
    reply: FastifyReply,
  ): Promise<string> {
    const file = await this.service.export(slug, format, user);
    reply
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `attachment; filename="${file.filename}"`)
      .header('Cache-Control', 'no-store')
      .header('X-OCI-Export-Id', file.exportId)
      .header('X-OCI-Export-Sha256', file.sha256);
    return file.body;
  }
}
