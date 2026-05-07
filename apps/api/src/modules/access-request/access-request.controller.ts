import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AccessRequestDecisionSchema,
  CreateAccessRequestRequestSchema,
  DatasetSlugSchema,
  type AccessRequestDecision,
  type CreateAccessRequestRequest,
  type DatasetSlug,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { AccessRequestService } from './access-request.service.js';

/**
 * `/v2/catalog/...` access-request endpoints (PR F).
 *
 * The path tree is split:
 *   - `/v2/catalog/datasets/:slug/access-requests` (POST/GET) hangs off
 *     a specific dataset — symmetric with the existing /datasets/:slug
 *     surface.
 *   - `/v2/catalog/access-requests/:id/decision` is keyed by request id
 *     so hosts can act from their inbox without re-routing through the
 *     dataset.
 *   - `/v2/me/access-requests` lives separately and only returns the
 *     caller's own requests.
 *
 * Auth: every endpoint requires JWT. The service layer enforces
 * dataset-host / admin checks where applicable.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller({ version: '2' })
@UseGuards(CognitoJwtGuard)
export class AccessRequestController {
  constructor(
    @Inject(AccessRequestService) private readonly accessRequests: AccessRequestService,
  ) {}

  @Post('catalog/datasets/:slug/access-requests')
  @HttpCode(201)
  @ApiOperation({ summary: 'Request access to a dataset' })
  @ApiOkResponse({ description: 'Created. Returns the new request id.' })
  create(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Body(new ZodPipe(CreateAccessRequestRequestSchema)) body: CreateAccessRequestRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.accessRequests.create(slug, body, user);
  }

  @Get('catalog/datasets/:slug/access-requests')
  @ApiOperation({ summary: 'List access requests for a dataset (host / admin)' })
  listForDataset(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.accessRequests.listForDataset(slug, user);
  }

  @Get('me/access-requests')
  @ApiOperation({ summary: "Caller's own access requests across all datasets" })
  listOwn(@CurrentUser() user: CognitoAccessTokenPayload) {
    return this.accessRequests.listOwn(user);
  }

  @Get('me/host/access-requests')
  @ApiOperation({ summary: 'Inbox: access requests for datasets the caller hosts' })
  listForHost(@CurrentUser() user: CognitoAccessTokenPayload) {
    return this.accessRequests.listForHost(user);
  }

  @Post('catalog/access-requests/:id/decision')
  @HttpCode(204)
  @ApiOperation({ summary: 'Decide an access request: APPROVE / DENY / REVOKE' })
  async decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AccessRequestDecisionSchema)) body: AccessRequestDecision,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<void> {
    await this.accessRequests.decide(id, body, user);
  }
}
