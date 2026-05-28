import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  ToolCallbackRequestSchema,
  ToolHandoffRequestSchema,
  type ToolCallbackRequest,
  type ToolHandoffRequest,
} from '@oci/shared-types';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { AnnotationRoles, AnnotationRolesGuard } from './roles.guard.js';
import { ToolIntegrationService } from './tool-integration.service.js';

/**
 * `/v2/annotation/integrations/:integrationId` — the tool-integration
 * contract (ADR-0007, #214): registry detail, signed handoff, and the
 * idempotent callback. Paths match ADR-0007 exactly. The minimal
 * `GET /v2/annotation/tool-integrations` picker list stays on its own
 * controller (frontend-consumed; left unchanged).
 *
 * Deferred to the security-boundary follow-up: the callback's real auth
 * is the RFC 8693 exchanged tool-callback-token; until that lands the
 * route is guarded by the standard Cognito JWT guard so it is never
 * public.
 */
@ApiTags('annotation')
@Controller({ path: 'annotation/integrations/:integrationId', version: '2' })
export class ToolIntegrationContractController {
  constructor(@Inject(ToolIntegrationService) private readonly tools: ToolIntegrationService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tool-integration detail: capability matrix + versions (ADR-0007)' })
  @ApiOkResponse({ description: 'Integration detail with capabilities + versions.' })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('campaign-manager')
  detail(@Param('integrationId') integrationId: string) {
    return this.tools.getDetail(integrationId);
  }

  @Post('handoff')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mint a handoff descriptor for an assignment (ADR-0007 §Handoff)',
    description:
      'Returns the launch descriptor + ADR-0010-filtered metadataBundle for the assignment. `launchToken` (RFC 8693) and `sampleUrl` (presigned) are null until the security-boundary follow-up.',
  })
  @ApiOkResponse({ description: 'Handoff descriptor.' })
  @UseGuards(CognitoJwtGuard, AnnotationRolesGuard)
  @AnnotationRoles('annotator', 'arbitration-annotator', 'expert-reviewer')
  handoff(
    @Param('integrationId') integrationId: string,
    @Body(new ZodPipe(ToolHandoffRequestSchema)) body: ToolHandoffRequest,
  ) {
    return this.tools.handoff(integrationId, body.assignmentId);
  }

  @Post('callback')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Idempotent, schemaProfile-validated callback intake (ADR-0007 §Submission)',
    description:
      '202 Accepted on first call with a given X-OCI-Idempotency-Key; 200 with the cached result on a same-body replay; 409 if the key is reused with a different body. Payload is validated against the pinned version schemaProfile.',
  })
  @ApiOkResponse({ description: 'Callback receipt (accepted | duplicate).' })
  @UseGuards(CognitoJwtGuard)
  async callback(
    @Param('integrationId') integrationId: string,
    @Headers('x-oci-idempotency-key') idempotencyKey: string,
    @Body(new ZodPipe(ToolCallbackRequestSchema)) body: ToolCallbackRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { response, httpStatus } = await this.tools.callback(
      integrationId,
      body,
      idempotencyKey ?? '',
    );
    reply.status(httpStatus);
    return response;
  }
}
