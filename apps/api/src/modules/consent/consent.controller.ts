import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateConsentRequestSchema,
  RevokeConsentRequestSchema,
  type CreateConsentRequest,
  type RevokeConsentRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ConsentService } from './consent.service.js';
import { ZodPipe } from './dto/zod-pipe.js';

/**
 * `/v2/consent` — dataset consent records (ADR-0012, #224). Grant +
 * revocation are signed-receipt events; the per-dataset history is the
 * operator-facing audit trail and carries the `annotationAllowed` gate
 * flag the annotation workflow reads.
 *
 * Authenticated (Cognito JWT). Role-gating grant/revoke to host/operator
 * groups is a refinement tracked for the governance pass; on dev any
 * authenticated caller's `sub` is recorded as the consenter.
 */
@ApiTags('consent')
@Controller({ path: 'consent', version: '2' })
export class ConsentController {
  constructor(@Inject(ConsentService) private readonly consent: ConsentService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record a dataset consent (grant) with a signed receipt' })
  @ApiOkResponse({ description: 'The created consent record + receipt.' })
  @UseGuards(CognitoJwtGuard)
  create(
    @Body(new ZodPipe(CreateConsentRequestSchema)) body: CreateConsentRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.consent.record(body, user);
  }

  @Post(':id/revoke')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a consent (GDPR Art. 17) with a signed revocation receipt' })
  @ApiOkResponse({ description: 'The revoked consent record.' })
  @UseGuards(CognitoJwtGuard)
  revoke(
    @Param('id') id: string,
    @Body(new ZodPipe(RevokeConsentRequestSchema)) body: RevokeConsentRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.consent.revoke(id, body, user);
  }

  @Get('dataset/:datasetId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Per-dataset consent audit trail + annotation-allowed gate flag',
  })
  @ApiOkResponse({ description: 'Full grant + revocation history with the gate predicate.' })
  @UseGuards(CognitoJwtGuard)
  datasetHistory(@Param('datasetId') datasetId: string) {
    return this.consent.historyForDataset(datasetId);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fetch one consent record' })
  @ApiOkResponse({ description: 'The consent record.' })
  @UseGuards(CognitoJwtGuard)
  get(@Param('id') id: string) {
    return this.consent.get(id);
  }
}
