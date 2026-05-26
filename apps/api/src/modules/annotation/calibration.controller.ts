import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CampaignSlugSchema, type CampaignSlug } from '@oci/shared-types';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { AnnotationRoles, AnnotationRolesGuard } from './roles.guard.js';
import { CalibrationService } from './calibration.service.js';

/**
 * Supervisor inbox surface for calibration flags (#292).
 *
 * GET /v2/annotation/campaigns/:slug/calibration/flags
 *
 * Returns ACTIVE flags only. Cleared rows are kept for audit but the
 * inbox view doesn't show them — the supervisor goes through the
 * audit trail when reviewing history.
 */
@ApiTags('annotation')
@Controller({ path: 'annotation/campaigns/:slug/calibration', version: '2' })
export class CalibrationController {
  constructor(@Inject(CalibrationService) private readonly calibration: CalibrationService) {}

  @Get('flags')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List ACTIVE calibration flags for a campaign (supervisor inbox)' })
  @ApiOkResponse({ description: 'ACTIVE flags ordered newest-first.' })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('task-supervisor', 'campaign-manager')
  list(@Param('slug', new ZodPipe(CampaignSlugSchema)) slug: CampaignSlug) {
    return this.calibration.listForCampaign(slug);
  }
}
