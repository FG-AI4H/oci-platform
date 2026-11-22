import { Controller, Get, Inject, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AuditEventFiltersSchema,
  AuditEventsQuerySchema,
  AuditVerifyQuerySchema,
  type AuditChainVerification,
  type AuditEventFilters,
  type AuditEventPage,
  type AuditEventsQuery,
  type AuditVerifyQuery,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type { FastifyReply } from 'fastify';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { Roles, RolesGuard } from '../../auth/roles.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { AuditReaderService, type AuditReaderCaller } from './audit-reader.service.js';

/**
 * `/v2/audit` — the audit trail reader (#653, ADR-0014).
 *
 * `admin` and `regulator` only. An `admin` sees who acted; a
 * `regulator` sees pseudonyms (see `AuditPseudonymiser`). Each export
 * is written to the trail with the sha256 of the file.
 */
@ApiTags('audit')
@Controller({ path: 'audit', version: '2' })
@UseGuards(CognitoJwtGuard, RolesGuard)
@Roles('admin', 'regulator')
export class AuditController {
  constructor(@Inject(AuditReaderService) private readonly reader: AuditReaderService) {}

  @Get('events')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List audit events (admin, regulator)' })
  @ApiOkResponse({ description: 'A page of events with their record and previous hashes.' })
  list(
    @Query(new ZodPipe(AuditEventsQuerySchema)) query: AuditEventsQuery,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<AuditEventPage> {
    return this.reader.list(query, caller(user));
  }

  @Get('events/verify')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Recompute the hash chain over a range; report the first break' })
  @ApiOkResponse({ description: 'intact, broken (with the first break) or empty.' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(
    @Query(new ZodPipe(AuditVerifyQuerySchema)) query: AuditVerifyQuery,
  ): Promise<AuditChainVerification> {
    return this.reader.verify(query);
  }

  @Get('events.csv')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export audit events as CSV (the export is itself audited)' })
  @ApiOkResponse({ description: 'text/csv, oldest first. 422 above 10 000 events.' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  exportCsv(
    @Query(new ZodPipe(AuditEventFiltersSchema)) filters: AuditEventFilters,
    @CurrentUser() user: CognitoAccessTokenPayload,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return this.send('csv', filters, user, reply);
  }

  @Get('events.json')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export audit events as JSON (the export is itself audited)' })
  @ApiOkResponse({ description: 'oci-audit-events/v1, oldest first. 422 above 10 000 events.' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  exportJson(
    @Query(new ZodPipe(AuditEventFiltersSchema)) filters: AuditEventFilters,
    @CurrentUser() user: CognitoAccessTokenPayload,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return this.send('json', filters, user, reply);
  }

  private async send(
    format: 'csv' | 'json',
    filters: AuditEventFilters,
    user: CognitoAccessTokenPayload,
    reply: FastifyReply,
  ): Promise<string> {
    const file = await this.reader.export(format, filters, caller(user));
    reply
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `attachment; filename="${file.filename}"`)
      .header('Cache-Control', 'no-store')
      .header('X-OCI-Export-Id', file.exportId)
      .header('X-OCI-Export-Sha256', file.sha256);
    return file.body;
  }
}

function caller(user: CognitoAccessTokenPayload): AuditReaderCaller {
  const groups = user['cognito:groups'];
  return {
    sub: user.sub,
    groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [],
  };
}
