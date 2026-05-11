import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateDuaSigningRequestSchema,
  DocusealWebhookEventSchema,
  type CreateDuaSigningRequest,
  type CreateDuaSigningRequestResponse,
  type DuaSignatureSummary,
  type ListDuaSignaturesResponse,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type { FastifyRequest } from 'fastify';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { DocusealClient } from './docuseal-client.js';
import { DuaSigningService } from './dua-signing.service.js';

/**
 * `/v2/dua/sign-requests` + `/v2/dua/webhook/docuseal` (#128).
 *
 * The signing-request endpoint requires the requester (or host /
 * admin) to be authenticated. The webhook is unauthenticated but
 * HMAC-validated against `OCI_DOCUSEAL_WEBHOOK_SECRET`.
 */
@ApiTags('dua-signing')
@Controller({ path: 'dua', version: '2' })
export class DuaSigningController {
  constructor(@Inject(DuaSigningService) private readonly service: DuaSigningService) {}

  @Post('sign-requests')
  @HttpCode(201)
  @UseGuards(CognitoJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mint a DocuSeal signing envelope for an APPROVED access request' })
  @ApiCreatedResponse({
    description: 'CreateDuaSigningRequestResponse — persisted row + signer URL.',
  })
  create(
    @Body(new ZodPipe(CreateDuaSigningRequestSchema)) body: CreateDuaSigningRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<CreateDuaSigningRequestResponse> {
    return this.service.createSigningRequest(body, user);
  }

  @Post('webhook/docuseal')
  @HttpCode(200)
  @ApiOperation({ summary: 'DocuSeal webhook — completion / decline / expiry notifications' })
  @ApiOkResponse({ description: '`{ acknowledged: true }` on any payload (idempotent).' })
  async webhook(
    @Req() req: FastifyRequest,
    @Headers('x-docuseal-signature') signature: string | undefined,
  ): Promise<{ acknowledged: boolean }> {
    const client = DocusealClient.fromEnv();
    if (!client) {
      // No env → DocuSeal isn't configured for this deployment, and
      // we have no shared secret to authenticate the payload against.
      // 503 so an accidental hit to a misconfigured stage is loud
      // rather than silently accepted.
      throw new ServiceUnavailableException('DocuSeal webhook not configured on this deployment.');
    }
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    if (!client.verifyWebhookSignature(rawBody, signature)) {
      // Returning 200 + acknowledged=false is wrong here — a bad
      // signature is a security signal. 401 makes the misconfigured
      // deployment loud.
      throw new ServiceUnavailableException('DocuSeal webhook signature invalid.');
    }
    // Re-parse with Zod so we don't act on a malformed payload that
    // happened to validate HMAC against an attacker-controlled body.
    const parsed = DocusealWebhookEventSchema.safeParse(req.body);
    if (!parsed.success) {
      // Acknowledge so DocuSeal doesn't retry — a malformed payload
      // is unrecoverable on our side anyway.
      return { acknowledged: true };
    }
    return this.service.handleWebhook(parsed.data);
  }
}

/**
 * `/v2/me/dua-signatures` — caller's own signing history + status.
 */
@ApiTags('dua-signing')
@ApiBearerAuth()
@Controller({ path: 'me/dua-signatures', version: '2' })
@UseGuards(CognitoJwtGuard)
export class MyDuaSignaturesController {
  constructor(@Inject(DuaSigningService) private readonly service: DuaSigningService) {}

  @Get()
  @ApiOperation({ summary: "Caller's DUA signing history" })
  @ApiOkResponse({ description: 'ListDuaSignaturesResponse — most-recent first.' })
  list(@CurrentUser() user: CognitoAccessTokenPayload): Promise<ListDuaSignaturesResponse> {
    return this.service.listMine(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One DUA signature row' })
  @ApiOkResponse({ description: 'DuaSignatureSummary.' })
  get(
    @CurrentUser() user: CognitoAccessTokenPayload,
    @Param('id') id: string,
  ): Promise<DuaSignatureSummary> {
    return this.service.getMine(user, id);
  }
}
