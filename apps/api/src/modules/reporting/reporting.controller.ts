import { Controller, Get, Header, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivityReportQuerySchema, type ActivityReportQuery } from '@oci/shared-types';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { Roles, RolesGuard } from '../../auth/roles.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { ReportingService } from './reporting.service.js';

/**
 * `/v2/reports` (#828). For the people who run a deployment or oversee it:
 * the report holds counts and public entries only, but how busy a deployment
 * is is theirs to publish.
 */
@ApiTags('reports')
@Controller({ path: 'reports', version: '2' })
@UseGuards(CognitoJwtGuard, RolesGuard)
@Roles('admin', 'regulator', 'supervisor')
export class ReportingController {
  constructor(@Inject(ReportingService) private readonly reporting: ReportingService) {}

  @Get('activity')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activity report of one calendar month (#828)' })
  @ApiOkResponse({
    description:
      'Datasets, access requests, evaluations, models, annotation campaigns and the audit chain over the month. Without `month`: the last complete month.',
  })
  @Header('Cache-Control', 'no-store')
  activity(@Query(new ZodPipe(ActivityReportQuerySchema)) query: ActivityReportQuery) {
    return this.reporting.activity(query.month);
  }
}
