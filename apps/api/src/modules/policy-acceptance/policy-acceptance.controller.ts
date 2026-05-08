import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  RecordPolicyAcceptanceRequestSchema,
  type ListPolicyAcceptancesResponse,
  type PolicyAcceptanceReceipt,
  type RecordPolicyAcceptanceRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { PolicyAcceptanceService } from './policy-acceptance.service.js';

/**
 * `/v2/identity/policy-acceptances` (#118) — click-wrap acceptance
 * recording + audit trail. Auth required: there's no anonymous
 * acceptance concept (a hash bound to "no one in particular" has no
 * legal meaning).
 */
@ApiTags('policy-acceptances')
@ApiBearerAuth()
@Controller({ path: 'identity/policy-acceptances', version: '2' })
@UseGuards(CognitoJwtGuard)
export class PolicyAcceptanceController {
  constructor(@Inject(PolicyAcceptanceService) private readonly service: PolicyAcceptanceService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Record a click-wrap policy acceptance' })
  @ApiCreatedResponse({
    description:
      'Acceptance receipt with SHA-256 hash + (optional, when KMS is configured) tamper-evident signature.',
  })
  record(
    @Body(new ZodPipe(RecordPolicyAcceptanceRequestSchema)) body: RecordPolicyAcceptanceRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<PolicyAcceptanceReceipt> {
    return this.service.record(body, user);
  }
}

/**
 * `/v2/me/policy-acceptances` — caller's own audit trail. Mounted
 * under `/me` rather than `/identity/policy-acceptances?user=:id` so
 * it's clear no other user's data is reachable here.
 */
@ApiTags('policy-acceptances')
@ApiBearerAuth()
@Controller({ path: 'me/policy-acceptances', version: '2' })
@UseGuards(CognitoJwtGuard)
export class MyPolicyAcceptancesController {
  constructor(@Inject(PolicyAcceptanceService) private readonly service: PolicyAcceptanceService) {}

  @Get()
  @ApiOperation({ summary: "Caller's own click-wrap acceptance history" })
  @ApiOkResponse({ description: 'Most-recent-first list of acceptance receipts.' })
  async listOwn(
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<ListPolicyAcceptancesResponse> {
    const items = await this.service.listOwn(user);
    return { items };
  }
}
