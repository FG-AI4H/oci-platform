import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  IngestPassportVisaRequestSchema,
  type IngestPassportVisaRequest,
  type ListPassportVisasResponse,
  type PassportTrustedIssuerSummary,
  type PassportVisaSummary,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { PassportService } from './passport.service.js';

/**
 * `/v2/identity/passport/*` (#126) — visa ingestion + trust list.
 * Auth required for ingest (we bind the visa to the caller's userId).
 */
@ApiTags('passport')
@ApiBearerAuth()
@Controller({ path: 'identity/passport', version: '2' })
export class PassportController {
  constructor(@Inject(PassportService) private readonly service: PassportService) {}

  @Get('issuers')
  @ApiOperation({ summary: 'List trusted Passport issuers (admin-managed allowlist)' })
  @ApiOkResponse({ description: 'Active + revoked issuers, both shown for transparency.' })
  async listIssuers(): Promise<{ items: PassportTrustedIssuerSummary[] }> {
    const items = await this.service.listTrustedIssuers();
    return { items };
  }

  @Post('visas')
  @HttpCode(201)
  @UseGuards(CognitoJwtGuard)
  @ApiOperation({ summary: 'Ingest a GA4GH Passport Visa JWT (verify + persist)' })
  @ApiCreatedResponse({ description: 'Verified visa summary.' })
  ingest(
    @Body(new ZodPipe(IngestPassportVisaRequestSchema)) body: IngestPassportVisaRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<PassportVisaSummary> {
    return this.service.ingestVisa(body, user);
  }
}

/**
 * `/v2/me/passport/visas` — caller's own visas + revoke action.
 * Mounted under `/me` so the API's surface for "modify someone else's
 * passport state" stays explicitly admin-only (not yet exposed).
 */
@ApiTags('passport')
@ApiBearerAuth()
@Controller({ path: 'me/passport', version: '2' })
@UseGuards(CognitoJwtGuard)
export class MyPassportController {
  constructor(@Inject(PassportService) private readonly service: PassportService) {}

  @Get('visas')
  @ApiOperation({ summary: "List the caller's verified visas" })
  @ApiOkResponse({
    description: 'ListPassportVisasResponse — only active (non-expired, non-revoked) rows.',
  })
  list(@CurrentUser() user: CognitoAccessTokenPayload): Promise<ListPassportVisasResponse> {
    return this.service.listMyVisas(user);
  }

  @Delete('visas/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke (soft-delete) one of the caller’s visas' })
  @ApiNoContentResponse({ description: 'Visa marked revoked; audit row preserved.' })
  async revoke(
    @CurrentUser() user: CognitoAccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.revokeMyVisa(user, id);
  }
}
